import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_CODEX_SKILLS_FILE = path.join(PACKAGE_ROOT, 'codex-skills.txt');

export function readCodexSkillManifest({ manifestFile = DEFAULT_CODEX_SKILLS_FILE } = {}) {
  if (!fs.existsSync(manifestFile)) return [];
  return fs
    .readFileSync(manifestFile, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [destination, marketplacePath, sourceSkill = destination] = line.split(/\s+/);
      const [marketplace, plugin] = (marketplacePath ?? '').split('/');
      return destination && marketplace && plugin
        ? { destination, marketplace, plugin, sourceSkill }
        : null;
    })
    .filter(Boolean);
}

export function createCodexSkillSyncPlan({
  manifestFile = DEFAULT_CODEX_SKILLS_FILE,
  cacheRoot = defaultClaudePluginCacheRoot(),
  agentsHome = process.env.AGENTS_HOME || path.join(os.homedir(), '.agents'),
} = {}) {
  const mappings = readCodexSkillManifest({ manifestFile });
  const operations = [];

  for (const mapping of mappings) {
    const skillsRoot = resolveNewestSkillsRoot(cacheRoot, mapping.marketplace, mapping.plugin);
    if (!skillsRoot) {
      operations.push(missingOperation(cacheRoot, mapping));
      continue;
    }

    const skillDirs = resolveSkillDirs(skillsRoot, mapping.sourceSkill);
    if (skillDirs.length === 0) {
      operations.push({ ...missingOperation(cacheRoot, mapping), skillsRoot });
      continue;
    }

    for (const skillDir of skillDirs) {
      const skillName = mapping.destination === '*' ? path.basename(skillDir) : mapping.destination;
      operations.push({
        kind: 'copySkill',
        ...mapping,
        skillName,
        source: skillDir,
        target: path.join(agentsHome, 'skills', skillName),
      });
    }
  }

  return { manifestFile, cacheRoot, agentsHome, operations };
}

export function syncCodexSkills(options = {}) {
  const plan = createCodexSkillSyncPlan(options);
  if (options.dryRun) {
    for (const operation of plan.operations) {
      if (operation.kind === 'copySkill') {
        options.io?.out?.(
          `  [dry-run] would copy skill ${operation.skillName}: ${operation.target} <- ${operation.source}`,
        );
      } else {
        options.io?.out?.(
          `  [dry-run] missing skill source for ${operation.destination}: ${operation.cachePath}`,
        );
      }
    }
    return { ok: true, dryRun: true, copied: 0, missing: countMissing(plan) };
  }
  return executeCodexSkillSyncPlan(plan, options);
}

export function executeCodexSkillSyncPlan(plan, { io = defaultIo() } = {}) {
  const summary = { ok: true, copied: 0, missing: 0 };
  for (const operation of plan.operations) {
    if (operation.kind === 'missingSkillSource') {
      summary.missing += 1;
      io.err(`  missing skill source for ${operation.destination}: ${operation.cachePath}`);
      continue;
    }
    copySkillDir(operation.source, operation.target);
    summary.copied += 1;
    io.out(`  copied skill ${operation.skillName}: ${operation.target} <- ${operation.source}`);
  }
  if (summary.missing > 0) summary.ok = false;
  return summary;
}

export function skillsCommand(argv, io = defaultIo()) {
  const [subcommand = 'help', ...rest] = argv;
  if (subcommand === 'list') {
    const options = parseSkillOptions(rest);
    io.out(JSON.stringify(readCodexSkillManifest(options), null, 2));
    return 0;
  }
  if (subcommand === 'status') {
    const options = parseSkillOptions(rest);
    const plan = createCodexSkillSyncPlan(options);
    io.out(
      JSON.stringify(
        {
          manifestFile: plan.manifestFile,
          cacheRoot: plan.cacheRoot,
          agentsHome: plan.agentsHome,
          copyable: plan.operations.filter(op => op.kind === 'copySkill').length,
          missing: plan.operations.filter(op => op.kind === 'missingSkillSource').length,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (subcommand === 'sync' || subcommand === 'link') {
    const options = parseSkillOptions(rest);
    const result = syncCodexSkills({ ...options, io });
    return result.ok ? 0 : 1;
  }
  printSkillsHelp(io);
  return 0;
}

function parseSkillOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--manifest-file') {
      options.manifestFile = argv[++i];
    } else if (arg.startsWith('--manifest-file=')) {
      options.manifestFile = arg.slice('--manifest-file='.length);
    } else if (arg === '--cache-root') {
      options.cacheRoot = argv[++i];
    } else if (arg.startsWith('--cache-root=')) {
      options.cacheRoot = arg.slice('--cache-root='.length);
    } else if (arg === '--agents-home') {
      options.agentsHome = argv[++i];
    } else if (arg.startsWith('--agents-home=')) {
      options.agentsHome = arg.slice('--agents-home='.length);
    } else {
      throw new Error(`Unknown skills option: ${arg}`);
    }
  }
  return options;
}

function resolveNewestSkillsRoot(cacheRoot, marketplace, plugin) {
  const cachePath = path.join(cacheRoot, marketplace, plugin);
  if (!fs.existsSync(cachePath)) return null;
  const versions = fs.readdirSync(cachePath).sort().reverse();
  for (const version of versions) {
    const candidate = path.join(cachePath, version, 'skills');
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

function resolveSkillDirs(skillsRoot, sourceSkill) {
  if (sourceSkill !== '*') {
    const candidate = path.join(skillsRoot, sourceSkill);
    return isSkillDir(candidate) ? [candidate] : [];
  }

  return fs
    .readdirSync(skillsRoot)
    .map(name => path.join(skillsRoot, name))
    .filter(isSkillDir)
    .sort();
}

function isSkillDir(dirPath) {
  return fs.existsSync(path.join(dirPath, 'SKILL.md'));
}

function copySkillDir(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function missingOperation(cacheRoot, mapping) {
  return {
    kind: 'missingSkillSource',
    ...mapping,
    cachePath: path.join(cacheRoot, mapping.marketplace, mapping.plugin),
  };
}

function countMissing(plan) {
  return plan.operations.filter(operation => operation.kind === 'missingSkillSource').length;
}

function defaultClaudePluginCacheRoot() {
  const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
  return path.join(claudeHome, 'plugins', 'cache');
}

function printSkillsHelp(io) {
  io.out(
    [
      'Usage:',
      '  codex-env skills list [--manifest-file <path>]',
      '  codex-env skills status [--manifest-file <path>] [--cache-root <path>] [--agents-home <path>]',
      '  codex-env skills sync [--dry-run] [--manifest-file <path>] [--cache-root <path>] [--agents-home <path>]',
    ].join('\n'),
  );
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
