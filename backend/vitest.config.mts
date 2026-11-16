import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/wallet_test',
      JWT_SECRET: 'test-secret',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
