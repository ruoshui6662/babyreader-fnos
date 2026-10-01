'use strict';

// Run against the isolated E2E fixture server with the release feature enabled.
// The default browser suite still verifies the feature-disabled fallback.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, [
  require.resolve('@playwright/test/cli'),
  'test', 'e2e/library-organization-live.spec.js', '--project=chromium'
], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, ZHENSHU_ENABLE_LIBRARY_ORGANIZATION: '1' }
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
