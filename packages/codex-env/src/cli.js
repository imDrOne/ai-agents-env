import { notifyMain, readAgentConfig, runAgentCli, runCacCommand } from '../../shared/src/index.js';
import { skillsCommand } from './skills.js';
import { setupCommand } from './setup.js';

export async function main(argv, io) {
  return runCacCommand(
    'codex-env',
    argv,
    (cli, run) => {
      cli.command('setup', 'Interactive Codex setup').action(run(() => setupCommand(io)));
      cli.command('skills', 'Manage Codex skills').allowUnknownOptions().action(run(() => skillsCommand(argv.slice(1), io)));
      cli.command('notify', 'Handle Codex notification payload').allowUnknownOptions().action(run(() => notifyMain(argv.slice(1), {
        readConfig: () => readAgentConfig('codex', { env: io?.env }),
        ...(io?.notifyDeps ?? {}),
      })));
      cli.command('[...args]', 'Run shared Codex commands').allowUnknownOptions().action(run(() => runAgentCli('codex', argv, io)));
    },
    io,
  );
}
