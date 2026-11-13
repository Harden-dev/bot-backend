import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
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
    });
  }

  validate(payload: Partial<JwtPayload>): Promise<AuthUser> {
    return this.authService.validatePayload(payload);
  }
}
