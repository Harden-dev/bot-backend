import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import { toUserResponse } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

const ADMIN = {
  id: 1n,
  name: 'Admin',
  email: 'admin@example.com',
  passwordHash: '$argon2id$hash',
  role: 'admin' as const,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('UsersService', () => {
  const findUnique = vi.fn();
  let service: UsersService;

  beforeEach(async () => {
    findUnique.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: { user: { findUnique } } },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('recherche un utilisateur par id', async () => {
    findUnique.mockResolvedValue(ADMIN);

    await expect(service.findById(1n)).resolves.toBe(ADMIN);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 1n } });
  });

  it('recherche un utilisateur par e-mail', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.findByEmail('x@example.com')).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'x@example.com' },
    });
  });
});

describe('toUserResponse', () => {
  it('convertit l’id en number et omet le hachage', () => {
    expect(toUserResponse(ADMIN)).toEqual({
      id: 1,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
    });
  });
});
