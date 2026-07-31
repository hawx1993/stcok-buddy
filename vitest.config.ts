import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
      include: [
        'electron/services/stock/discovery-market-summary.ts',
        'electron/services/stock/discovery-monthly-themes.ts',
        'electron/services/stock/discovery-hot-themes.ts',
        'electron/services/market-data/trade-date-resolver.ts',
        'electron/services/market-data/quality.ts',
        'src/shared/hot-stock-hints-service.ts',
      ],
      exclude: [
        'coverage/**',
        'dist/**',
        'dist-electron/**',
        'node_modules/**',
        'electron/selfchecks/**',
        'scripts/**',
        '**/*.config.*',
        '**/*.d.ts',
        '**/*.test.ts',
      ],
    },
  },
});
