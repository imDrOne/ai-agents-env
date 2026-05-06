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
  assert.deepEqual(calls, []);
});
