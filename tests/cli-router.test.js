import assert from 'node:assert/strict';
import test from 'node:test';

import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';
import { main as dashboardMain } from '../packages/dashboard/src/cli.js';

test('cac router preserves unknown command exit code', async () => {
  const lines = [];
  const code = await claudeMain(['does-not-exist'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 64);
  assert.match(lines.join('\n'), /Unknown command/);
});

test('cac router keeps shared project commands available', async () => {
  const lines = [];
  const code = await codexMain(['project', 'list'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /personal-workflow/);
});

test('dashboard router exposes status command', async () => {
  const lines = [];
  const code = await dashboardMain(['status'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  const body = JSON.parse(lines.join('\n'));
  assert.equal(Array.isArray(body.adapters), true);
});
