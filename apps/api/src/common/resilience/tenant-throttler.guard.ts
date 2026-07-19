import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Decode (NOT verify) a JWT's `companyId` claim from a raw Authorization
 * header. No signature check -- this value only picks a rate-limit bucket,
 * it is never trusted for authorization. A forged/garbage token just falls
 * back to the caller's own per-IP bucket (this function returns null), the
 * same behavior as an unauthenticated request today -- no privilege or
 * limit increase is gained by forging one.
 */
function decodeJwtCompanyId(authHeader: unknown): string | null {
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length);
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const payload: unknown = JSON.parse(json);
    const companyId = (payload as { companyId?: unknown } | null)?.companyId;
    return typeof companyId === 'string' && companyId ? companyId : null;
  } catch {
    return null;
  }
}

/**
 * Rate-limit key: per-company when the request carries a JWT with a
 * companyId claim (every authenticated endpoint), else per-IP (pre-auth
 * endpoints like login/register, where per-IP is the correct signal --
 * there's no tenant yet to key on, and it's exactly the brute-force guard
 * those limits exist for).
 *
 * Closes the founder-audit edge-case finding (2026-07-19): plain IP-based
 * limiting unfairly throttles an entire company sharing one office/VPN IP
 * together, and doesn't isolate one company's traffic from a different
 * company that happens to share the same IP (e.g. behind the same
 * corporate proxy).
 */
@Injectable()
export class TenantAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, unknown> | undefined;
    const companyId = decodeJwtCompanyId(headers?.authorization);
    if (companyId) {
      return `company:${companyId}`;
    }
    return super.getTracker(req);
  }
}
