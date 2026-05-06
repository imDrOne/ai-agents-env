import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_DEFINITIONS, createInstallPlan } from './install-plan.js';
import { projectProfilePath } from './project-env.js';

const MANAGED_FILE_CONTENT = Object.freeze({
  claude: {
    'CLAUDE.md': '# Claude Environment\n\nManaged by claude-env.\n',
  },
  codex: {
    'AGENTS.md': '# Codex Environment\n\nManaged by codex-env.\n',
    'config.toml': [
      'model = "gpt-5.4"',
      'model_reasoning_effort = "high"',
      '',
      '[features]',
      'multi_agent = true',
      '',
    ].join('\n'),
  },
});

export function createGlobalCleanupPlan(agentId, options = {}) {
  const agent = AGENT_DEFINITIONS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  const home = options.home ?? process.env[agent.homeEnv] ?? agent.defaultHome();
  if (options.wipe) return createGlobalWipePlan(agentId, home);

  const installPlan = createInstallPlan(agentId, { home, withSerena: true });
  const operations = [];
  const seen = new Set();

  for (const op of installPlan.operations) {
    if (!op.path || seen.has(op.path)) continue;
    seen.add(op.path);
    const cleanupOp = classifyGlobalCleanupOperation(agentId, home, op);
    if (cleanupOp.reason !== 'missing') operations.push(cleanupOp);
  }

  if (!seen.has(home)) {
    operations.push(classifyDirCleanupOperation(home));
  }

  operations.sort((a, b) => cleanupOrder(a, home) - cleanupOrder(b, home));

  return { agent: agentId, home, operations };
}

export function createProjectCleanupPlan(agentId, options = {}) {
  const projectPath = options.projectPath ?? process.cwd();
  const scopes = options.scope === 'both' ? ['local', 'tracked'] : [options.scope ?? 'local'];
  const operations = scopes.map(scope => {
    const filePath = projectProfilePath(agentId, projectPath, scope);
    return fs.existsSync(filePath)
      ? { kind: 'removeFile', path: filePath, scope }
      : { kind: 'skip', path: filePath, scope, reason: 'missing' };
  });

  for (const dirName of ['.agent-env.local', '.agent-env']) {
    const dirPath = path.join(projectPath, dirName);
    if (scopes.includes('local') && dirName === '.agent-env.local') {
      operations.push(classifyDirCleanupOperation(dirPath));
    }
    if (scopes.includes('tracked') && dirName === '.agent-env') {
      operations.push(classifyDirCleanupOperation(dirPath));
    }
  }

  return { agent: agentId, projectPath, operations };
}

export function formatCleanupPlan(plan) {
  return plan.operations
    .map(op => {
      if (op.kind === 'removeFile') return `remove file ${op.path}`;
      if (op.kind === 'removeEmptyDir') return `remove empty directory ${op.path}`;
      if (op.kind === 'wipeDir') return `wipe directory ${op.path}`;
      if (op.kind === 'skip') return `skip ${op.path} (${op.reason})`;
      return `${op.kind} ${op.path}`;
    })
    .join('\n');
}

export function executeCleanupPlan(plan, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const removed = [];
  const skipped = [];

  for (const op of plan.operations) {
    if (op.kind === 'skip') {
      skipped.push(op);
      continue;
    }
    if (dryRun) continue;

    if (op.kind === 'removeFile') {
      fs.rmSync(op.path, { force: true });
      removed.push(op.path);
    } else if (op.kind === 'wipeDir') {
      fs.rmSync(op.path, { recursive: true, force: true });
      removed.push(op.path);
    } else if (op.kind === 'removeEmptyDir') {
      if (isExistingEmptyDir(op.path)) {
        fs.rmdirSync(op.path);
        removed.push(op.path);
      } else {
        skipped.push({
          ...op,
          kind: 'skip',
          reason: fs.existsSync(op.path) ? 'directory-not-empty' : 'missing',
        });
      }
    }
  }

  return { ok: true, dryRun, removed, skipped };
}

function createGlobalWipePlan(agentId, home) {
  const safety = validateWipeHome(agentId, home);
  return {
    agent: agentId,
    home,
    destructive: true,
    operations: safety.ok
      ? [{ kind: 'wipeDir', path: home }]
      : [{ kind: 'skip', path: home, reason: safety.reason }],
  };
}

function classifyGlobalCleanupOperation(agentId, home, op) {
  if (op.kind === 'ensureDir') return classifyDirCleanupOperation(op.path);
  if (op.kind === 'writeFile') return classifyManagedTextFile(agentId, home, op.path);
  if (op.kind === 'writeJson') return classifyManagedJsonFile(agentId, op.path);
  if (op.kind === 'writeStatuslineConfig') return classifyManagedJsonFile(agentId, op.path);
  if (op.kind === 'mergeClaudeStatusLine') {
    return fs.existsSync(op.path)
      ? { kind: 'skip', path: op.path, reason: 'partial-managed-file' }
      : { kind: 'skip', path: op.path, reason: 'missing' };
  }
  return { kind: 'skip', path: op.path, reason: 'unsupported-operation' };
}

function classifyManagedTextFile(agentId, home, filePath) {
  if (!fs.existsSync(filePath)) return { kind: 'skip', path: filePath, reason: 'missing' };
  const rel = path.relative(home, filePath);
  const expected = MANAGED_FILE_CONTENT[agentId]?.[rel];
  if (expected === undefined) {
    return { kind: 'skip', path: filePath, reason: 'unknown-managed-file' };
  }
  const actual = fs.readFileSync(filePath, 'utf8');
  return actual === expected
    ? { kind: 'removeFile', path: filePath }
    : { kind: 'skip', path: filePath, reason: 'content-mismatch' };
}

function classifyManagedJsonFile(agentId, filePath) {
  if (!fs.existsSync(filePath)) return { kind: 'skip', path: filePath, reason: 'missing' };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const expectedManagedBy = AGENT_DEFINITIONS[agentId].cli;
    if (raw?.managedBy === expectedManagedBy || raw?.agent === agentId) {
      return { kind: 'removeFile', path: filePath };
    }
  } catch {
    return { kind: 'skip', path: filePath, reason: 'invalid-json' };
  }
  return { kind: 'skip', path: filePath, reason: 'not-managed' };
}

function classifyDirCleanupOperation(dirPath) {
  if (!fs.existsSync(dirPath)) return { kind: 'skip', path: dirPath, reason: 'missing' };
  if (!fs.lstatSync(dirPath).isDirectory()) {
    return { kind: 'skip', path: dirPath, reason: 'not-directory' };
  }
  return {
    kind: 'removeEmptyDir',
    path: dirPath,
    ...(isExistingEmptyDir(dirPath) ? {} : { reason: 'directory-not-empty' }),
  };
}

function isExistingEmptyDir(dirPath) {
  return (
    fs.existsSync(dirPath) &&
    fs.lstatSync(dirPath).isDirectory() &&
    fs.readdirSync(dirPath).length === 0
  );
}

function cleanupOrder(operation, home) {
  if (operation.kind === 'removeFile' || operation.kind === 'skip') return 0;
  if (operation.kind === 'removeEmptyDir' && operation.path === home) return 2;
  if (operation.kind === 'removeEmptyDir') return 1;
  return 1;
}

function validateWipeHome(agentId, home) {
  const expectedBasename = agentId === 'claude' ? '.claude' : '.codex';
  const resolved = path.resolve(home || '');
  const userHome = path.resolve(os.homedir());

  if (!home) return { ok: false, reason: 'unsafe-empty-home' };
  if (resolved === path.parse(resolved).root) return { ok: false, reason: 'unsafe-root-home' };
  if (resolved === userHome) return { ok: false, reason: 'unsafe-user-home' };
  if (path.basename(resolved) !== expectedBasename && !hasAgentHomeEvidence(agentId, resolved)) {
    return { ok: false, reason: `unsafe-home-basename-expected-${expectedBasename}` };
  }
  return { ok: true };
}

function hasAgentHomeEvidence(agentId, home) {
  const evidence =
    agentId === 'claude'
      ? ['claude-env.json', 'CLAUDE.md', 'commands', 'hooks', 'agents']
      : ['codex-env.json', 'AGENTS.md', 'config.toml', 'rules'];
  return evidence.some(name => fs.existsSync(path.join(home, name)));
}
