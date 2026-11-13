import {
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export const AUTH_REQUIRED_MESSAGE = 'Authentification requise';

/**
 * Garde globale (`APP_GUARD`) : exige un JWT valide, sauf sur les routes
 * marquées `@Public()`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Jeton absent, invalide ou expiré : 401 au format
   * `{ statusCode, message, error }`. Une erreur levée par la stratégie
   * (compte refusé, base indisponible) est propagée telle quelle.
   */
  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err) {
      throw err;
    }
    if (!user) {
      throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    }
    return user;
  }
}
