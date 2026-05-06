import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCodexSerenaConfig,
  buildSerenaNativeMcpConfig,
  resolveSerenaBinary,
} from '../packages/shared/src/index.js';

test('buildSerenaNativeMcpConfig uses native project-from-cwd args', () => {
  const config = buildSerenaNativeMcpConfig('/Users/test/.local/bin/serena', 'codex');

  assert.equal(config.type, 'stdio');
  assert.equal(config.command, '/Users/test/.local/bin/serena');
  assert.deepEqual(config.args, [
    'start-mcp-server',
    '--project-from-cwd',
    '--context=codex',
    '--enable-web-dashboard=true',
    '--open-web-dashboard=false',
  ]);
});

test('applyCodexSerenaConfig upserts native mcp_servers.serena section', () => {
  const input = [
    'model = "gpt-5.4"',
    '',
    '[features]',
    'multi_agent = true',
    '',
  ].join('\n');

  const output = applyCodexSerenaConfig(input, {
    enabled: true,
    serenaCommand: '/Users/test/.local/bin/serena',
  });

  assert.match(output, /\[mcp_servers\.serena\]/);
  assert.match(output, /startup_timeout_sec = 60/);
  assert.match(output, /command = "\/Users\/test\/\.local\/bin\/serena"/);
  assert.match(output, /--project-from-cwd/);
  assert.match(output, /\[features\]/);
});

test('applyCodexSerenaConfig removes stale serena section when disabled', () => {
  const input = `
[mcp_servers.serena]
startup_timeout_sec = 30
command = "/tmp/old-serena"
args = ["mcp"]

[profiles.default]
model = "gpt-5.4"
`;

  const output = applyCodexSerenaConfig(input, {
    enabled: false,
    serenaCommand: null,
  });

  assert.doesNotMatch(output, /\[mcp_servers\.serena\]/);
  assert.match(output, /\[profiles\.default\]/);
});

test('resolveSerenaBinary prefers uv tool bin shim when path lookup misses it', () => {
  const spawnSyncImpl = (command, args) => {
    if (command === 'which' && args[0] === 'uv') {
      return { status: 0, stdout: '/usr/local/bin/uv\n' };
    }
    if (command === '/usr/local/bin/uv' && args.join(' ') === 'tool dir --bin') {
      return { status: 0, stdout: '/Users/test/.local/bin\n' };
    }
    if (command === 'which' && args[0] === 'serena') {
      return { status: 1, stdout: '' };
    }
    return { status: 1, stdout: '' };
  };
  const existsSyncImpl = filePath => filePath === '/Users/test/.local/bin/serena';

  assert.equal(
    resolveSerenaBinary({
      spawnSyncImpl,
      existsSyncImpl,
      homeDir: '/Users/test',
      env: {},
      platform: 'darwin',
    }),
    '/Users/test/.local/bin/serena',
  );
});
