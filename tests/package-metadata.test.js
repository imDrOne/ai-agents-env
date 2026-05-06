import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('root package exposes production umbrella bins and publish files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, {
    'agent-env-suite': 'bin/agent-env-suite',
    'claude-env': 'packages/claude-env/bin/claude-env',
    'codex-env': 'packages/codex-env/bin/codex-env',
    'agent-env-dashboard': 'packages/dashboard/bin/agent-env-dashboard',
  });
  assert.deepEqual(pkg.files, [
    'bin/',
    'src/',
    'packages/',
    'packages/dashboard/web/dist/',
    'README.md',
  ]);
  assert.equal(pkg.scripts['pack:check'].includes('npm pack --dry-run'), true);
});

test('root bin files have node shebangs', () => {
  for (const binPath of [
    'bin/agent-env-suite',
    'packages/claude-env/bin/claude-env',
    'packages/codex-env/bin/codex-env',
    'packages/dashboard/bin/agent-env-dashboard',
  ]) {
    const text = fs.readFileSync(path.join(root, binPath), 'utf8');
    assert.match(text, /^#!\/usr\/bin\/env node/);
  }
});
