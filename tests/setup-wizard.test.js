import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createClackPromptAdapter } from '../packages/shared/src/prompts.js';
import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';
import { main as dashboardMain } from '../packages/dashboard/src/cli.js';

function fakePrompts(answers) {
  const calls = [];
  return {
    calls,
    intro: message => calls.push(['intro', message]),
    outro: message => calls.push(['outro', message]),
    cancel: message => calls.push(['cancel', message]),
    isCancel: value => value === Symbol.for('cancel'),
    text: async opts => {
      calls.push(['text', opts.message]);
      return answers.shift();
    },
    confirm: async opts => {
      calls.push(['confirm', opts.message]);
      return answers.shift();
    },
    select: async opts => {
      calls.push(['select', opts.message]);
      return answers.shift();
    },
    multiselect: async opts => {
      calls.push(['multiselect', opts.message]);
      return answers.shift();
    },
  };
}

test('createClackPromptAdapter exposes required prompt methods', () => {
  const adapter = createClackPromptAdapter();
  for (const method of ['intro', 'outro', 'cancel', 'isCancel', 'text', 'confirm', 'select', 'multiselect']) {
    assert.equal(typeof adapter[method], 'function');
  }
});

test('claude-env setup builds dry-run install and plugin flow from prompt answers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-setup-'));
  const prompts = fakePrompts([
    path.join(root, '.claude'),
    ['plugins', 'notifications'],
    true,
    ['superpowers@claude-plugins-official'],
  ]);
  const lines = [];

  const code = await claudeMain(['setup'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    prompts,
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /ensure directory .*\.claude/);
  assert.match(lines.join('\n'), /would install plugin: superpowers@claude-plugins-official/);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.deepEqual(
    prompts.calls.map(call => call[0]),
    ['intro', 'text', 'multiselect', 'confirm', 'multiselect', 'outro'],
  );
});

test('codex-env setup can dry-run install plus skills sync', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-setup-'));
  const cacheRoot = path.join(root, 'cache');
  const agentsHome = path.join(root, 'agents');
  const skillDir = path.join(cacheRoot, 'caveman', 'caveman', 'v1', 'skills', 'caveman');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# caveman\n', 'utf8');

  const prompts = fakePrompts([
    path.join(root, '.codex'),
    ['notifications', 'skills'],
    true,
    cacheRoot,
    agentsHome,
  ]);
  const lines = [];

  const code = await codexMain(['setup'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    prompts,
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /ensure directory .*\.codex/);
  assert.match(lines.join('\n'), /would copy skill caveman/);
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
  assert.equal(fs.existsSync(path.join(agentsHome, 'skills', 'caveman')), false);
});

test('setup cancellation exits with 130 and does not mutate files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-setup-'));
  const prompts = fakePrompts([Symbol.for('cancel')]);
  const lines = [];

  const code = await claudeMain(['setup'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    prompts,
  });

  assert.equal(code, 130);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.deepEqual(prompts.calls.map(call => call[0]), ['intro', 'text', 'cancel']);
});

test('non-interactive setup refuses without prompt adapter or TTY', async () => {
  const lines = [];
  const code = await claudeMain(['setup'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    isTTY: false,
  });

  assert.equal(code, 1);
  assert.match(lines.join('\n'), /requires an interactive terminal/);
});

test('dashboard setup remains facade-only', async () => {
  const lines = [];
  const code = await dashboardMain(['setup'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /facade-only/);
});
