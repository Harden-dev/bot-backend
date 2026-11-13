import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash, verify } from 'argon2';
import { AUTH_REQUIRED_MESSAGE } from '../common/index.js';
import type { User } from '../generated/prisma/client.js';
import { UsersService } from '../users/index.js';
import { AuthService, INVALID_CREDENTIALS_MESSAGE } from './auth.service.js';

const PASSWORD = 'mot-de-passe-solide';

// verify espionné, mais avec l'implémentation réelle d'argon2.
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});
const { verify: realVerify } =
  await vi.importActual<typeof import('argon2')>('argon2');

describe('AuthService', () => {
  const findByEmail = vi.fn();
  const findById = vi.fn();
  const signAsync = vi.fn();
  let service: AuthService;
  let admin: User;

  beforeAll(async () => {
    admin = {
      id: 7n,
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hash(PASSWORD),
      role: 'admin',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(verify).mockImplementation(realVerify);
    signAsync.mockResolvedValue('jeton');
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: { findByEmail, findById } },
        { provide: JwtService, useValue: { signAsync } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('renvoie le jeton (sub = id) et l’utilisateur sans hachage', async () => {
      findByEmail.mockResolvedValue(admin);

      await expect(service.login(admin.email, PASSWORD)).resolves.toEqual({
        accessToken: 'jeton',
        user: { id: 7, email: admin.email, name: 'Admin', role: 'admin' },
      });
      expect(signAsync).toHaveBeenCalledWith({ sub: '7' });
    });

    it.each([
      ['e-mail inconnu', null, PASSWORD],
      ['mot de passe faux', 'admin', 'mauvais'],
      ['compte inactif (PO-17)', 'inactive', PASSWORD],
    ])('refuse en 401 avec le même message : %s', async (_, kind, password) => {
      const user =
        kind === null ? null : { ...admin, isActive: kind === 'admin' };
      findByEmail.mockResolvedValue(user);

      await expect(service.login(admin.email, password)).rejects.toThrow(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(signAsync).not.toHaveBeenCalled();
    });

    it('exécute argon2 même si l’e-mail est inconnu (temps égalisé)', async () => {
      findByEmail.mockResolvedValue(null);

      await expect(
        service.login('inconnu@example.com', PASSWORD),
      ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE));
      expect(verify).toHaveBeenCalledOnce();
      expect(vi.mocked(verify).mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/);
    });

    it('traite un hachage mal formé comme un mot de passe faux (401)', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      findByEmail.mockResolvedValue({
        ...admin,
        passwordHash: 'pas-un-hachage',
      });

      await expect(service.login(admin.email, PASSWORD)).rejects.toThrow(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });
  });

  describe('validatePayload', () => {
    it('recharge l’utilisateur actif et le renvoie sans hachage', async () => {
      findById.mockResolvedValue(admin);

      await expect(service.validatePayload({ sub: '7' })).resolves.toEqual({
        id: 7n,
        email: admin.email,
        name: 'Admin',
        role: 'admin',
      });
      expect(findById).toHaveBeenCalledWith(7n);
    });

    it.each([[{}], [{ sub: '0' }], [{ sub: 'abc' }], [{ sub: 7 }]])(
      'refuse en 401 un payload mal formé %j',
      async (payload) => {
        await expect(
          service.validatePayload(payload as { sub?: string }),
        ).rejects.toThrow(new UnauthorizedException(AUTH_REQUIRED_MESSAGE));
        expect(findById).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['utilisateur supprimé', null],
      ['compte désactivé (PO-17)', { isActive: false }],
    ])('refuse en 401 : %s', async (_, override) => {
      findById.mockResolvedValue(override && { ...admin, ...override });

      await expect(service.validatePayload({ sub: '7' })).rejects.toThrow(
        new UnauthorizedException(AUTH_REQUIRED_MESSAGE),
      );
    });
  });
});
