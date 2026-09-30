module.exports = {
  cacheDirectory: '<rootDir>/.jest-cache',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  // Must run before any module that imports @stellar/stellar-sdk, including the
  // setupFilesAfterEnv matcher below — see tests/support/globals.ts.
  setupFiles: ['<rootDir>/tests/support/globals.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/support/scval-matchers.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  // Floor set just under the measured baseline (61.5% statements, 50.5% branches, 59.5% functions, 61.6% lines); ratchet towards 60 (see CONTRIBUTING.md).
  coverageThreshold: { global: { branches: 50, functions: 59, lines: 60, statements: 60 } },
};
