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
  assert.equal(plan.operations.some(op => op.kind === 'serenaWiring'), false);
  assert.equal(plan.operations.some(op => String(op.path).includes('.codex')), false);
});

test('codex install plan is agent-only and does not touch Claude paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const plan = createInstallPlan('codex', {
    home: path.join(root, '.codex'),
    dryRun: true,
  });

  assert.equal(plan.agent, 'codex');
  assert.equal(plan.withSerena, false);
  assert.equal(plan.operations.some(op => op.kind === 'serenaWiring'), false);
  assert.equal(plan.operations.some(op => String(op.path).includes('.claude')), false);
});

test('serena wiring is opt-in per selected agent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const plan = createInstallPlan('codex', {
    home: path.join(root, '.codex'),
    withSerena: true,
  });

  const serenaOps = plan.operations.filter(op => op.kind === 'serenaWiring');
  assert.equal(serenaOps.length, 1);
  assert.equal(serenaOps[0].agent, 'codex');
  assert.match(serenaOps[0].path, /\.codex/);
});

test('install execution writes only selected agent home', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-suite-'));
  const claudeHome = path.join(root, '.claude');
  executeInstallPlan(createInstallPlan('claude', { home: claudeHome }));

  assert.equal(fs.existsSync(path.join(claudeHome, 'claude-env.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
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
