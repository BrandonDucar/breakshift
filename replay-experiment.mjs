import { readFile, stat } from 'node:fs/promises';
import { MAX_EXPERIMENT_BYTES, parseAndReplayExperiment } from './public/experiment-replay.mjs';

try {
  if (process.argv.length !== 3) throw Error('USAGE: node replay-experiment.mjs <saved-experiment.json>');
  const path = process.argv[2], info = await stat(path);
  if (!info.isFile() || info.size > MAX_EXPERIMENT_BYTES) throw Error('EXPERIMENT_FILE_TOO_LARGE_OR_INVALID');
  console.log(JSON.stringify(parseAndReplayExperiment(await readFile(path, 'utf8')), null, 2));
} catch (error) {
  console.log(JSON.stringify({ status: 'REPLAY_REJECTED', reason: error.code || error.message, appliedToCurrentSession: false, providerCalls: 0 }));
  process.exitCode = 1;
}
