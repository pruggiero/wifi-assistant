import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env') });

export default defineConfig({
  test: {
    globals: true,
    include: ['src/test/*.eval.test.ts'],
    testTimeout: 30000,
  },
});
