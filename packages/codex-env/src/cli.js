import {
  ensurePlannotatorInstalled,
  formatAgentHelp,
  notifyMain,
  readAgentConfig,
  runAgentCli,
  runCacCommand,
} from '@agent-env/shared';
import { skillsCommand } from './skills.js';
import { setupCommand } from './setup.js';

export async function main(argv, io) {
  const helpCode = await handleTopLevelHelp(argv, io);
  if (helpCode !== null) return helpCode;

  return runCacCommand(
    'codex-env',
    argv,
    (cli, run) => {
      cli.command('setup', 'Interactive Codex setup').action(run(() => setupCommand(io)));
      cli
        .command('skills', 'Manage Codex skills')
        .allowUnknownOptions()
        .action(run(() => skillsCommand(argv.slice(1), io)));
      cli
        .command('notify', 'Handle Codex notification payload')
        .allowUnknownOptions()
        .action(
          run(() =>
            notifyMain(argv.slice(1), {
              readConfig: () => readAgentConfig('codex', { env: io?.env }),
              ...(io?.notifyDeps ?? {}),
            }),
          ),
        );
      cli
        .command('install', 'Install Codex environment')
        .allowUnknownOptions()
        .action(run(() => installCommand(argv.slice(1), io)));
      cli
        .command('[...args]', 'Run shared Codex commands')
        .allowUnknownOptions()
        .action(run(() => runAgentCli('codex', argv, io, { extraCommands: CODEX_HELP_COMMANDS })));
    },
    io,
  );
}

const CODEX_HELP_COMMANDS = Object.freeze([
  'setup',
  'skills <list|status|sync> [options]',
  'notify [payload]',
]);

async function handleTopLevelHelp(argv, io) {
  const output = io ?? defaultIo();
  const [command, maybeHelp] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    output.out(formatAgentHelp('codex', { extraCommands: CODEX_HELP_COMMANDS }));
    return 0;
  }
  if (isSharedHelp(command, maybeHelp)) {
    return runAgentCli('codex', [command, '--help'], output, {
      extraCommands: CODEX_HELP_COMMANDS,
    });
  }
  return null;
}

function isSharedHelp(command, maybeHelp) {
  return (
    ['install', 'project', 'sound', 'clean', 'status'].includes(command) &&
    (maybeHelp === 'help' || maybeHelp === '--help' || maybeHelp === '-h')
  );
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}

async function installCommand(argv, io) {
  const code = await runAgentCli('codex', ['install', ...argv], io);
  if (code !== 0) return code;

  const result = ensurePlannotatorInstalled({
    dryRun: argv.includes('--dry-run'),
    io,
    spawnSyncImpl: io?.spawnSyncImpl,
    platform: io?.platform,
  });
  return result.ok ? 0 : 1;
}
