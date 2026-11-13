// Seed : crée le compte admin à partir de ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD.
// Lancé par `pnpm prisma db seed` (prisma.config.ts) ou `pnpm tsx prisma/seed.ts`.
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import Joi from 'joi';
import { envValidationSchema } from '../src/config/env.validation.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedAdmin } from './seed-admin.js';

interface SeedEnv {
  DATABASE_URL: string;
  ADMIN_EMAIL: string;
  ADMIN_NAME: string;
  ADMIN_PASSWORD: string;
}

// Mêmes règles que la configuration de l'application, limitées au seed.
const seedEnvSchema = Joi.object<SeedEnv>({
  DATABASE_URL: envValidationSchema.extract('DATABASE_URL'),
  ADMIN_EMAIL: envValidationSchema.extract('ADMIN_EMAIL'),
  ADMIN_NAME: envValidationSchema.extract('ADMIN_NAME'),
  ADMIN_PASSWORD: envValidationSchema.extract('ADMIN_PASSWORD'),
});

const logger = new Logger('Seed');

async function main(): Promise<void> {
  const { error, value: env } = seedEnvSchema.validate(process.env, {
    abortEarly: false,
    allowUnknown: true,
  });
  if (error) {
    throw new Error(`Configuration invalide : ${error.message}`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(env.DATABASE_URL),
  });
  try {
    const result = await seedAdmin(prisma, {
      email: env.ADMIN_EMAIL,
      name: env.ADMIN_NAME,
      password: env.ADMIN_PASSWORD,
    });
    logger.log(
      result === 'created'
        ? 'Compte admin créé'
        : 'Compte admin déjà présent : aucune modification',
    );
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
