import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AGENT_DEFINITIONS } from './install-plan.js';
import { AUDIO_EXT_RE, SUPPORTED_EVENTS, getSoundFiles, getSoundsDir } from './notify.js';

export const AGENT_SOUND_EVENTS = Object.freeze({
  claude: SUPPORTED_EVENTS,
  codex: Object.freeze(['permission_prompt', 'agent_turn_complete']),
});

export function agentConfigPath(agentId, options = {}) {
  const agent = requireAgent(agentId);
  const env = options.env ?? process.env;
  const home = options.home ?? env[agent.homeEnv] ?? agent.defaultHome();
  return path.join(home, `${agent.cli}.json`);
}

export function readAgentConfig(agentId, options = {}) {
  const filePath = options.configPath ?? agentConfigPath(agentId, options);
  if (!fs.existsSync(filePath)) return defaultAgentConfig(agentId);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    ...defaultAgentConfig(agentId),
    ...parsed,
    notifications: parsed.notifications ?? {},
  };
}

export function writeAgentConfig(agentId, config, options = {}) {
  const filePath = options.configPath ?? agentConfigPath(agentId, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return filePath;
}

export function getAgentSoundsDir(config = {}, options = {}) {
  return options.soundDir ?? config?.notifications?.soundDir ?? getSoundsDir(options.env);
}

export function addSoundsToLibrary(sources, options = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('At least one sound file or directory is required.');
  }

  const soundsDir = options.soundDir ?? getSoundsDir(options.env);
  fs.mkdirSync(soundsDir, { recursive: true });

  const added = [];
  const skipped = [];
  for (const source of sources) {
    const sourcePath = resolveUserPath(source);
    const stat = lstat(sourcePath);
    if (!stat) {
      skipped.push({ source, reason: 'missing' });
      continue;
    }

    const files = stat.isDirectory()
      ? fs.readdirSync(sourcePath).sort().map(name => path.join(sourcePath, name))
      : [sourcePath];

    for (const filePath of files) {
      const fileStat = lstat(filePath);
      if (!fileStat?.isFile()) {
        skipped.push({ source: filePath, reason: 'not-file' });
        continue;
      }
      if (!isAudioFileName(filePath)) {
        skipped.push({ source: filePath, reason: 'unsupported-extension' });
        continue;
      }

      const destination = uniqueDestination(soundsDir, path.basename(filePath));
      fs.copyFileSync(filePath, destination);
      added.push({ source: filePath, name: path.basename(destination), path: destination });
    }
  }

  return { soundsDir, added, skipped };
}

export function listSoundSettings(agentId, options = {}) {
  const config = readAgentConfig(agentId, options);
  const soundsDir = getAgentSoundsDir(config, options);
  return {
    agent: agentId,
    configPath: options.configPath ?? agentConfigPath(agentId, options),
    soundsDir,
    sounds: getSoundFiles(soundsDir),
    eventSounds: config.notifications?.eventSounds ?? {},
    events: AGENT_SOUND_EVENTS[agentId] ?? SUPPORTED_EVENTS,
  };
}

export function assignEventSounds(agentId, event, soundNames, options = {}) {
  validateAgentEvent(agentId, event);
  if (!Array.isArray(soundNames) || soundNames.length === 0) {
    throw new Error('At least one sound name is required.');
  }

  const config = readAgentConfig(agentId, options);
  const soundsDir = getAgentSoundsDir(config, options);
  const available = new Set(getSoundFiles(soundsDir).map(file => file.name));
  const missing = soundNames.filter(name => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`Unknown sound file(s): ${missing.join(', ')}`);
  }

  const next = {
    ...config,
    notifications: {
      ...(config.notifications ?? {}),
      soundDir: soundsDir,
      eventSounds: {
        ...(config.notifications?.eventSounds ?? {}),
        [event]: [...soundNames],
      },
    },
  };
  const configPath = writeAgentConfig(agentId, next, options);
  return { config: next, configPath, event, soundNames: [...soundNames], soundsDir };
}

export function updateAgentSoundDir(agentId, soundsDir, options = {}) {
  const config = readAgentConfig(agentId, options);
  const next = {
    ...config,
    notifications: {
      ...(config.notifications ?? {}),
      soundDir: soundsDir,
      eventSounds: config.notifications?.eventSounds ?? {},
    },
  };
  const configPath = writeAgentConfig(agentId, next, options);
  return { config: next, configPath, soundsDir };
}

export function validateAgentEvent(agentId, event) {
  requireAgent(agentId);
  const events = AGENT_SOUND_EVENTS[agentId] ?? SUPPORTED_EVENTS;
  if (!events.includes(event)) {
    throw new Error(`Unsupported ${agentId} event: ${event}. Supported events: ${events.join(', ')}`);
  }
}

export function isAudioFileName(fileName) {
  return AUDIO_EXT_RE.test(fileName);
}

function defaultAgentConfig(agentId) {
  const agent = requireAgent(agentId);
  return {
    version: 1,
    agent: agentId,
    managedBy: agent.cli,
    notifications: {},
  };
}

function requireAgent(agentId) {
  const agent = AGENT_DEFINITIONS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}

function resolveUserPath(input) {
  const home = process.env.HOME || os.homedir();
  if (input === '~') return home;
  if (input.startsWith('~/')) return path.join(home, input.slice(2));
  return path.resolve(input);
}

function uniqueDestination(dir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(dir, fileName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function lstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}
