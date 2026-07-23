import { Controller, Get } from '@nestjs/common';

/**
 * Bare liveness probe — no DB/Redis/config dependency, so it stays reachable
 * (and distinguishable from a boot-time crash) as long as the process itself
 * is up. Use Vercel's Runtime Logs, not this route, to diagnose a crash that
 * happens before the app finishes bootstrapping.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { ok: true; timestamp: string } {
    return { ok: true, timestamp: new Date().toISOString() };
  }
}
