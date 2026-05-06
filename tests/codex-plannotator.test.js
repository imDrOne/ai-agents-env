import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main as codexMain } from '../packages/codex-env/src/cli.js';
import { ensurePlannotatorInstalled } from '../packages/shared/src/index.js';

test('ensurePlannotatorInstalled dry-run reports official install script when binary is missing', () => {
  const lines = [];
  const calls = [];

  const result = ensurePlannotatorInstalled({
    dryRun: true,
    io: { out: message => lines.push(message), err: message => lines.push(message) },
    spawnSyncImpl: (command, args) => {
      calls.push([command, args]);
      return { status: 1, stdout: '', stderr: '' };
    },
    platform: 'darwin',
  });

  assert.equal(result.ok, true);
  assert.equal(result.installed, false);
  assert.match(lines.join('\n'), /would install plannotator via https:\/\/plannotator\.ai\/install\.sh/);
  assert.deepEqual(calls, [['which', ['plannotator']]]);
});

test('ensurePlannotatorInstalled runs installer only when plannotator is missing', () => {
  const lines = [];
  const calls = [];

  const result = ensurePlannotatorInstalled({
    io: { out: message => lines.push(message), err: message => lines.push(message) },
    spawnSyncImpl: (command, args) => {
      calls.push([command, args]);
      if (command === 'which') return { status: 1, stdout: '', stderr: '' };
      if (command === 'bash') return { status: 0, stdout: '', stderr: '' };
      throw new Error(`unexpected command: ${command}`);
    },
    platform: 'linux',
  });

  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.match(lines.join('\n'), /plannotator installed via https:\/\/plannotator\.ai\/install\.sh/);
  assert.deepEqual(calls, [
    ['which', ['plannotator']],
    ['bash', ['-lc', 'curl -fsSL https://plannotator.ai/install.sh | bash']],
  ]);
});

test('codex-env install dry-run includes plannotator installation step when missing', async () => {
  const root = path.join(os.tmpdir(), 'codex-plannotator-dry-run');
  const lines = [];

  const code = await codexMain(['install', '--dry-run', '--home', path.join(root, '.codex')], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: '' }),
    platform: 'darwin',
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /would install plannotator via https:\/\/plannotator\.ai\/install\.sh/);
});
