import { SetMetadata } from '@nestjs/common';
import type { Role } from '@vaep/types';

/** Metadata key holding the roles allowed to invoke a handler. */
export const ROLES_KEY = 'roles';

/**
 * Restrict a route to the given roles, evaluated by RolesGuard under the
 * OWNER ⊇ ADMIN ⊇ MEMBER hierarchy (so `@Roles('ADMIN')` also admits OWNER).
 * A handler with NO @Roles metadata is open to any authenticated user.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
