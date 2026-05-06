import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createStatuslineInstallPlan,
  executeStatuslineInstallPlan,
  getStatuslineStatus,
  mockStatuslineData,
  renderStatusline,
  statuslineMain,
} from '@agent-env/shared';
import { main as claudeMain } from '../packages/claude-env/src/cli.js';

test('renderStatusline uses draft default payload fields', () => {
  const output = renderStatusline(mockStatuslineData(), {
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-render-')),
  });

  assert.match(output, /claude-opus-4-7/);
  assert.match(output, /ctx/);
  assert.match(output, /5h/);
});

test('statuslineMain exits gracefully on invalid JSON', () => {
  let output = '';
  const code = statuslineMain([], {
    stdin: '{bad',
    out: value => {
      output += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(output, '\n');
});

test('statusline install merges settings without removing user keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-install-'));
  const home = path.join(root, '.claude');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({ env: { KEEP: '1' }, hooks: { Notification: [] } }, null, 2),
    'utf8',
  );

  const plan = createStatuslineInstallPlan({ home, command: 'node claude-env statusline' });
  const result = executeStatuslineInstallPlan(plan);
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));

  assert.equal(result.skipped.length, 0);
  assert.equal(settings.env.KEEP, '1');
  assert.deepEqual(settings.hooks, { Notification: [] });
  assert.equal(settings.statusLine.command, 'node claude-env statusline');
  assert.equal(fs.existsSync(path.join(home, 'statusline.json')), true);
});

test('statusline install preserves foreign statusLine unless forced', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-conflict-'));
  const home = path.join(root, '.claude');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'custom' } }, null, 2),
    'utf8',
  );

  const skipped = executeStatuslineInstallPlan(
    createStatuslineInstallPlan({ home, command: 'managed' }),
  );
  let settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(skipped.skipped[0].reason, 'existing-statusline');
  assert.equal(settings.statusLine.command, 'custom');

  executeStatuslineInstallPlan(createStatuslineInstallPlan({ home, command: 'managed', force: true }));
  settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(settings.statusLine.command, 'managed');
});

test('getStatuslineStatus reports installed managed statusline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-status-'));
  const home = path.join(root, '.claude');
  const command = 'node claude-env statusline';
  executeStatuslineInstallPlan(createStatuslineInstallPlan({ home, command }));

  const status = getStatuslineStatus({ home, command });

  assert.equal(status.installed, true);
  assert.equal(status.conflict, false);
  assert.match(status.preview, /claude-opus-4-7/);
});

test('claude-env statusline preview and install commands work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-cli-'));
  const home = path.join(root, '.claude');
  const lines = [];

  assert.equal(
    await claudeMain(['statusline', 'preview'], {
      out: message => lines.push(message),
      err: message => lines.push(message),
    }),
    0,
  );
  assert.match(lines.join('\n'), /claude-opus-4-7/);

  assert.equal(
    await claudeMain(['statusline', 'install', '--home', home], {
      out: message => lines.push(message),
      err: message => lines.push(message),
    }),
    0,
  );
  assert.equal(fs.existsSync(path.join(home, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(home, 'statusline.json')), true);
});
