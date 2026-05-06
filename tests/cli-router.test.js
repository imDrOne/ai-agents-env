import assert from 'node:assert/strict';
import test from 'node:test';

import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';
import { main as dashboardMain } from '../packages/dashboard/src/cli.js';
import { main as suiteMain } from '../src/cli.js';

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

test('agent top-level help includes shared and agent-specific commands', async () => {
  const claudeLines = [];
  const codexLines = [];

  assert.equal(
    await claudeMain(['--help'], {
      out: message => claudeLines.push(message),
      err: message => claudeLines.push(message),
    }),
    0,
  );
  assert.equal(
    await codexMain(['--help'], {
      out: message => codexLines.push(message),
      err: message => codexLines.push(message),
    }),
    0,
  );

  const claudeHelp = claudeLines.join('\n');
  const codexHelp = codexLines.join('\n');
  assert.match(claudeHelp, /claude-env plugins/);
  assert.match(claudeHelp, /claude-env project status/);
  assert.match(claudeHelp, /claude-env sound add/);
  assert.match(claudeHelp, /claude-env clean global/);
  assert.match(claudeHelp, /claude-env install \[--with-serena\]/);
  assert.match(codexHelp, /codex-env skills/);
  assert.match(codexHelp, /codex-env project status/);
  assert.match(codexHelp, /codex-env sound add/);
  assert.match(codexHelp, /codex-env clean global/);
  assert.match(codexHelp, /codex-env install \[--with-serena\]/);
});

test('shared command help is available from top-level flags', async () => {
  const lines = [];
  const code = await codexMain(['project', '--help'], {
    out: message => lines.push(message),
    err: message => lines.push(message),
  });

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /Usage: codex-env project <command>/);
  assert.match(lines.join('\n'), /project enable/);
});

test('suite dispatcher routes to child CLIs and preserves unknown exit code', async () => {
  const helpLines = [];
  const childLines = [];
  const errorLines = [];

  assert.equal(
    await suiteMain(['help'], {
      out: message => helpLines.push(message),
      err: message => helpLines.push(message),
    }),
    0,
  );
  assert.equal(
    await suiteMain(['codex-env', 'help'], {
      out: message => childLines.push(message),
      err: message => childLines.push(message),
    }),
    0,
  );
  assert.equal(
    await suiteMain(['missing'], {
      out: message => errorLines.push(message),
      err: message => errorLines.push(message),
    }),
    64,
  );

  assert.match(helpLines.join('\n'), /agent-env-suite codex-env/);
  assert.match(childLines.join('\n'), /codex-env project status/);
  assert.match(errorLines.join('\n'), /Unknown command: missing/);
});
