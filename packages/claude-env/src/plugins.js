import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensurePlannotatorInstalled } from '@agent-env/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PLANNOTATOR_PLUGIN = 'plannotator@plannotator';

export const DEFAULT_MARKETPLACES_FILE = path.join(PACKAGE_ROOT, 'marketplaces.txt');
export const DEFAULT_PLUGINS_FILE = path.join(PACKAGE_ROOT, 'plugins.txt');

export function readClaudePluginManifest({
  marketplacesFile = DEFAULT_MARKETPLACES_FILE,
  pluginsFile = DEFAULT_PLUGINS_FILE,
} = {}) {
  return {
    marketplaces: readMarketplaces(marketplacesFile),
    plugins: readList(pluginsFile),
  };
}

export function createClaudePluginPlan(options = {}) {
  const manifest = readClaudePluginManifest(options);
  const pluginFilter = options.onlyPlugins ? new Set(options.onlyPlugins) : null;
  const plugins = pluginFilter
    ? manifest.plugins.filter(plugin => pluginFilter.has(plugin))
    : manifest.plugins;
  return {
    marketplacesFile: options.marketplacesFile ?? DEFAULT_MARKETPLACES_FILE,
    pluginsFile: options.pluginsFile ?? DEFAULT_PLUGINS_FILE,
    operations: [
      ...manifest.marketplaces.map(marketplace => ({
        kind: 'addMarketplace',
        name: marketplace.name,
        repo: marketplace.repo,
      })),
      ...plugins.map(plugin => ({
        kind: 'installPlugin',
        plugin,
        scope: 'user',
      })),
    ],
  };
}

export function installClaudePlugins({
  marketplacesFile = DEFAULT_MARKETPLACES_FILE,
  pluginsFile = DEFAULT_PLUGINS_FILE,
  onlyPlugins,
  dryRun = false,
  spawnSyncImpl = spawnSync,
  io = defaultIo(),
  platform = process.platform,
  ensurePlannotator = true,
} = {}) {
  const plan = createClaudePluginPlan({ marketplacesFile, pluginsFile, onlyPlugins });
  const summary = {
    ok: true,
    dryRun,
    skipped: false,
    reason: null,
    marketplacesAdded: 0,
    marketplacesAlreadyConfigured: 0,
    marketplacesFailed: 0,
    pluginsInstalled: 0,
    pluginsFailed: 0,
    plannotatorInstalled: false,
    plannotatorSkipped: false,
  };

  if (dryRun) {
    for (const operation of plan.operations) {
      if (operation.kind === 'addMarketplace') {
        io.out(`  [dry-run] would add marketplace: ${operation.repo}`);
      } else if (operation.kind === 'installPlugin') {
        io.out(`  [dry-run] would install plugin: ${operation.plugin}`);
      }
    }
    const plannotator = ensurePlannotator
      ? ensurePlannotatorForPlan(plan, { dryRun, spawnSyncImpl, io, platform })
      : null;
    summary.plannotatorInstalled = Boolean(plannotator?.installed);
    summary.plannotatorSkipped = Boolean(plannotator?.skipped);
    summary.ok = summary.ok && (plannotator?.ok ?? true);
    return summary;
  }

  const plannotator = ensurePlannotator
    ? ensurePlannotatorForPlan(plan, { dryRun, spawnSyncImpl, io, platform })
    : null;
  summary.plannotatorInstalled = Boolean(plannotator?.installed);
  summary.plannotatorSkipped = Boolean(plannotator?.skipped);
  if (plannotator && !plannotator.ok) {
    summary.ok = false;
    return summary;
  }

  const probe = spawnSyncImpl('claude', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (probe.status !== 0 || probe.error) {
    io.err('  warning: claude CLI not found — skipping plugin installation');
    summary.skipped = true;
    summary.reason = 'claude-cli-not-found';
    return summary;
  }

  for (const operation of plan.operations) {
    if (operation.kind === 'addMarketplace') {
      const result = spawnSyncImpl('claude', ['plugin', 'marketplace', 'add', operation.repo], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const detail = firstOutputLine(result);
      if (result.status === 0) {
        summary.marketplacesAdded += 1;
        io.out(`  marketplace added: ${operation.repo}`);
      } else if (/already/i.test(detail)) {
        summary.marketplacesAlreadyConfigured += 1;
        io.out(`  marketplace already configured: ${operation.repo}`);
      } else {
        summary.marketplacesFailed += 1;
        summary.ok = false;
        io.err(`  marketplace skipped/failed: ${operation.repo}${detail ? ` — ${detail}` : ''}`);
      }
    }

    if (operation.kind === 'installPlugin') {
      const result = spawnSyncImpl(
        'claude',
        ['plugin', 'install', operation.plugin, '--scope', operation.scope],
        { encoding: 'utf8', stdio: 'pipe' },
      );
      const detail = firstOutputLine(result);
      if (result.status === 0) {
        summary.pluginsInstalled += 1;
        io.out(`  plugin installed: ${operation.plugin}`);
      } else {
        summary.pluginsFailed += 1;
        summary.ok = false;
        io.err(`  plugin skipped/failed: ${operation.plugin}${detail ? ` — ${detail}` : ''}`);
      }
    }
  }

  return summary;
}

export function pluginCommand(argv, io = defaultIo()) {
  const [subcommand = 'help', ...rest] = argv;
  if (subcommand === 'list') {
    const options = parsePluginOptions(rest);
    io.out(JSON.stringify(readClaudePluginManifest(options), null, 2));
    return 0;
  }
  if (subcommand === 'status') {
    const options = parsePluginOptions(rest);
    const manifest = readClaudePluginManifest(options);
    io.out(
      JSON.stringify(
        {
          marketplacesFile: options.marketplacesFile ?? DEFAULT_MARKETPLACES_FILE,
          pluginsFile: options.pluginsFile ?? DEFAULT_PLUGINS_FILE,
          marketplaces: manifest.marketplaces.length,
          plugins: manifest.plugins.length,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (subcommand === 'install') {
    const options = parsePluginOptions(rest);
    const result = installClaudePlugins({
      ...options,
      io,
      spawnSyncImpl: io?.spawnSyncImpl,
      platform: io?.platform,
    });
    return result.ok ? 0 : 1;
  }
  printPluginHelp(io);
  return 0;
}

function parsePluginOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--plugins-file') {
      options.pluginsFile = argv[++i];
    } else if (arg.startsWith('--plugins-file=')) {
      options.pluginsFile = arg.slice('--plugins-file='.length);
    } else if (arg === '--marketplaces-file') {
      options.marketplacesFile = argv[++i];
    } else if (arg.startsWith('--marketplaces-file=')) {
      options.marketplacesFile = arg.slice('--marketplaces-file='.length);
    } else {
      throw new Error(`Unknown plugins option: ${arg}`);
    }
  }
  return options;
}

function readMarketplaces(filePath) {
  return readList(filePath)
    .map(line => {
      const [name, repo] = line.split(/\s+/);
      return name && repo ? { name, repo } : null;
    })
    .filter(Boolean);
}

function readList(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function firstOutputLine(result) {
  return (result.stderr || result.stdout || '').trim().split(/\r?\n/)[0] || '';
}

function ensurePlannotatorForPlan(plan, options) {
  if (!plan.operations.some(operation => operation.plugin === PLANNOTATOR_PLUGIN)) return null;
  return ensurePlannotatorInstalled(options);
}

function printPluginHelp(io) {
  io.out(
    [
      'Usage:',
      '  claude-env plugins list [--plugins-file <path>] [--marketplaces-file <path>]',
      '  claude-env plugins status [--plugins-file <path>] [--marketplaces-file <path>]',
      '  claude-env plugins install [--dry-run] [--plugins-file <path>] [--marketplaces-file <path>]',
    ].join('\n'),
  );
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
