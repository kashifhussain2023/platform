import type { ConfigService } from '@nestjs/config';
import { CircuitBreakerRegistry } from './circuit-breaker.registry';
import { CircuitOpenError } from './circuit-breaker';

// Low threshold + short cooldown so the test is fast; no Redis (null) → the
// registry uses its in-memory snapshot store.
const configStub = {
  get: (key: string) =>
    ({ CIRCUIT_FAILURE_THRESHOLD: '2', CIRCUIT_COOLDOWN_MS: '40' })[key],
} as unknown as ConfigService;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('CircuitBreakerRegistry (in-memory)', () => {
  it('opens after the threshold, fast-fails while OPEN, then half-open probe closes on success', async () => {
    const reg = new CircuitBreakerRegistry(null, configStub);
    const id = 'con_1';

    // Two retryable failures trip the breaker (threshold = 2).
    await reg.recordFailure(id);
    expect(await reg.getState(id)).toBe('CLOSED');
    await reg.recordFailure(id);
    expect(await reg.getState(id)).toBe('OPEN');

    // While OPEN (within cooldown) guard fast-fails without calling anything.
    await expect(reg.guard(id)).rejects.toBeInstanceOf(CircuitOpenError);

    // After the cooldown, a probe is allowed and a success closes the circuit.
    await sleep(60);
    await expect(reg.guard(id)).resolves.toBeUndefined(); // OPEN → HALF_OPEN probe
    await reg.recordSuccess(id);
    expect(await reg.getState(id)).toBe('CLOSED');
    await expect(reg.guard(id)).resolves.toBeUndefined();
  });

  it('a failed half-open probe reopens the circuit', async () => {
    const reg = new CircuitBreakerRegistry(null, configStub);
    const id = 'con_2';
    await reg.recordFailure(id);
    await reg.recordFailure(id);
    expect(await reg.getState(id)).toBe('OPEN');

    await sleep(60);
    await reg.guard(id); // probe allowed (HALF_OPEN)
    await reg.recordFailure(id); // probe fails → reopen
    await expect(reg.guard(id)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('run() fast-fails an OPEN breaker without invoking fn, and records failures/successes', async () => {
    const reg = new CircuitBreakerRegistry(null, configStub);
    const id = 'con_3';

    // A retryable (5xx) failure counts; two trips it.
    await expect(
      reg.run(id, async () => {
        throw { status: 503 };
      }),
    ).rejects.toEqual({ status: 503 });
    await expect(
      reg.run(id, async () => {
        throw { status: 503 };
      }),
    ).rejects.toEqual({ status: 503 });
    expect(await reg.getState(id)).toBe('OPEN');

    // OPEN → run must NOT invoke fn.
    let invoked = false;
    await expect(
      reg.run(id, async () => {
        invoked = true;
        return 'ok';
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(invoked).toBe(false);
  });

  it('a validation (non-auth 4xx) failure does NOT count toward tripping', async () => {
    const reg = new CircuitBreakerRegistry(null, configStub);
    const id = 'con_4';
    for (let i = 0; i < 5; i += 1) {
      await expect(
        reg.run(id, async () => {
          throw { status: 400 };
        }),
      ).rejects.toEqual({ status: 400 });
    }
    expect(await reg.getState(id)).toBe('CLOSED');
  });
});
