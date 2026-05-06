import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyNotification,
  notifyMain,
  resolveSoundPool,
} from '../packages/shared/src/notify.js';
import {
  addSoundsToLibrary,
  readAgentConfig,
  writeAgentConfig,
} from '../packages/shared/src/index.js';
import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';

function soundsFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sounds-'));
  fs.writeFileSync(path.join(dir, 'attention.mp3'), 'sound', 'utf8');
  fs.writeFileSync(path.join(dir, 'done.wav'), 'sound', 'utf8');
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'not sound', 'utf8');
  return dir;
}

test('classifyNotification supports Claude lifecycle and attention events', () => {
  assert.deepEqual(classifyNotification({ hook_event_name: 'SessionStart' }), {
    client: 'claude',
    event: 'session_start',
    shouldPlay: true,
    reason: 'claude-lifecycle',
  });
  assert.deepEqual(classifyNotification({ notification_type: 'permission_prompt' }), {
    client: 'claude',
    event: 'permission_prompt',
    shouldPlay: true,
    reason: 'claude-attention',
  });
});

test('classifyNotification supports Codex notification types', () => {
  assert.deepEqual(classifyNotification({ type: 'agent-turn-complete' }), {
    client: 'codex',
    event: 'agent_turn_complete',
    shouldPlay: true,
    reason: 'codex-event',
  });
  assert.deepEqual(classifyNotification({ type: 'approval-requested' }), {
    client: 'codex',
    event: 'permission_prompt',
    shouldPlay: true,
    reason: 'codex-event',
  });
});

test('classifyNotification rejects unsupported payloads', () => {
  assert.deepEqual(classifyNotification({ type: 'unknown' }), {
    client: 'codex',
    event: 'unknown',
    shouldPlay: false,
    reason: 'unsupported',
  });
  assert.equal(classifyNotification({}).shouldPlay, false);
});

test('resolveSoundPool uses per-event config before fallback pool', () => {
  const dir = soundsFixture();
  const cfg = {
    notifications: {
      eventSounds: {
        permission_prompt: ['attention.mp3', 'missing.mp3'],
      },
    },
  };

  assert.deepEqual(resolveSoundPool('permission_prompt', cfg, dir), [
    { name: 'attention.mp3', path: path.join(dir, 'attention.mp3') },
  ]);
  assert.deepEqual(
    resolveSoundPool('agent_turn_complete', cfg, dir)
      .map(file => file.name)
      .sort(),
    ['attention.mp3', 'done.wav'],
  );
});

test('addSoundsToLibrary copies supported sounds and renames conflicts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sound-add-'));
  const soundsDir = path.join(root, 'library');
  fs.mkdirSync(soundsDir, { recursive: true });
  fs.writeFileSync(path.join(soundsDir, 'attention.mp3'), 'existing', 'utf8');

  const sourceFile = path.join(root, 'attention.mp3');
  const sourceDir = path.join(root, 'folder');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(sourceFile, 'new', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'done.wav'), 'sound', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'ignore.txt'), 'not sound', 'utf8');

  const result = addSoundsToLibrary([sourceFile, sourceDir], { soundDir: soundsDir });

  assert.deepEqual(result.added.map(file => file.name).sort(), ['attention-2.mp3', 'done.wav']);
  assert.equal(fs.readFileSync(path.join(soundsDir, 'attention-2.mp3'), 'utf8'), 'new');
  assert.deepEqual(
    result.skipped.map(skip => skip.reason),
    ['unsupported-extension'],
  );
});

test('agent sound-add alias copies sound and sound assign writes agent config', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sound-cli-'));
  const home = path.join(root, 'claude-home');
  const soundsDir = path.join(root, 'sounds');
  const source = path.join(root, 'attention.mp3');
  fs.writeFileSync(source, 'sound', 'utf8');

  const io = {
    env: { CLAUDE_HOME: home },
    isTTY: false,
    out: () => {},
    err: () => {},
  };

  assert.equal(await claudeMain(['sound-add', source, '--sound-dir', soundsDir], io), 0);
  assert.equal(fs.existsSync(path.join(soundsDir, 'attention.mp3')), true);
  assert.equal(readAgentConfig('claude', { home }).notifications.soundDir, soundsDir);

  assert.equal(
    await claudeMain(
      ['sound', 'assign', 'permission_prompt', 'attention.mp3', '--sound-dir', soundsDir],
      io,
    ),
    0,
  );

  assert.deepEqual(
    readAgentConfig('claude', { home }).notifications.eventSounds.permission_prompt,
    ['attention.mp3'],
  );
});

test('sound assign can run interactively with injected prompts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sound-interactive-'));
  const home = path.join(root, 'codex-home');
  const soundsDir = path.join(root, 'sounds');
  fs.mkdirSync(soundsDir, { recursive: true });
  fs.writeFileSync(path.join(soundsDir, 'done.wav'), 'sound', 'utf8');

  const prompts = {
    select: async () => 'agent_turn_complete',
    multiselect: async () => ['done.wav'],
    isCancel: () => false,
  };

  assert.equal(
    await codexMain(['sound', 'assign', '--sound-dir', soundsDir], {
      env: { CODEX_HOME: home },
      isTTY: false,
      out: () => {},
      err: () => {},
      prompts,
    }),
    0,
  );

  assert.deepEqual(
    readAgentConfig('codex', { home }).notifications.eventSounds.agent_turn_complete,
    ['done.wav'],
  );
});

test('agent notify commands read separate per-agent sound config', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notify-config-'));
  const claudeHome = path.join(root, 'claude-home');
  const codexHome = path.join(root, 'codex-home');
  const soundsDir = soundsFixture();

  writeAgentConfig(
    'claude',
    {
      version: 1,
      agent: 'claude',
      managedBy: 'claude-env',
      notifications: {
        soundDir: soundsDir,
        eventSounds: { permission_prompt: ['attention.mp3'] },
      },
    },
    { home: claudeHome },
  );
  writeAgentConfig(
    'codex',
    {
      version: 1,
      agent: 'codex',
      managedBy: 'codex-env',
      notifications: {
        soundDir: soundsDir,
        eventSounds: { permission_prompt: ['done.wav'] },
      },
    },
    { home: codexHome },
  );

  const seen = [];
  assert.equal(
    await claudeMain(['notify', JSON.stringify({ notification_type: 'permission_prompt' })], {
      env: { CLAUDE_HOME: claudeHome },
      out: () => {},
      err: () => {},
      notifyDeps: {
        playSound: (event, cfg) => seen.push({ agent: 'claude', event, cfg }),
        log: () => {},
      },
    }),
    0,
  );
  assert.equal(
    await codexMain(['notify', JSON.stringify({ type: 'approval-requested' })], {
      env: { CODEX_HOME: codexHome },
      out: () => {},
      err: () => {},
      notifyDeps: {
        playSound: (event, cfg) => seen.push({ agent: 'codex', event, cfg }),
        log: () => {},
      },
    }),
    0,
  );

  assert.deepEqual(
    seen.map(item => item.cfg.notifications.eventSounds.permission_prompt),
    [['attention.mp3'], ['done.wav']],
  );
});

test('notifyMain plays sound for Codex argv JSON payload', async () => {
  const played = [];
  const code = await notifyMain([JSON.stringify({ type: 'agent-turn-complete' })], {
    readConfig: () => ({ notifications: {} }),
    playSound: event => played.push(event),
    log: () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(played, ['agent_turn_complete']);
});

test('notifyMain reads Claude JSON payload from stdin dependency', async () => {
  const played = [];
  const code = await notifyMain([], {
    readStdin: async () => JSON.stringify({ notification_type: 'idle_prompt' }),
    readConfig: () => ({ notifications: {} }),
    playSound: event => played.push(event),
    log: () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(played, ['idle_prompt']);
});

test('notifyMain maps Claude stop hook to agent_turn_complete', async () => {
  const played = [];
  const code = await notifyMain(['stop'], {
    readConfig: () => ({ notifications: {} }),
    playSound: event => played.push(event),
    log: () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(played, ['agent_turn_complete']);
});

test('notifyMain returns 1 on invalid JSON', async () => {
  const code = await notifyMain(['{not-json'], {
    log: () => {},
  });

  assert.equal(code, 1);
});

test('notifyMain test command plays first available sound deterministically when random is injected', async () => {
  const dir = soundsFixture();
  const played = [];
  const code = await notifyMain(['test'], {
    getSoundsDir: () => dir,
    getSoundFiles: () => [
      { name: 'attention.mp3', path: path.join(dir, 'attention.mp3'), exists: true },
      { name: 'done.wav', path: path.join(dir, 'done.wav'), exists: true },
    ],
    random: () => 0,
    playSoundFile: filePath => played.push(filePath),
  });

  assert.equal(code, 0);
  assert.deepEqual(played, [path.join(dir, 'attention.mp3')]);
});

test('agent CLIs expose notify command', async () => {
  const claudePlayed = [];
  const codexPlayed = [];

  assert.equal(
    await claudeMain(['notify', JSON.stringify({ notification_type: 'permission_prompt' })], {
      out: () => {},
      err: () => {},
      notifyDeps: {
        readConfig: () => ({ notifications: {} }),
        playSound: event => claudePlayed.push(event),
        log: () => {},
      },
    }),
    0,
  );
  assert.equal(
    await codexMain(['notify', JSON.stringify({ type: 'approval-requested' })], {
      out: () => {},
      err: () => {},
      notifyDeps: {
        readConfig: () => ({ notifications: {} }),
        playSound: event => codexPlayed.push(event),
        log: () => {},
      },
    }),
    0,
  );

  assert.deepEqual(claudePlayed, ['permission_prompt']);
  assert.deepEqual(codexPlayed, ['permission_prompt']);
});
