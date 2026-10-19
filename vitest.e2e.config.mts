import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.mts';

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    setupFiles: ['test/utils/config-setup.mts'],
  },
});
