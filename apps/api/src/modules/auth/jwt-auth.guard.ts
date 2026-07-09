import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards routes with the Passport 'jwt' strategy. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
