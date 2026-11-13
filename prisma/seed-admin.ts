import { hash } from 'argon2';
import type { PrismaClient } from '../src/generated/prisma/client.js';

export interface AdminSeedInput {
  email: string;
  name: string;
  password: string;
}

export type AdminSeedResult = 'created' | 'exists';

/**
 * Crée le compte admin s'il n'existe pas (PO-18) : un compte existant pour
 * cet e-mail n'est ni recréé ni modifié.
 */
export async function seedAdmin(
  prisma: PrismaClient,
  input: AdminSeedInput,
): Promise<AdminSeedResult> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    return 'exists';
  }

  await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hash(input.password),
    },
  });
  return 'created';
}
