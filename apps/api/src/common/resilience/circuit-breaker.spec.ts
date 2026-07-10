import {
  CircuitBreaker,
  initialSnapshot,
  type CircuitSnapshot,
} from './circuit-breaker';

describe('CircuitBreaker (pure state machine)', () => {
  const opts = { failureThreshold: 3, cooldownMs: 1_000 };
  const cb = new CircuitBreaker(opts);

  it('starts CLOSED and allows attempts', () => {
    const snap = initialSnapshot();
    expect(snap.state).toBe('CLOSED');
    expect(cb.attempt(snap, 0).allowed).toBe(true);
  });

  it('opens only after the failure threshold of consecutive failures', () => {
    let snap = initialSnapshot();
    snap = cb.onFailure(snap, 0);
    expect(snap.state).toBe('CLOSED'); // 1
    snap = cb.onFailure(snap, 0);
    expect(snap.state).toBe('CLOSED'); // 2
    snap = cb.onFailure(snap, 100);
    expect(snap.state).toBe('OPEN'); // 3 → trips
    expect(snap.openedAt).toBe(100);
  });

  it('a success before the threshold resets the failure counter', () => {
    let snap = initialSnapshot();
    snap = cb.onFailure(snap, 0);
    snap = cb.onFailure(snap, 0);
    snap = cb.onSuccess(snap);
    expect(snap).toEqual({ state: 'CLOSED', failures: 0, openedAt: null });
    // Two more failures should NOT open (counter was reset).
    snap = cb.onFailure(snap, 0);
    snap = cb.onFailure(snap, 0);
    expect(snap.state).toBe('CLOSED');
  });

  it('fast-fails (does not allow) while OPEN and within the cooldown', () => {
    const snap: CircuitSnapshot = { state: 'OPEN', failures: 3, openedAt: 1_000 };
    const decision = cb.attempt(snap, 1_500); // 500ms < 1000ms cooldown
    expect(decision.allowed).toBe(false);
    expect(decision.changed).toBe(false);
  });

  it('after the cooldown, transitions OPEN → HALF_OPEN and allows one probe', () => {
    const snap: CircuitSnapshot = { state: 'OPEN', failures: 3, openedAt: 1_000 };
    const decision = cb.attempt(snap, 2_000); // exactly cooldownMs elapsed
    expect(decision.allowed).toBe(true);
    expect(decision.changed).toBe(true);
    expect(decision.snapshot.state).toBe('HALF_OPEN');
  });

  it('a HALF_OPEN probe SUCCESS closes the circuit', () => {
    const half: CircuitSnapshot = { state: 'HALF_OPEN', failures: 3, openedAt: 1_000 };
    const closed = cb.onSuccess(half);
    expect(closed).toEqual({ state: 'CLOSED', failures: 0, openedAt: null });
  });

  it('a HALF_OPEN probe FAILURE reopens the circuit (new cooldown)', () => {
    const half: CircuitSnapshot = { state: 'HALF_OPEN', failures: 3, openedAt: 1_000 };
    const reopened = cb.onFailure(half, 5_000);
    expect(reopened.state).toBe('OPEN');
    expect(reopened.openedAt).toBe(5_000);
    // Still fast-fails immediately after reopening.
    expect(cb.attempt(reopened, 5_100).allowed).toBe(false);
  });

  it('observedState reflects an elapsed cooldown without mutating state', () => {
    const snap: CircuitSnapshot = { state: 'OPEN', failures: 3, openedAt: 1_000 };
    expect(cb.observedState(snap, 1_500)).toBe('OPEN');
    expect(cb.observedState(snap, 2_000)).toBe('HALF_OPEN');
    expect(snap.state).toBe('OPEN'); // unchanged
  });
});
