import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createGlobalCleanupPlan, executeCleanupPlan, formatCleanupPlan } from '@agent-env/shared';
import { initProjectProfile, projectProfilePath } from '@agent-env/shared';
import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('createGlobalCleanupPlan removes only managed Claude files and empty managed dirs by default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-'));
  const home = path.join(root, '.claude');
  writeFile(path.join(home, 'claude-env.json'), '{"managedBy":"claude-env"}\n');
  writeFile(path.join(home, 'CLAUDE.md'), '# Claude Environment\n\nManaged by claude-env.\n');
  fs.mkdirSync(path.join(home, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(home, 'hooks'), { recursive: true });
  writeFile(path.join(home, 'agents', 'custom.md'), 'user content\n');

  const plan = createGlobalCleanupPlan('claude', { home });

  assert.deepEqual(
    plan.operations.map(op => [op.kind, path.relative(home, op.path)]),
    [
      ['removeFile', 'claude-env.json'],
      ['removeFile', 'CLAUDE.md'],
      ['removeEmptyDir', 'commands'],
      ['removeEmptyDir', 'hooks'],
      ['removeEmptyDir', 'agents'],
      ['removeEmptyDir', ''],
    ],
  );
  assert.equal(
    plan.operations.find(op => op.path.endsWith('agents')).reason,
    'directory-not-empty',
  );
});

test('executeCleanupPlan respects dry-run and then removes safe files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-'));
  const home = path.join(root, '.codex');
  writeFile(path.join(home, 'codex-env.json'), '{"managedBy":"codex-env"}\n');
  writeFile(path.join(home, 'AGENTS.md'), '# Codex Environment\n\nManaged by codex-env.\n');
  fs.mkdirSync(path.join(home, 'rules'), { recursive: true });

  const plan = createGlobalCleanupPlan('codex', { home });
  const dryRun = executeCleanupPlan(plan, { dryRun: true });
  assert.equal(dryRun.removed.length, 0);
  assert.equal(fs.existsSync(path.join(home, 'codex-env.json')), true);

  const applied = executeCleanupPlan(plan);
  assert.equal(applied.skipped.length, 0);
  assert.equal(fs.existsSync(path.join(home, 'codex-env.json')), false);
  assert.equal(fs.existsSync(path.join(home, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(home), false);
});

test('cleanup plan skips user-modified managed-looking files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-'));
  const home = path.join(root, '.claude');
  writeFile(path.join(home, 'CLAUDE.md'), '# User edited\n');

  const plan = createGlobalCleanupPlan('claude', { home });
  const claudeMd = plan.operations.find(op => op.path.endsWith('CLAUDE.md'));

  assert.equal(claudeMd.kind, 'skip');
  assert.equal(claudeMd.reason, 'content-mismatch');
});

test('formatCleanupPlan marks dry-run removable and skipped operations', () => {
  const plan = {
    operations: [
      { kind: 'removeFile', path: '/tmp/a' },
      { kind: 'skip', path: '/tmp/b', reason: 'content-mismatch' },
    ],
  };

  assert.match(formatCleanupPlan(plan), /remove file \/tmp\/a/);
  assert.match(formatCleanupPlan(plan), /skip \/tmp\/b \(content-mismatch\)/);
});

test('agent clean global dry-run does not mutate home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.claude');
  writeFile(path.join(home, 'claude-env.json'), '{"managedBy":"claude-env"}\n');
  const lines = [];

  const code = await claudeMain(['clean', 'global', '--dry-run', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /remove file .*claude-env\.json/);
  assert.equal(fs.existsSync(path.join(home, 'claude-env.json')), true);
});

test('agent clean global applies safe cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.codex');
  writeFile(path.join(home, 'codex-env.json'), '{"managedBy":"codex-env"}\n');
  const lines = [];

  const code = await codexMain(['clean', 'global', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /Removed 2 item/);
  assert.equal(fs.existsSync(home), false);
});

test('agent clean global wipe dry-run does not mutate home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.claude');
  writeFile(path.join(home, 'custom', 'notes.md'), 'user content\n');
  const lines = [];

  const code = await claudeMain(['clean', 'global', '--wipe', '--dry-run', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /wipe directory .*\.claude/);
  assert.equal(fs.existsSync(path.join(home, 'custom', 'notes.md')), true);
});

test('codex global wipe dry-run includes agents home without mutating it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.codex');
  const agentsHome = path.join(root, '.agents');
  writeFile(path.join(home, 'custom.toml'), 'user content\n');
  writeFile(path.join(agentsHome, 'skills', 'personal-workflow', 'SKILL.md'), '# skill\n');
  const lines = [];

  const code = await codexMain(['clean', 'global', '--wipe', '--dry-run', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    env: { AGENTS_HOME: agentsHome },
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /wipe directory .*\.codex/);
  assert.match(lines.join('\n'), /wipe directory .*\.agents/);
  assert.equal(fs.existsSync(path.join(home, 'custom.toml')), true);
  assert.equal(fs.existsSync(path.join(agentsHome, 'skills', 'personal-workflow', 'SKILL.md')), true);
});

test('agent clean global wipe requires explicit confirmation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.codex');
  writeFile(path.join(home, 'user.toml'), 'custom = true\n');
  const lines = [];

  const code = await codexMain(['clean', 'global', '--wipe', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 1);
  assert.match(lines.join('\n'), /requires --confirm-wipe/);
  assert.equal(fs.existsSync(path.join(home, 'user.toml')), true);
});

test('agent clean global wipe removes full agent home when confirmed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  const agentsHome = path.join(root, '.agents');
  writeFile(path.join(home, 'plugins', 'cache', 'custom.txt'), 'plugin cache\n');
  writeFile(path.join(home, 'config.toml'), 'user edited\n');
  writeFile(path.join(claudeHome, 'CLAUDE.md'), 'do not touch\n');

  const code = await codexMain(['clean', 'global', '--wipe', '--confirm-wipe', '--home', home], {
    out: () => {},
    err: () => {},
    env: { AGENTS_HOME: agentsHome },
  });

  assert.equal(code, 0);
  assert.equal(fs.existsSync(home), false);
  assert.equal(fs.existsSync(path.join(claudeHome, 'CLAUDE.md')), true);
});

test('codex global wipe removes agents home when confirmed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.codex');
  const agentsHome = path.join(root, '.agents');
  writeFile(path.join(home, 'config.toml'), 'user edited\n');
  writeFile(path.join(agentsHome, 'skills', 'plannotator-compound', 'SKILL.md'), '# skill\n');

  const code = await codexMain(['clean', 'global', '--wipe', '--confirm-wipe', '--home', home], {
    out: () => {},
    err: () => {},
    env: { AGENTS_HOME: agentsHome },
  });

  assert.equal(code, 0);
  assert.equal(fs.existsSync(home), false);
  assert.equal(fs.existsSync(agentsHome), false);
});

test('codex global wipe refuses unsafe agents home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, '.codex');
  const unsafeAgentsHome = path.join(root, 'custom-agents');
  writeFile(path.join(home, 'config.toml'), 'user edited\n');
  writeFile(path.join(unsafeAgentsHome, 'sentinel.txt'), 'keep\n');
  const lines = [];

  const code = await codexMain(['clean', 'global', '--wipe', '--confirm-wipe', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    env: { AGENTS_HOME: unsafeAgentsHome },
  });

  assert.equal(code, 1);
  assert.match(lines.join('\n'), /Refusing to wipe unsafe home/);
  assert.equal(fs.existsSync(home), true);
  assert.equal(fs.existsSync(path.join(unsafeAgentsHome, 'sentinel.txt')), true);
});

test('executeCleanupPlan reports wipe ENOTEMPTY as skipped instead of throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-wipe-race-'));
  const home = path.join(root, '.codex');
  const agentsHome = path.join(root, '.agents');
  writeFile(path.join(home, 'logs_2.sqlite'), 'busy\n');
  const plan = createGlobalCleanupPlan('codex', { home, wipe: true, agentsHome });
  const originalRmSync = fs.rmSync;

  try {
    fs.rmSync = filePath => {
      if (filePath === home) {
        const error = new Error('Directory not empty');
        error.code = 'ENOTEMPTY';
        throw error;
      }
      originalRmSync(filePath, { recursive: true, force: true });
    };

    const result = executeCleanupPlan(plan);

    assert.equal(result.removed.length, 0);
    assert.deepEqual(
      result.skipped.map(op => [op.path, op.reason]),
      [[home, 'enotempty']],
    );
  } finally {
    fs.rmSync = originalRmSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('agent clean global wipe allows custom homes with agent evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const home = path.join(root, 'custom-codex-home');
  const agentsHome = path.join(root, '.agents');
  writeFile(path.join(home, 'AGENTS.md'), 'custom agent instructions\n');

  const code = await codexMain(['clean', 'global', '--wipe', '--confirm-wipe', '--home', home], {
    out: () => {},
    err: () => {},
    env: { AGENTS_HOME: agentsHome },
  });

  assert.equal(code, 0);
  assert.equal(fs.existsSync(home), false);
});

test('agent clean global wipe refuses unsafe homes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  const homeFile = path.join(root, 'sentinel.txt');
  writeFile(homeFile, 'keep\n');
  const lines = [];

  const code = await claudeMain(['clean', 'global', '--wipe', '--confirm-wipe', '--home', root], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 1);
  assert.match(lines.join('\n'), /Refusing to wipe unsafe home/);
  assert.equal(fs.existsSync(homeFile), true);
});

test('agent clean project removes selected project profile scope', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-project-'));
  initProjectProfile('claude', project, { scope: 'local' });
  initProjectProfile('claude', project, { scope: 'tracked' });

  const code = await claudeMain(['clean', 'project', '--local', '--project', project], {
    out: () => {},
    err: () => {},
  });

  assert.equal(code, 0);
  assert.equal(fs.existsSync(projectProfilePath('claude', project, 'local')), false);
  assert.equal(fs.existsSync(projectProfilePath('claude', project, 'tracked')), true);
});
