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
    resolveSoundPool('agent_turn_complete', cfg, dir).map(file => file.name).sort(),
    ['attention.mp3', 'done.wav'],
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
