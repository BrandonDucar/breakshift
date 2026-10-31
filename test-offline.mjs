import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
try { await access(new URL('./.cf-preview/release.json', import.meta.url)); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error('BREAKSHIFT_BUILD_REQUIRED: run npm test (builds automatically), or npm run build before node test-offline.mjs.');
  process.exit(1);
}
const manifest = JSON.parse(await readFile(new URL('./submission-manifest.json', import.meta.url)));
const child = spawnSync(process.execPath, ['--import', './offline-guard.mjs', '--test', '--test-reporter=tap', ...manifest.tests], {
  cwd: new URL('./', import.meta.url), encoding: 'utf8', timeout: 120000,
  maxBuffer: 4000000,
  env: { ...process.env, MUSE_SPARK_API_KEY: '', META_MODEL_API_KEY: '', BREAKSHIFT_MUSE_BUDGET_USD: '0' },
});
process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
assert.equal(child.status, 0, 'OFFLINE_TESTS_FAILED');
