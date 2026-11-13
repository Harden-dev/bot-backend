import type { PrismaClient } from '../../src/generated/prisma/client.js';

type Db = Pick<PrismaClient, '$executeRaw'>;

/** Table interne de Prisma, jamais vidée. */
const PRISMA_MIGRATIONS_TABLE = '_prisma_migrations';

/**
 * Remise à 1 de l'AUTO_INCREMENT, par table (gabarits étiquetés : aucun nom
 * de table interpolé). `daily_counters` n'en a pas.
 */
const RESET_AUTO_INCREMENT: Record<string, (db: Db) => Promise<number>> = {
  order_status_history: (db) =>
    db.$executeRaw`ALTER TABLE order_status_history AUTO_INCREMENT = 1`,
  order_items: (db) =>
    db.$executeRaw`ALTER TABLE order_items AUTO_INCREMENT = 1`,
  orders: (db) => db.$executeRaw`ALTER TABLE orders AUTO_INCREMENT = 1`,
  order_drafts: (db) =>
    db.$executeRaw`ALTER TABLE order_drafts AUTO_INCREMENT = 1`,
  vendors: (db) => db.$executeRaw`ALTER TABLE vendors AUTO_INCREMENT = 1`,
  processed_messages: (db) =>
    db.$executeRaw`ALTER TABLE processed_messages AUTO_INCREMENT = 1`,
  webhook_logs: (db) =>
    db.$executeRaw`ALTER TABLE webhook_logs AUTO_INCREMENT = 1`,
  users: (db) => db.$executeRaw`ALTER TABLE users AUTO_INCREMENT = 1`,
};

/**
 * Vide toutes les tables de la base de test et remet leurs identifiants à 1,
 * comme un TRUNCATE, mais environ 10 fois plus vite : `DELETE` (tables de
 * quelques lignes), puis `ALTER TABLE … AUTO_INCREMENT = 1` seulement pour
 * les tables dont le compteur a bougé (y compris par une insertion annulée).
 * `information_schema_stats_expiry = 0` : compteur lu en direct, pas dans le
 * cache des statistiques (variable de MySQL 8 uniquement : ce helper ne
 * fonctionne pas tel quel sur MariaDB ni sur MySQL 5.7). Une table inconnue
 * (ajoutée au schéma sans être ajoutée ici) lève une erreur explicite. Les instructions passent par une transaction pour
 * rester sur la même connexion que `FOREIGN_KEY_CHECKS = 0`, remis à 1 même
 * si un `DELETE` échoue.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const moved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET SESSION information_schema_stats_expiry = 0`;
    const tables = await tx.$queryRaw<{ name: string }[]>`
      SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND AUTO_INCREMENT > 1`;
    await tx.$executeRaw`SET FOREIGN_KEY_CHECKS = 0`;
    try {
      await tx.$executeRaw`DELETE FROM order_status_history`;
      await tx.$executeRaw`DELETE FROM order_items`;
      await tx.$executeRaw`DELETE FROM orders`;
      await tx.$executeRaw`DELETE FROM order_drafts`;
      await tx.$executeRaw`DELETE FROM vendors`;
      await tx.$executeRaw`DELETE FROM daily_counters`;
      await tx.$executeRaw`DELETE FROM processed_messages`;
      await tx.$executeRaw`DELETE FROM webhook_logs`;
      await tx.$executeRaw`DELETE FROM users`;
    } finally {
      await tx.$executeRaw`SET FOREIGN_KEY_CHECKS = 1`;
    }
    return tables.map(({ name }) => name);
  });
  // Après le COMMIT : un ALTER TABLE valide implicitement la transaction.
  for (const table of moved) {
    if (table === PRISMA_MIGRATIONS_TABLE) {
      continue;
    }
    const reset = RESET_AUTO_INCREMENT[table];
    if (!reset) {
      throw new Error(
        `resetDb : table ${table} inconnue, à ajouter aux DELETE et à RESET_AUTO_INCREMENT`,
      );
    }
    await reset(prisma);
  }
}
