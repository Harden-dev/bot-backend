import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AUTH_REQUIRED_MESSAGE } from '../common/index.js';
import type { Env } from '../config/index.js';
import { type AuthUser, AuthService, type JwtPayload } from './auth.service.js';

export const JWT_ALGORITHM = 'HS256';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      algorithms: [JWT_ALGORITHM],
      // `iat` obligatoire et jeton refusé au-delà de JWT_EXPIRES_IN depuis
      // son émission, quelle que soit sa date `exp` (B-01).
      jsonWebTokenOptions: {
        maxAge: config.get('JWT_EXPIRES_IN', { infer: true }),
      },
    });
  }

  /** Un jeton sans `exp` (jamais émis par l'application) est refusé (B-01). */
  validate(
    payload: Partial<JwtPayload> & { exp?: unknown },
  ): Promise<AuthUser> {
    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    }
    return this.authService.validatePayload(payload);
  }
}
