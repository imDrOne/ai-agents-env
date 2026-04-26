import { notifyMain, runAgentCli } from '../../shared/src/index.js';
import { installClaudePlugins, pluginCommand } from './plugins.js';

export async function main(argv, io) {
  if (argv[0] === 'plugins') {
    return pluginCommand(argv.slice(1), io);
  }
  if (argv[0] === 'notify') {
    return notifyMain(argv.slice(1), io?.notifyDeps);
  }
  if (argv[0] === 'install') {
    return installCommand(argv.slice(1), io);
  }
  return runAgentCli('claude', argv, io);
}

async function installCommand(argv, io) {
  const { baseArgs, pluginOptions, skipPlugins } = splitInstallArgs(argv);
  const code = await runAgentCli('claude', ['install', ...baseArgs], io);
  if (code !== 0 || skipPlugins) return code;

  const dryRun = baseArgs.includes('--dry-run');
  const result = installClaudePlugins({ ...pluginOptions, dryRun, io, spawnSyncImpl: io?.spawnSyncImpl });
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
