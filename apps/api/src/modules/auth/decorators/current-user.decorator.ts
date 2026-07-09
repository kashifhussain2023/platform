import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth.provider';

/** Injects the authenticated user (`req.user`) into a controller handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    return req.user;
  },
);
