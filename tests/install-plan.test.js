import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createInstallPlan, executeInstallPlan } from '../packages/shared/src/index.js';
import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';

test('claude install plan is agent-only and does not touch Codex paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const plan = createInstallPlan('claude', {
    home: path.join(root, '.claude'),
    dryRun: true,
  });

  assert.equal(plan.agent, 'claude');
  assert.equal(plan.withSerena, false);
  assert.equal(
    plan.operations.some(op => op.kind === 'serenaWiring'),
    false,
  );
  assert.equal(
    plan.operations.some(op => String(op.path).includes('.codex')),
    false,
  );
});

test('codex install plan is agent-only and does not touch Claude paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const plan = createInstallPlan('codex', {
    home: path.join(root, '.codex'),
    dryRun: true,
  });

  assert.equal(plan.agent, 'codex');
  assert.equal(plan.withSerena, false);
  assert.equal(
    plan.operations.some(op => op.kind === 'serenaWiring'),
    false,
  );
  assert.equal(
    plan.operations.some(op => String(op.path).includes('.claude')),
    false,
  );
});

test('install plan no longer writes placeholder serena wiring files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const plan = createInstallPlan('codex', {
    home: path.join(root, '.codex'),
    withSerena: true,
  });

  assert.equal(plan.withSerena, true);
  assert.equal(
    plan.operations.some(op => op.kind === 'serenaWiring' || String(op.path).endsWith('serena.mcp.json')),
    false,
  );
});

test('install execution writes only selected agent home', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const claudeHome = path.join(root, '.claude');
  executeInstallPlan(createInstallPlan('claude', { home: claudeHome }));

  assert.equal(fs.existsSync(path.join(claudeHome, 'claude-env.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
});

test('claude install plan configures statusline by default and can skip it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const home = path.join(root, '.claude');
  const plan = createInstallPlan('claude', { home, dryRun: true });
  const skipped = createInstallPlan('claude', { home, dryRun: true, withStatusline: false });

  assert.equal(
    plan.operations.some(op => op.kind === 'mergeClaudeStatusLine' && op.path.endsWith('settings.json')),
    true,
  );
  assert.equal(
    plan.operations.some(op => op.kind === 'writeStatuslineConfig' && op.path.endsWith('statusline.json')),
    true,
  );
  assert.equal(
    skipped.operations.some(op => op.kind === 'mergeClaudeStatusLine' || op.kind === 'writeStatuslineConfig'),
    false,
  );
});

test('claude install plan configures notification hooks by default and can skip them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const home = path.join(root, '.claude');
  const plan = createInstallPlan('claude', { home, dryRun: true });
  const skipped = createInstallPlan('claude', {
    home,
    dryRun: true,
    withNotifications: false,
  });

  assert.equal(plan.operations.some(op => op.kind === 'mergeClaudeHooks'), true);
  assert.equal(skipped.operations.some(op => op.kind === 'mergeClaudeHooks'), false);
});

test('claude install writes managed notification hooks without removing user hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const home = path.join(root, '.claude');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify(
      {
        env: { KEEP: '1' },
        hooks: {
          Notification: [
            {
              matcher: 'auth_success',
              hooks: [{ type: 'command', command: 'custom-notify' }],
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  executeInstallPlan(createInstallPlan('claude', { home, withStatusline: false }));

  const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(settings.env.KEEP, '1');
  assert.equal(settings.hooks.Notification.length, 2);
  assert.deepEqual(settings.hooks.Notification[0], {
    matcher: 'auth_success',
    hooks: [{ type: 'command', command: 'custom-notify' }],
  });
  assert.match(settings.hooks.Notification[1].hooks[0].command, /claude-env"\s+notify$/);
  assert.equal(settings.hooks.Notification[1].matcher, 'permission_prompt|idle_prompt');
  assert.match(settings.hooks.Stop[0].hooks[0].command, /claude-env"\s+notify\s+stop$/);
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /claude-env"\s+notify$/);
  assert.match(settings.hooks.SessionEnd[0].hooks[0].command, /claude-env"\s+notify$/);
});

test('agent CLIs expose dry-run install without cross-agent operations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const claudeOut = [];
  const codexOut = [];

  assert.equal(
    await claudeMain(['install', '--dry-run', '--home', path.join(root, '.claude')], {
      out: message => claudeOut.push(message),
      err: message => claudeOut.push(message),
    }),
    0,
  );
  assert.equal(
    await codexMain(['install', '--dry-run', '--home', path.join(root, '.codex')], {
      out: message => codexOut.push(message),
      err: message => codexOut.push(message),
      spawnSyncImpl: () => ({ status: 0, stdout: '/usr/local/bin/plannotator\n', stderr: '' }),
    }),
    0,
  );

  assert.doesNotMatch(claudeOut.join('\n'), /\.codex/);
  assert.doesNotMatch(codexOut.join('\n'), /\.claude/);
});

test('codex install with serena writes native MCP config when command is resolved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-serena-'));
  const home = path.join(root, '.codex');
  const lines = [];

  const code = await codexMain(['install', '--with-serena', '--home', home], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    serenaCommand: '/Users/test/.local/bin/serena',
    spawnSyncImpl: () => ({ status: 0, stdout: '/usr/local/bin/plannotator\n', stderr: '' }),
  });

  assert.equal(code, 0);
  const config = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  assert.match(config, /\[mcp_servers\.serena\]/);
  assert.match(config, /--context=codex/);
  assert.equal(fs.existsSync(path.join(home, 'serena.mcp.json')), false);
});

test('claude install with serena dry-run reports native MCP config without invoking claude', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-serena-'));
  const lines = [];
  const calls = [];

  const code = await claudeMain(['install', '--with-serena', '--dry-run', '--home', path.join(root, '.claude')], {
    out: message => lines.push(message),
    err: message => lines.push(message),
    spawnSyncImpl: (command, args) => {
      calls.push([command, args]);
      return { status: 1, stdout: '' };
    },
    serenaCommand: '/Users/test/.local/bin/serena',
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /would configure Claude Serena MCP/);
  assert.deepEqual(calls, [['which', ['plannotator']]]);
  assert.equal(calls.some(([command]) => command === 'claude'), false);
});
