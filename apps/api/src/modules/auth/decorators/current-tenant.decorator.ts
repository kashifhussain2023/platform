import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth.provider';

/** Injects the current tenant's companyId from the authenticated user. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    return req.user.companyId;
  },
);
