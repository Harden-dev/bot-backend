import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/index.js';

/** Application Nest complète, configurée comme `main.ts`. */
export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  return app;
}

export const TEST_ADMIN = {
  email: 'admin.e2e@example.com',
  name: 'Admin E2E',
  password: 'mot-de-passe-e2e-solide',
};

// Hachage argon2 du mot de passe de test calculé une seule fois par processus.
let adminPasswordHash: Promise<string> | undefined;

/**
 * Crée l'admin de test (base déjà vidée) et renvoie un JWT signé par le
 * `JwtService` de l'application (même charge utile que `POST /auth/login`).
 * La vraie connexion (argon2 `verify`) est couverte par `auth.e2e-spec.ts`,
 * le vrai hachage par `seed.e2e-spec.ts`.
 */
export async function seedAdminWithToken(
  app: NestExpressApplication,
): Promise<string> {
  adminPasswordHash ??= hash(TEST_ADMIN.password);
  const admin = await app.get(PrismaService).user.create({
    data: {
      email: TEST_ADMIN.email,
      name: TEST_ADMIN.name,
      passwordHash: await adminPasswordHash,
    },
  });
  return app.get(JwtService).signAsync({ sub: admin.id.toString() });
}
