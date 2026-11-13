import { spawn } from 'node:child_process';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { verify } from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { resetDb } from './helpers/reset-db.js';

const SEED_TIMEOUT_MS = 30_000;

interface SeedRun {
  status: number | null;
  stderr: string;
}

function runSeed(env: NodeJS.ProcessEnv = process.env): Promise<SeedRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'prisma/seed.ts'],
      { env, timeout: SEED_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stderr }));
  });
}

describe('prisma/seed.ts (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(process.env['DATABASE_URL'] ?? ''),
  });
  const adminEmail = process.env['ADMIN_EMAIL'] ?? '';

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crée l’admin actif avec un mot de passe haché argon2', async () => {
    const run = await runSeed();

    expect(run.status, run.stderr).toBe(0);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    expect(admin).toMatchObject({
      name: process.env['ADMIN_NAME'],
      role: 'admin',
      isActive: true,
    });
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verify(admin.passwordHash, process.env['ADMIN_PASSWORD'] ?? ''),
    ).resolves.toBe(true);
  });

  it('ne crée pas de doublon et ne modifie pas l’admin existant (PO-18)', async () => {
    expect((await runSeed()).status).toBe(0);
    const first = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });

    const second = await runSeed();

    expect(second.status, second.stderr).toBe(0);
    expect(await prisma.user.count()).toBe(1);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }),
    ).resolves.toEqual(first);
  });

  it.each([
    ['vide', ''],
    ['de moins de 12 caractères', 'a'.repeat(11)],
  ])(
    'échoue sans rien créer si ADMIN_PASSWORD est %s',
    async (_label, password) => {
      const run = await runSeed({ ...process.env, ADMIN_PASSWORD: password });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('Configuration invalide');
      expect(run.stderr).toContain('ADMIN_PASSWORD');
      expect(await prisma.user.count()).toBe(0);
    },
  );
});
