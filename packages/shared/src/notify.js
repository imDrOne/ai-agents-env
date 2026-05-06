import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_SOUNDS_DIR = path.join(os.homedir(), 'Documents', 'agent-env-sounds');
const LOG_FILE = path.join(os.tmpdir(), 'agent-env-notify.log');
export const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac)$/i;

export const CLAUDE_HOOK_EVENT_MAP = Object.freeze({
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
});

export const CLAUDE_NOTIFICATION_TYPE_MAP = Object.freeze({
  idle_prompt: 'idle_prompt',
  permission_prompt: 'permission_prompt',
});

export const CODEX_TYPE_MAP = Object.freeze({
  'agent-turn-complete': 'agent_turn_complete',
  'approval-requested': 'permission_prompt',
});

export const SUPPORTED_EVENTS = Object.freeze([
  'session_start',
  'session_end',
  'idle_prompt',
  'permission_prompt',
  'agent_turn_complete',
]);

export function classifyNotification(payload) {
  const hookEventName = payload?.hook_event_name ?? '';
  const notificationType = payload?.notification_type ?? '';
  const codexType = payload?.type ?? '';

  if (hookEventName) {
    if (hookEventName in CLAUDE_HOOK_EVENT_MAP) {
      return {
        client: 'claude',
        event: CLAUDE_HOOK_EVENT_MAP[hookEventName],
        shouldPlay: true,
        reason: 'claude-lifecycle',
      };
    }
    return { client: 'claude', event: 'unknown', shouldPlay: false, reason: 'unsupported' };
  }

  if (notificationType) {
    if (notificationType in CLAUDE_NOTIFICATION_TYPE_MAP) {
      return {
        client: 'claude',
        event: CLAUDE_NOTIFICATION_TYPE_MAP[notificationType],
        shouldPlay: true,
        reason: 'claude-attention',
      };
    }
    return { client: 'claude', event: 'unknown', shouldPlay: false, reason: 'unsupported' };
  }

  if (codexType) {
    if (codexType in CODEX_TYPE_MAP) {
      return {
        client: 'codex',
        event: CODEX_TYPE_MAP[codexType],
        shouldPlay: true,
        reason: 'codex-event',
      };
    }
    return { client: 'codex', event: 'unknown', shouldPlay: false, reason: 'unsupported' };
  }

  return { client: 'unknown', event: 'unknown', shouldPlay: false, reason: 'unsupported' };
}

export function getSoundsDir(env = process.env) {
  return env.AGENT_SOUNDS_DIR || DEFAULT_SOUNDS_DIR;
}

export function getSoundFiles(dir = getSoundsDir()) {
  try {
    return fs
      .readdirSync(dir)
      .filter(fileName => AUDIO_EXT_RE.test(fileName))
      .map(name => ({ name, path: path.join(dir, name), exists: true }));
  } catch {
    return [];
  }
}

export function resolveSoundPool(event, cfg, soundsDir = getSoundsDir()) {
  const eventSounds = cfg?.notifications?.eventSounds?.[event];
  if (Array.isArray(eventSounds) && eventSounds.length > 0) {
    const existing = eventSounds
      .map(name => ({ name, path: path.join(soundsDir, name) }))
      .filter(file => fileExists(file.path));
    if (existing.length > 0) return existing;
  }
  return getSoundFiles(soundsDir).filter(file => file.exists);
}

export function playSound(event, cfg, deps = {}) {
  const soundsDir = cfg?.notifications?.soundDir || deps.getSoundsDir?.() || getSoundsDir();
  const pool = event ? resolveSoundPool(event, cfg, soundsDir) : getSoundFiles(soundsDir);
  if (pool.length === 0) return null;
  const random = deps.random ?? Math.random;
  const pick = pool[Math.floor(random() * pool.length)];
  const playSoundFileFn = deps.playSoundFile ?? playSoundFile;
  playSoundFileFn(pick.path);
  return pick;
}

export function playSoundFile(filePath, spawnSyncImpl = spawnSync) {
  if (process.platform === 'darwin') {
    spawnSyncImpl('afplay', [filePath], { stdio: 'ignore' });
    return;
  }
  if (process.platform === 'win32') {
    spawnSyncImpl(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([System.Uri]${JSON.stringify(filePath)}); $p.Play(); Start-Sleep 5`,
      ],
      { stdio: 'ignore' },
    );
    return;
  }
  for (const player of ['paplay', 'aplay', 'mpv']) {
    const probe = spawnSyncImpl('which', [player], { encoding: 'utf8', stdio: 'pipe' });
    if (probe.status === 0) {
      spawnSyncImpl(player, [filePath], { stdio: 'ignore' });
      return;
    }
  }
}

export async function notifyMain(argv, deps = {}) {
  const logFn = deps.log ?? log;
  const readConfigFn = deps.readConfig ?? (() => ({}));
  const playSoundFn = deps.playSound ?? ((event, cfg) => playSound(event, cfg, deps));
  const readStdinFn = deps.readStdin ?? readStdin;
  const getSoundFilesFn = deps.getSoundFiles ?? getSoundFiles;
  const getSoundsDirFn = deps.getSoundsDir ?? getSoundsDir;
  const playSoundFileFn = deps.playSoundFile ?? playSoundFile;
  const random = deps.random ?? Math.random;

  if (argv[0] === 'test') {
    const available = getSoundFilesFn(getSoundsDirFn()).filter(file => file.exists);
    if (available.length === 0) return 0;
    const pick = available[Math.floor(random() * available.length)];
    playSoundFileFn(pick.path);
    return 0;
  }

  if (argv[0] === 'stop') {
    logFn(`[${new Date().toISOString()}] stop hook`);
    try {
      playSoundFn('agent_turn_complete', readConfigFn());
    } catch (error) {
      logFn(`[${new Date().toISOString()}] notify error: ${error}`);
      return 1;
    }
    return 0;
  }

  const raw = argv[0] ?? (await readStdinFn());
  if (!raw || !raw.trim()) return 0;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    logFn(`[${new Date().toISOString()}] json error: ${error} — raw=${raw.slice(0, 200)}`);
    return 1;
  }

  if (payload && payload['input-messages'] !== undefined && payload.input_messages === undefined) {
    payload.input_messages = payload['input-messages'];
  }

  const decision = classifyNotification(payload);
  logFn(
    `[${new Date().toISOString()}] client=${decision.client} event=${decision.event} reason=${decision.reason}`,
  );
  if (!decision.shouldPlay) return 0;

  try {
    playSoundFn(decision.event, readConfigFn());
  } catch (error) {
    logFn(`[${new Date().toISOString()}] notify error: ${error}`);
    return 1;
  }
  return 0;
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', () => resolve(''));
  });
}

function log(message) {
  try {
    fs.appendFileSync(LOG_FILE, `${message}\n`, 'utf8');
  } catch {
    // Ignore notification logging failures. Hooks must never block the agent.
  }
}

function fileExists(filePath) {
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}
