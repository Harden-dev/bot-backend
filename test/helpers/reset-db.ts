import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Vide toutes les tables de la base de test (TRUNCATE remet aussi les
 * AUTO_INCREMENT à zéro). Les instructions passent par une transaction pour
 * rester sur la même connexion que `FOREIGN_KEY_CHECKS = 0`, remis à 1 même
 * si un TRUNCATE échoue.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET FOREIGN_KEY_CHECKS = 0`;
    try {
      await tx.$executeRaw`TRUNCATE TABLE order_status_history`;
      await tx.$executeRaw`TRUNCATE TABLE order_items`;
      await tx.$executeRaw`TRUNCATE TABLE orders`;
      await tx.$executeRaw`TRUNCATE TABLE order_drafts`;
      await tx.$executeRaw`TRUNCATE TABLE vendors`;
      await tx.$executeRaw`TRUNCATE TABLE daily_counters`;
      await tx.$executeRaw`TRUNCATE TABLE processed_messages`;
      await tx.$executeRaw`TRUNCATE TABLE webhook_logs`;
      await tx.$executeRaw`TRUNCATE TABLE users`;
    } finally {
      await tx.$executeRaw`SET FOREIGN_KEY_CHECKS = 1`;
    }
  });
}
