import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite({
      tsconfigFile: './tsconfig.test.json',
      module: { type: 'es6' },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/*.entity.ts',
        'src/**/*.schema.ts',
        'src/**/index.ts',
        'src/main.ts',
        'src/**/*.d.ts',
        'src/**/*.mock.ts',
        'src/**/*.stub.ts',
      ],
      thresholds: {
        statements: 54,
        branches: 59,
        functions: 52,
        lines: 54,
      },
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
    },
  },
});
