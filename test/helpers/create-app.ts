import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seedAdmin } from '../../prisma/seed-admin.js';
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

/** Crée l'admin de test (base déjà vidée) et renvoie son JWT. */
export async function seedAdminAndLogin(
  app: NestExpressApplication,
): Promise<string> {
  await seedAdmin(app.get(PrismaService), TEST_ADMIN);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password })
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}
