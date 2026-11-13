-- Retour arrière de la migration 20261113121425_init (non exécuté par Prisma).
-- Généré par : prisma migrate diff --from-schema prisma/schema.prisma --to-empty --script
-- DESTRUCTIF : supprime les 9 tables et toutes leurs données.
-- Préalable obligatoire : sauvegarde complète (mysqldump --single-transaction --routines <base> > sauvegarde.sql).
-- Application : mysql <base> < down.sql, puis supprimer la ligne correspondante de _prisma_migrations
--   (ou : prisma migrate resolve --rolled-back 20261113121425_init).

-- DropForeignKey
ALTER TABLE `orders` DROP FOREIGN KEY `fk_orders_vendor`;

-- DropForeignKey
ALTER TABLE `order_items` DROP FOREIGN KEY `fk_items_order`;

-- DropForeignKey
ALTER TABLE `order_status_history` DROP FOREIGN KEY `fk_hist_order`;

-- DropForeignKey
ALTER TABLE `order_drafts` DROP FOREIGN KEY `fk_drafts_vendor`;

-- DropTable
DROP TABLE `vendors`;

-- DropTable
DROP TABLE `users`;

-- DropTable
DROP TABLE `orders`;

-- DropTable
DROP TABLE `order_items`;

-- DropTable
DROP TABLE `order_status_history`;

-- DropTable
DROP TABLE `order_drafts`;

-- DropTable
DROP TABLE `daily_counters`;

-- DropTable
DROP TABLE `processed_messages`;

-- DropTable
DROP TABLE `webhook_logs`;

