import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const manifest = JSON.parse(await readFile(new URL('./submission-manifest.json', import.meta.url)));
const child = spawnSync(process.execPath, ['--import', './offline-guard.mjs', '--test', '--test-reporter=tap', ...manifest.tests], {
  cwd: new URL('./', import.meta.url), encoding: 'utf8', timeout: 120000,
  maxBuffer: 4000000,
  env: { ...process.env, MUSE_SPARK_API_KEY: '', META_MODEL_API_KEY: '', BREAKSHIFT_MUSE_BUDGET_USD: '0' },
});
process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
assert.equal(child.status, 0, 'OFFLINE_TESTS_FAILED');
