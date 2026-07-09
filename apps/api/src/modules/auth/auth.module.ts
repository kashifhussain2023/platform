import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_PROVIDER } from './auth.provider';
import { JwtAuthProvider } from './jwt-auth.provider';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Swap this useClass to change the auth backend (Clerk/Auth0) later.
    { provide: AUTH_PROVIDER, useClass: JwtAuthProvider },
  ],
  exports: [AuthService],
})
export class AuthModule {}
