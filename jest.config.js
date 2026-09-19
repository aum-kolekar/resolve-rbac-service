module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/mockRedis.js', '<rootDir>/tests/setup/quietLogs.js'],
  clearMocks: true,
  testMatch: ['**/tests/**/*.test.js'],
};
