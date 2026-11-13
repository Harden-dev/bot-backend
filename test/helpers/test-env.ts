import { existsSync } from 'node:fs';
import { config } from 'dotenv';

// Les e2e utilisent la vraie base de test décrite dans `.env.test`
// (jamais la base de développement). `override` : le fichier l'emporte sur
// l'environnement du shell.
const TEST_ENV_FILE = '.env.test';
const TEST_DATABASE_SUFFIX = '_test';

if (!existsSync(TEST_ENV_FILE)) {
  throw new Error(
    `Fichier ${TEST_ENV_FILE} introuvable : créez-le à partir de .env.example (base commandes_test).`,
  );
}
config({ path: TEST_ENV_FILE, override: true, quiet: true });

const databaseName = new URL(process.env['DATABASE_URL'] ?? '').pathname.slice(
  1,
);
if (
  process.env['NODE_ENV'] !== 'test' ||
  !databaseName.endsWith(TEST_DATABASE_SUFFIX)
) {
  throw new Error(
    `${TEST_ENV_FILE} doit définir NODE_ENV=test et une base dont le nom finit par ${TEST_DATABASE_SUFFIX}.`,
  );
}
