import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators/public.decorator.js';
import { AUTH_REQUIRED_MESSAGE, JwtAuthGuard } from './jwt-auth.guard.js';

class SampleController {
  @Public()
  open(): void {}
}

function contextFor(handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => SampleController,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(new Reflector());

  it('laisse passer une route @Public() sans jeton', () => {
    expect(guard.canActivate(contextFor(SampleController.prototype.open))).toBe(
      true,
    );
  });

  it('lève 401 « Authentification requise » sans utilisateur', () => {
    expect(() => guard.handleRequest(null, false)).toThrow(
      new UnauthorizedException(AUTH_REQUIRED_MESSAGE),
    );
  });

  it('propage l’erreur levée par la stratégie', () => {
    const error = new Error('base indisponible');

    expect(() => guard.handleRequest(error, false)).toThrow(error);
  });

  it('renvoie l’utilisateur authentifié', () => {
    const user = { id: 1n };

    expect(guard.handleRequest(null, user)).toBe(user);
  });
});
