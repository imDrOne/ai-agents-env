import fs from 'node:fs';
import path from 'node:path';
import { AGENT_DEFINITIONS } from './install-plan.js';
import { writeJsonFile } from './platform.js';

const CONFIG_VERSION = 1;
const FEATURE_TYPES = new Set(['plugin', 'plugins', 'skill', 'skills', 'hook', 'hooks', 'instruction', 'instructions']);

function normalizeFeatureType(type) {
  if (!FEATURE_TYPES.has(type)) throw new Error(`Unsupported feature type: ${type}`);
  if (type.endsWith('s')) return type;
  return `${type}s`;
}

export function projectProfilePath(agentId, projectPath, scope = 'local') {
  if (!AGENT_DEFINITIONS[agentId]) throw new Error(`Unknown agent: ${agentId}`);
  if (scope === 'local') return path.join(projectPath, '.agent-env.local', `${agentId}.json`);
  if (scope === 'tracked') return path.join(projectPath, '.agent-env', `${agentId}.json`);
  throw new Error(`Unsupported project profile scope: ${scope}`);
}

export function readProjectProfile(agentId, projectPath, scope = 'local') {
  const filePath = projectProfilePath(agentId, projectPath, scope);
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      profile: createEmptyProfile(agentId),
    };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    path: filePath,
    exists: true,
    profile: normalizeProfile(agentId, raw),
  };
}

export function listProjectFeatures(agentId) {
  const agent = AGENT_DEFINITIONS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return structuredClone(agent.defaultFeatures);
}

export function initProjectProfile(agentId, projectPath = process.cwd(), options = {}) {
  const scope = options.scope ?? 'local';
  if (scope === 'local') ensureLocalProfileIgnored(projectPath);
  const filePath = projectProfilePath(agentId, projectPath, scope);
  const profile = createEmptyProfile(agentId);
  writeJsonFile(filePath, profile);
  return { agent: agentId, scope, path: filePath, profile };
}

export function getProjectStatus(agentId, projectPath = process.cwd()) {
  const agent = AGENT_DEFINITIONS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const tracked = readProjectProfile(agentId, projectPath, 'tracked');
  const local = readProjectProfile(agentId, projectPath, 'local');
  const effective = structuredClone(agent.defaultFeatures);
  const sources = {};

  markSources(sources, agent.defaultFeatures, 'global');
  mergeOverrides(effective, sources, tracked.profile.features, 'tracked');
  mergeOverrides(effective, sources, local.profile.features, 'local');

  return {
    agent: agentId,
    projectPath,
    effective,
    sources,
    profiles: {
      tracked: { path: tracked.path, exists: tracked.exists },
      local: { path: local.path, exists: local.exists },
    },
  };
}

export function applyProjectFeatureChange(agentId, projectPath, change) {
  const scope = change.scope ?? 'local';
  const enabled = Boolean(change.enabled);
  const featureType = normalizeFeatureType(change.type);
  const name = change.name;
  if (!name) throw new Error('Feature name is required');

  const { path: filePath, profile } = readProjectProfile(agentId, projectPath, scope);
  if (scope === 'local') ensureLocalProfileIgnored(projectPath);
  profile.features[featureType] ??= {};
  profile.features[featureType][name] = enabled;
  writeJsonFile(filePath, profile);

  return {
    agent: agentId,
    scope,
    path: filePath,
    change: {
      type: featureType,
      name,
      enabled,
    },
  };
}

function createEmptyProfile(agentId) {
  return {
    version: CONFIG_VERSION,
    agent: agentId,
    features: {},
  };
}

function normalizeProfile(agentId, raw) {
  return {
    ...createEmptyProfile(agentId),
    ...raw,
    agent: agentId,
    features: raw?.features && typeof raw.features === 'object' ? raw.features : {},
  };
}

function markSources(sources, features, source) {
  for (const [type, values] of Object.entries(features)) {
    sources[type] ??= {};
    for (const name of Object.keys(values ?? {})) {
      sources[type][name] = source;
    }
  }
}

function mergeOverrides(effective, sources, overrides, source) {
  for (const [type, values] of Object.entries(overrides ?? {})) {
    effective[type] ??= {};
    sources[type] ??= {};
    for (const [name, value] of Object.entries(values ?? {})) {
      effective[type][name] = Boolean(value);
      sources[type][name] = source;
    }
  }
}

function ensureLocalProfileIgnored(projectPath) {
  const excludePath = path.join(projectPath, '.git', 'info', 'exclude');
  if (!fs.existsSync(path.dirname(excludePath))) return;

  const marker = '.agent-env.local/';
  let text = '';
  if (fs.existsSync(excludePath)) {
    text = fs.readFileSync(excludePath, 'utf8');
  }
  if (text.split(/\r?\n/).includes(marker)) return;

  const next = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${marker}\n`;
  fs.writeFileSync(excludePath, next, 'utf8');
}
