import {
  formatAgentHelp,
  notifyMain,
  readAgentConfig,
  runAgentCli,
  runCacCommand,
} from '../../shared/src/index.js';
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
