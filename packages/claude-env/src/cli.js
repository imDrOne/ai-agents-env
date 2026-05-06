import {
  formatAgentHelp,
  createStatuslineInstallPlan,
  executeStatuslineInstallPlan,
  formatStatuslineInstallPlan,
  getStatuslineStatus,
  mockStatuslineData,
  notifyMain,
  readAgentConfig,
  renderStatusline,
  runAgentCli,
  runCacCommand,
  statuslineMain,
} from '../../shared/src/index.js';
import { installClaudePlugins, pluginCommand } from './plugins.js';
import { setupCommand } from './setup.js';

export async function main(argv, io) {
  const helpCode = await handleTopLevelHelp(argv, io);
  if (helpCode !== null) return helpCode;

  return runCacCommand(
    'claude-env',
    argv,
    (cli, run) => {
      cli.command('setup', 'Interactive Claude setup').action(run(() => setupCommand(io)));
      cli
        .command('plugins', 'Manage Claude plugins')
        .allowUnknownOptions()
        .action(run(() => pluginCommand(argv.slice(1), io)));
      cli
        .command('notify', 'Handle Claude notification payload')
        .allowUnknownOptions()
        .action(
          run(() =>
            notifyMain(argv.slice(1), {
              readConfig: () => readAgentConfig('claude', { env: io?.env }),
              ...(io?.notifyDeps ?? {}),
            }),
          ),
        );
      cli
        .command('statusline', 'Render or install Claude statusline')
        .allowUnknownOptions()
        .action(run(() => statuslineCommand(argv.slice(1), io)));
      cli
        .command('install', 'Install Claude environment')
        .allowUnknownOptions()
        .action(run(() => installCommand(argv.slice(1), io)));
      cli
        .command('[...args]', 'Run shared Claude commands')
        .allowUnknownOptions()
        .action(run(() => runAgentCli('claude', argv, io, { extraCommands: CLAUDE_HELP_COMMANDS })));
    },
    io,
  );
}

const CLAUDE_HELP_COMMANDS = Object.freeze([
  'setup',
  'plugins <list|status|install> [options]',
  'notify [payload]',
  'statusline [preview|install] [options]',
]);

async function handleTopLevelHelp(argv, io) {
  const output = io ?? defaultIo();
  const [command, maybeHelp] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    output.out(formatAgentHelp('claude', { extraCommands: CLAUDE_HELP_COMMANDS }));
    return 0;
  }
  if (isSharedHelp(command, maybeHelp)) {
    return runAgentCli('claude', [command, '--help'], output, {
      extraCommands: CLAUDE_HELP_COMMANDS,
    });
  }
  if (command === 'statusline' && (maybeHelp === 'help' || maybeHelp === '--help' || maybeHelp === '-h')) {
    output.out(formatStatuslineHelp());
    return 0;
  }
  return null;
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}

function isSharedHelp(command, maybeHelp) {
  return (
    ['install', 'project', 'sound', 'clean', 'status'].includes(command) &&
    (maybeHelp === 'help' || maybeHelp === '--help' || maybeHelp === '-h')
  );
}

function statuslineCommand(argv, io) {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    (io ?? defaultIo()).out(formatStatuslineHelp());
    return 0;
  }
  if (subcommand === 'preview') {
    const output = io ?? defaultIo();
    output.out(renderStatusline(mockStatuslineData()).trimEnd());
    return 0;
  }
  if (subcommand === 'status') {
    const output = io ?? defaultIo();
    const options = parseStatuslineOptions(rest);
    output.out(JSON.stringify(getStatuslineStatus({ home: options.home }), null, 2));
    return 0;
  }
  if (subcommand === 'install') {
    const output = io ?? defaultIo();
    const options = parseStatuslineOptions(rest);
    const plan = createStatuslineInstallPlan({
      home: options.home,
      dryRun: options.dryRun,
      force: options.force,
    });
    output.out(formatStatuslineInstallPlan(plan));
    if (plan.dryRun) return 0;
    const result = executeStatuslineInstallPlan(plan);
    output.out(`Applied ${result.changed.length} operation(s).`);
    for (const skipped of result.skipped) {
      output.out(`Skipped ${skipped.path}: ${skipped.reason}`);
    }
    return 0;
  }
  if (!subcommand) return statuslineMain(argv);
  (io ?? defaultIo()).err(`Unknown statusline command: ${subcommand}`);
  (io ?? defaultIo()).out(formatStatuslineHelp());
  return 64;
}

function parseStatuslineOptions(argv) {
  const options = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--home') {
      options.home = argv[++i];
      if (!options.home) throw new Error(`Missing value for ${arg}`);
    } else if (arg.startsWith('--home=')) {
      options.home = arg.slice('--home='.length);
      if (!options.home) throw new Error('--home requires a value');
    } else {
      throw new Error(`Unknown statusline option: ${arg}`);
    }
  }
  return options;
}

function formatStatuslineHelp() {
  return [
    'Usage: claude-env statusline [command]',
    '',
    'Commands:',
    '  claude-env statusline                    Render statusline from Claude JSON stdin',
    '  claude-env statusline preview            Render a mock preview',
    '  claude-env statusline status [--home <path>]',
    '  claude-env statusline install [--dry-run] [--force] [--home <path>]',
  ].join('\n');
}

async function installCommand(argv, io) {
  const { baseArgs, pluginOptions, skipPlugins } = splitInstallArgs(argv);
  const code = await runAgentCli('claude', ['install', ...baseArgs], io);
  if (code !== 0 || skipPlugins) return code;

  const dryRun = baseArgs.includes('--dry-run');
  const result = installClaudePlugins({
    ...pluginOptions,
    dryRun,
    io,
    spawnSyncImpl: io?.spawnSyncImpl,
    platform: io?.platform,
  });
  return result.ok ? 0 : 1;
}

function splitInstallArgs(argv) {
  const baseArgs = [];
  const pluginOptions = {};
  let skipPlugins = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-plugins') {
      skipPlugins = true;
    } else if (arg === '--plugins-file') {
      pluginOptions.pluginsFile = argv[++i];
    } else if (arg.startsWith('--plugins-file=')) {
      pluginOptions.pluginsFile = arg.slice('--plugins-file='.length);
    } else if (arg === '--marketplaces-file') {
      pluginOptions.marketplacesFile = argv[++i];
    } else if (arg.startsWith('--marketplaces-file=')) {
      pluginOptions.marketplacesFile = arg.slice('--marketplaces-file='.length);
    } else {
      baseArgs.push(arg);
    }
  }

  return { baseArgs, pluginOptions, skipPlugins };
}
