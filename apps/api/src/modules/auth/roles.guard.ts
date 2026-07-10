import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '@vaep/types';
import type { AuthenticatedUser } from './auth.provider';
import { ROLES_KEY } from './decorators/roles.decorator';

/** Role hierarchy: OWNER ⊇ ADMIN ⊇ MEMBER (a higher rank satisfies a lower one). */
const ROLE_RANK: Record<Role, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

/**
 * True when `role` satisfies at least one of the `allowed` roles under the
 * hierarchy: an OWNER satisfies `@Roles('ADMIN')`; an ADMIN does NOT satisfy
 * `@Roles('OWNER')`. An empty `allowed` list is treated as satisfied.
 */
export function roleSatisfies(role: Role, allowed: readonly Role[]): boolean {
  if (allowed.length === 0) {
    return true;
  }
  return allowed.some((required) => ROLE_RANK[role] >= ROLE_RANK[required]);
}

/**
 * Authorization guard that runs AFTER JwtAuthGuard (which populates
 * `request.user`). It reads the `@Roles(...)` metadata (method overrides class);
 * when none is present the route is open to any authenticated user. Otherwise
 * the caller's role must satisfy the hierarchy or a 403 is thrown. Because an
 * OWNER outranks everything, owner-token callers pass every restricted route.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @Roles metadata → authenticated-only (JwtAuthGuard already ran).
    if (!allowed || allowed.length === 0) {
      return true;
    }
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const role = req.user?.role;
    if (!role || !roleSatisfies(role, allowed)) {
      throw new ForbiddenException('Insufficient role for this action');
    }
    return true;
  }
}
