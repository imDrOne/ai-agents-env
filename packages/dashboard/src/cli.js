import { spawnSync } from 'node:child_process';
import {
  VALID_SERENA_CLIENTS,
  configureSerenaForAgent,
  createInstallPlan,
  ensurePlannotatorInstalled,
  executeInstallPlan,
  formatInstallPlan,
  getSerenaStatus,
  runCacCommand,
  serenaClientEnabled,
} from '../../shared/src/index.js';
import {
  cancelSetup,
  ensureInteractive,
  isPromptCancel,
  resolvePromptAdapter,
} from '../../shared/src/prompts.js';
import { installClaudePlugins } from '../../claude-env/src/plugins.js';

const KNOWN_ADAPTERS = Object.freeze([
  { id: 'claude', displayName: 'Claude Code', command: 'claude-env' },
  { id: 'codex', displayName: 'Codex', command: 'codex-env' },
]);

export async function main(argv, io = defaultIo()) {
  return runCacCommand(
    'agent-env-dashboard',
    argv,
    (cli, run) => {
      cli.command('status', 'Show adapter status').action(run(() => showAdapters(io)));
      cli.command('adapters', 'List adapters').action(run(() => showAdapters(io)));
      cli
        .command('install', 'Install Claude/Codex environments')
        .allowUnknownOptions()
        .action(run(() => installCommand(argv.slice(1), io)));
      cli.command('setup', 'Configure Claude/Codex environments').action(run(() => setupCommand(io)));
      cli
        .command('ui', 'Start dashboard UI')
        .allowUnknownOptions()
        .action(run(() => uiCommand(argv.slice(1), io)));
    },
    io,
  );
}

function showAdapters(io) {
  io.out(JSON.stringify({ adapters: discoverAdapters(), serena: getSerenaStatus(io) }, null, 2));
  return 0;
}

function installCommand(argv, io) {
  const options = parseInstallOptions(argv);
  if (!VALID_SERENA_CLIENTS.has(options.serenaClients)) {
    io.err(`Invalid Serena client selection: ${options.serenaClients}`);
    io.err('Expected one of: both, codex, claude, none');
    return 64;
  }
  return runDashboardInstall(options, io);
}

async function setupCommand(io) {
  const interactive = ensureInteractive(io);
  if (!interactive.ok) return 1;

  const prompts = resolvePromptAdapter(io);
  prompts.intro?.('agent-env-dashboard setup');

  const claudeHome = await prompts.text({
    message: 'Claude home directory',
    placeholder: '~/.claude',
    defaultValue: process.env.CLAUDE_HOME || '',
  });
  if (isPromptCancel(prompts, claudeHome)) return cancelSetup(prompts);

  const codexHome = await prompts.text({
    message: 'Codex home directory',
    placeholder: '~/.codex',
    defaultValue: process.env.CODEX_HOME || '',
  });
  if (isPromptCancel(prompts, codexHome)) return cancelSetup(prompts);

  const serenaClients = await prompts.select({
    message: 'Serena clients',
    options: [
      { value: 'both', label: 'Claude and Codex' },
      { value: 'codex', label: 'Codex only' },
      { value: 'claude', label: 'Claude only' },
      { value: 'none', label: 'None' },
    ],
    initialValue: 'both',
  });
  if (isPromptCancel(prompts, serenaClients)) return cancelSetup(prompts);

  const dryRun = await prompts.confirm({
    message: 'Run as dry-run first?',
    initialValue: true,
  });
  if (isPromptCancel(prompts, dryRun)) return cancelSetup(prompts);

  const code = runDashboardInstall(
    {
      claudeHome: claudeHome || undefined,
      codexHome: codexHome || undefined,
      serenaClients,
      dryRun,
    },
    io,
  );
  prompts.outro?.(dryRun ? 'Dry-run complete.' : 'Setup complete.');
  return code;
}

async function uiCommand(argv, io) {
  const options = parseUiOptions(argv);
  const { startDashboardServer } = await import('./server.js');
  await startDashboardServer({
    port: options.port,
    open: !options.noOpen,
    io,
  });
  await new Promise(() => {});
  return 0;
}

export function discoverAdapters() {
  return KNOWN_ADAPTERS.map(adapter => ({
    ...adapter,
    available: commandAvailable(adapter.command),
  }));
}

export function runDashboardInstall(options = {}, io = defaultIo()) {
  const dryRun = Boolean(options.dryRun);
  const serenaClients = options.serenaClients ?? 'both';
  const claudePlan = createInstallPlan('claude', {
    home: options.claudeHome,
    dryRun,
  });
  const codexPlan = createInstallPlan('codex', {
    home: options.codexHome,
    dryRun,
  });

  io.out('Claude install plan:');
  io.out(formatInstallPlan(claudePlan));
  io.out('');
  io.out('Codex install plan:');
  io.out(formatInstallPlan(codexPlan));
  io.out('');
  io.out(`Serena clients: ${serenaClients}`);

  if (!dryRun) {
    const changed = [
      ...executeInstallPlan(claudePlan),
      ...executeInstallPlan(codexPlan),
    ];
    io.out(`Applied ${changed.length} install operation(s).`);
  }

  let ok = true;
  for (const [agentId, home] of [
    ['claude', claudePlan.home],
    ['codex', codexPlan.home],
  ]) {
    if (!serenaClientEnabled(agentId, serenaClients)) continue;
    const result = configureSerenaForAgent(agentId, {
      home,
      dryRun,
      io,
      env: io?.env,
      spawnSyncImpl: io?.spawnSyncImpl,
      existsSyncImpl: io?.existsSyncImpl,
      serenaCommand: io?.serenaCommand,
    });
    ok = result.ok && ok;
  }

  io.out('');
  io.out('Plannotator installation:');
  const plannotatorResult = ensurePlannotatorInstalled({
    dryRun,
    io,
    spawnSyncImpl: io?.spawnSyncImpl,
    platform: io?.platform,
  });
  ok = plannotatorResult.ok && ok;

  io.out('');
  io.out('Claude plugin installation:');
  const pluginResult = installClaudePlugins({
    dryRun,
    io,
    spawnSyncImpl: io?.spawnSyncImpl,
    platform: io?.platform,
    ensurePlannotator: false,
  });
  ok = pluginResult.ok && ok;

  return ok ? 0 : 1;
}

function parseInstallOptions(argv) {
  const options = { serenaClients: 'both' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--claude-home') {
      options.claudeHome = argv[++i];
      if (!options.claudeHome) throw new Error(`Missing value for ${arg}`);
    } else if (arg.startsWith('--claude-home=')) {
      options.claudeHome = arg.slice('--claude-home='.length);
      if (!options.claudeHome) throw new Error('--claude-home requires a value');
    } else if (arg === '--codex-home') {
      options.codexHome = argv[++i];
      if (!options.codexHome) throw new Error(`Missing value for ${arg}`);
    } else if (arg.startsWith('--codex-home=')) {
      options.codexHome = arg.slice('--codex-home='.length);
      if (!options.codexHome) throw new Error('--codex-home requires a value');
    } else if (arg === '--serena-clients') {
      options.serenaClients = argv[++i];
      if (!options.serenaClients) throw new Error(`Missing value for ${arg}`);
    } else if (arg.startsWith('--serena-clients=')) {
      options.serenaClients = arg.slice('--serena-clients='.length);
      if (!options.serenaClients) throw new Error('--serena-clients requires a value');
    } else {
      throw new Error(`Unknown dashboard install option: ${arg}`);
    }
  }
  return options;
}

function parseUiOptions(argv) {
  const options = { port: 7200, noOpen: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-open') {
      options.noOpen = true;
    } else if (arg === '--port') {
      options.port = Number(argv[++i]);
      if (!Number.isInteger(options.port) || options.port <= 0) {
        throw new Error('--port requires a positive integer');
      }
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
      if (!Number.isInteger(options.port) || options.port <= 0) {
        throw new Error('--port requires a positive integer');
      }
    } else {
      throw new Error(`Unknown dashboard ui option: ${arg}`);
    }
  }
  return options;
}

function commandAvailable(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
