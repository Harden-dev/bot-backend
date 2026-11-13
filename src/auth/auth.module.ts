import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/index.js';
import { UsersModule } from '../users/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWT_ALGORITHM, JwtStrategy } from './jwt.strategy.js';
import {
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_LIMIT_MESSAGE,
} from './login-rate-limit.js';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // Aucun guard global : `ThrottlerGuard` n'est posé que sur la connexion
    // (le webhook Meta ne doit jamais être limité par l'application).
    // `ThrottlerModule` est global (@Global du paquet) : un `ThrottlerGuard`
    // posé ailleurs partagerait ces options et ce stockage en mémoire.
    ThrottlerModule.forRoot({
      throttlers: [LOGIN_RATE_LIMIT],
      errorMessage: LOGIN_RATE_LIMIT_MESSAGE,
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: JWT_ALGORITHM,
          // Durée au format `ms` (défaut `8h`, DAT section 7).
          expiresIn: config.get('JWT_EXPIRES_IN', {
            infer: true,
          }) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
