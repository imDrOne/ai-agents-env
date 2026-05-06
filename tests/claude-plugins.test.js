import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createClaudePluginPlan,
  installClaudePlugins,
  readClaudePluginManifest,
} from '../packages/claude-env/src/plugins.js';
import { main as claudeMain } from '../packages/claude-env/src/cli.js';

function writeFixture({ withPlannotator = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-plugins-'));
  const marketplacesFile = path.join(dir, 'marketplaces.txt');
  const pluginsFile = path.join(dir, 'plugins.txt');
  fs.writeFileSync(
    marketplacesFile,
    [
      '# marketplace name repo',
      'claude-plugins-official anthropics/claude-plugins-official',
      '',
      'caveman          JuliusBrussee/caveman',
      'plannotator      backnotprop/plannotator',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    pluginsFile,
    [
      '# plugin@marketplace',
      'frontend-design@claude-plugins-official',
      '',
      'superpowers@claude-plugins-official',
      'caveman@caveman',
      ...(withPlannotator ? ['plannotator@plannotator'] : []),
      '',
    ].join('\n'),
    'utf8',
  );
  return { dir, marketplacesFile, pluginsFile };
}

test('readClaudePluginManifest parses marketplaces and plugins', () => {
  const fixture = writeFixture();
  const manifest = readClaudePluginManifest(fixture);

  assert.deepEqual(manifest.marketplaces, [
    { name: 'claude-plugins-official', repo: 'anthropics/claude-plugins-official' },
    { name: 'caveman', repo: 'JuliusBrussee/caveman' },
    { name: 'plannotator', repo: 'backnotprop/plannotator' },
  ]);
  assert.deepEqual(manifest.plugins, [
    'frontend-design@claude-plugins-official',
    'superpowers@claude-plugins-official',
    'caveman@caveman',
  ]);
});

test('createClaudePluginPlan adds marketplaces before plugins', () => {
  const fixture = writeFixture();
  const plan = createClaudePluginPlan(fixture);

  assert.deepEqual(
    plan.operations.map(op => op.kind),
    [
      'addMarketplace',
      'addMarketplace',
      'addMarketplace',
      'installPlugin',
      'installPlugin',
      'installPlugin',
    ],
  );
  assert.equal(plan.operations[0].repo, 'anthropics/claude-plugins-official');
  assert.equal(plan.operations[3].plugin, 'frontend-design@claude-plugins-official');
});

test('installClaudePlugins dry-run does not invoke claude CLI', () => {
  const fixture = writeFixture();
  const calls = [];
  const lines = [];
  const result = installClaudePlugins({
    ...fixture,
    dryRun: true,
    spawnSyncImpl: (...args) => {
      calls.push(args);
      return { status: 1 };
    },
    io: { out: message => lines.push(message), err: message => lines.push(message) },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(calls.length, 0);
  assert.match(lines.join('\n'), /would add marketplace: anthropics\/claude-plugins-official/);
  assert.match(lines.join('\n'), /would install plugin: superpowers@claude-plugins-official/);
});

test('installClaudePlugins dry-run checks plannotator binary when selected', () => {
  const fixture = writeFixture({ withPlannotator: true });
  const calls = [];
  const lines = [];
  const result = installClaudePlugins({
    ...fixture,
    dryRun: true,
    spawnSyncImpl: (command, args) => {
      calls.push([command, args]);
      return { status: 1, stdout: '', stderr: '' };
    },
    io: { out: message => lines.push(message), err: message => lines.push(message) },
    platform: 'darwin',
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(calls, [['which', ['plannotator']]]);
  assert.match(lines.join('\n'), /would install plugin: plannotator@plannotator/);
  assert.match(lines.join('\n'), /would install plannotator via https:\/\/plannotator\.ai\/install\.sh/);
});

test('installClaudePlugins invokes Claude marketplace and plugin commands', () => {
  const fixture = writeFixture();
  const calls = [];
  const result = installClaudePlugins({
    ...fixture,
    spawnSyncImpl: (cmd, args) => {
      calls.push([cmd, args]);
      return { status: 0, stdout: '', stderr: '' };
    },
    io: { out: () => {}, err: () => {} },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['claude', ['--version']]);
  assert.deepEqual(calls[1], [
    'claude',
    ['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'],
  ]);
  assert.deepEqual(calls.at(-1), [
    'claude',
    ['plugin', 'install', 'caveman@caveman', '--scope', 'user'],
  ]);
});

test('installClaudePlugins treats already-configured marketplaces as ok', () => {
  const fixture = writeFixture();
  const result = installClaudePlugins({
    ...fixture,
    spawnSyncImpl: (cmd, args) => {
      if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' };
      if (args.includes('marketplace')) return { status: 1, stdout: '', stderr: 'already exists' };
      return { status: 0, stdout: '', stderr: '' };
    },
    io: { out: () => {}, err: () => {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.marketplacesAdded, 0);
  assert.equal(result.marketplacesAlreadyConfigured, 3);
  assert.equal(result.pluginsInstalled, 3);
});

test('installClaudePlugins reports hard marketplace or plugin failures', () => {
  const fixture = writeFixture();
  const result = installClaudePlugins({
    ...fixture,
    spawnSyncImpl: (cmd, args) => {
      if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' };
      if (args.includes('marketplace')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('superpowers@claude-plugins-official')) {
        return { status: 1, stdout: '', stderr: 'network unavailable' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    io: { out: () => {}, err: () => {} },
  });

  assert.equal(result.ok, false);
  assert.equal(result.pluginsFailed, 1);
});

test('claude-env plugins install returns non-zero on hard plugin failures', async () => {
  const fixture = writeFixture();
  const code = await claudeMain(
    [
      'plugins',
      'install',
      '--plugins-file',
      fixture.pluginsFile,
      '--marketplaces-file',
      fixture.marketplacesFile,
    ],
    {
      out: () => {},
      err: () => {},
      spawnSyncImpl: (cmd, args) => {
        if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' };
        if (args.includes('marketplace')) return { status: 0, stdout: '', stderr: '' };
        return { status: 1, stdout: '', stderr: 'not found' };
      },
    },
  );

  assert.equal(code, 1);
});

test('claude-env plugins install ensures plannotator before installing plugin', async () => {
  const fixture = writeFixture({ withPlannotator: true });
  const calls = [];
  const lines = [];
  const code = await claudeMain(
    [
      'plugins',
      'install',
      '--plugins-file',
      fixture.pluginsFile,
      '--marketplaces-file',
      fixture.marketplacesFile,
    ],
    {
      out: message => lines.push(message),
      err: message => lines.push(message),
      spawnSyncImpl: (cmd, args) => {
        calls.push([cmd, args]);
        if (cmd === 'which') return { status: 1, stdout: '', stderr: '' };
        if (cmd === 'bash') return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
      platform: 'linux',
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(calls[0], ['which', ['plannotator']]);
  assert.deepEqual(calls[1], [
    'bash',
    ['-lc', 'curl -fsSL https://plannotator.ai/install.sh | bash'],
  ]);
  assert.deepEqual(calls[2], ['claude', ['--version']]);
  assert.match(lines.join('\n'), /plannotator installed via https:\/\/plannotator\.ai\/install\.sh/);
  assert.match(lines.join('\n'), /plugin installed: plannotator@plannotator/);
});

test('installClaudePlugins skips gracefully when Claude CLI is missing', () => {
  const fixture = writeFixture();
  const result = installClaudePlugins({
    ...fixture,
    spawnSyncImpl: () => ({ status: 127, error: new Error('not found') }),
    io: { out: () => {}, err: () => {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'claude-cli-not-found');
});

test('claude-env plugins install command supports dry-run manifest files', async () => {
  const fixture = writeFixture();
  const lines = [];
  const code = await claudeMain(
    [
      'plugins',
      'install',
      '--dry-run',
      '--plugins-file',
      fixture.pluginsFile,
      '--marketplaces-file',
      fixture.marketplacesFile,
    ],
    { out: message => lines.push(message), err: message => lines.push(message) },
  );

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /would install plugin: frontend-design@claude-plugins-official/);
});

test('claude-env install runs plugin dry-run by default', async () => {
  const fixture = writeFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-install-'));
  const lines = [];
  const code = await claudeMain(
    [
      'install',
      '--dry-run',
      '--home',
      path.join(root, '.claude'),
      '--plugins-file',
      fixture.pluginsFile,
      '--marketplaces-file',
      fixture.marketplacesFile,
    ],
    { out: message => lines.push(message), err: message => lines.push(message) },
  );

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /ensure directory .*\.claude/);
  assert.match(lines.join('\n'), /would add marketplace: anthropics\/claude-plugins-official/);
  assert.match(lines.join('\n'), /would install plugin: caveman@caveman/);
});

test('claude-env install can skip plugin flow explicitly', async () => {
  const fixture = writeFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-install-'));
  const lines = [];
  const code = await claudeMain(
    [
      'install',
      '--dry-run',
      '--skip-plugins',
      '--home',
      path.join(root, '.claude'),
      '--plugins-file',
      fixture.pluginsFile,
      '--marketplaces-file',
      fixture.marketplacesFile,
    ],
    { out: message => lines.push(message), err: message => lines.push(message) },
  );

  assert.equal(code, 0);
  assert.doesNotMatch(lines.join('\n'), /would install plugin/);
});
