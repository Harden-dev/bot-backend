import { randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { AUTH_REQUIRED_MESSAGE } from '../common/index.js';
import { type User, UserRole } from '../generated/prisma/client.js';
import { toUserResponse, UsersService } from '../users/index.js';
import type { LoginResponseDto } from './dto/login-response.dto.js';

export const INVALID_CREDENTIALS_MESSAGE = 'E-mail ou mot de passe incorrect';

/** Utilisateur déposé sur la requête (`@CurrentUser()`), sans hachage. */
export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'role'>;

export interface JwtPayload {
  sub: string;
}

const USER_ID_PATTERN = /^[1-9]\d*$/;

const logger = new Logger('AuthService');

// Calculé une seule fois au chargement du module, mêmes paramètres que le seed.
const DUMMY_HASH: Promise<string> = hash(randomBytes(32).toString('hex'));

/** Un hachage mal formé (argon2 lève) vaut mot de passe faux, pas 500. */
async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch (error) {
    logger.warn(
      `Hachage de mot de passe illisible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Seul un compte actif de rôle admin peut se connecter (PO-17). */
function canAuthenticate(user: User): boolean {
  return user.isActive && user.role === UserRole.admin;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * E-mail inconnu, mot de passe faux ou compte inactif : même `401`, sans
   * indiquer la cause (US-AUTH-01, PO-17).
   */
  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.usersService.findByEmail(email);
    // argon2 est toujours exécuté (hachage factice si l'e-mail est inconnu)
    // pour ne pas révéler l'existence du compte par le temps de réponse.
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? (await DUMMY_HASH),
      password,
    );
    if (!user || !passwordOk || !canAuthenticate(user)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const payload: JwtPayload = { sub: user.id.toString() };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: toUserResponse(user),
    };
  }

  /**
   * Appelé par la stratégie JWT à chaque requête : recharge l'utilisateur et
   * refuse un compte supprimé, désactivé ou d'un autre rôle (PO-17).
   */
  async validatePayload(payload: Partial<JwtPayload>): Promise<AuthUser> {
    const { sub } = payload;
    if (typeof sub !== 'string' || !USER_ID_PATTERN.test(sub)) {
      throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    }
    const user = await this.usersService.findById(BigInt(sub));
    if (!user || !canAuthenticate(user)) {
      throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
