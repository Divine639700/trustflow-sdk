const base = require('./jest.config');

/** End-to-end project: runs against a live Stellar network (see CONTRIBUTING.md). */
module.exports = {
  preset: base.preset,
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/**/*.e2e.test.ts'],
  setupFilesAfterEnv: base.setupFilesAfterEnv,
  testTimeout: 120_000,
  globals: base.globals,
};
