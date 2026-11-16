import { createApp } from './app';
import { config } from './config';
import { migrate } from './db/pool';
import { getSystemAccountId } from './services/ledger';
import { pool } from './db/pool';
import { logger } from './lib/logger';

async function main() {
  await migrate();
  await getSystemAccountId(pool, 'issuance');
  await getSystemAccountId(pool, 'fee_revenue');
  createApp().listen(config.port, () => {
    logger.info(`${config.appName} API démarrée sur http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
