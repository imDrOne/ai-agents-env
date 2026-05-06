import { main as claudeMain } from '../packages/claude-env/src/cli.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';
import { main as dashboardMain } from '../packages/dashboard/src/cli.js';

export async function main(argv, io = defaultIo()) {
  const [command = 'help', ...rest] = argv;

  if (command === 'claude-env' || command === 'claude') return claudeMain(rest, io);
  if (command === 'codex-env' || command === 'codex') return codexMain(rest, io);
  if (command === 'agent-env-dashboard' || command === 'dashboard') {
    return dashboardMain(rest, io);
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    io.out(formatSuiteHelp());
    return 0;
  }

  io.err(`Unknown command: ${command}`);
  io.err("Run 'agent-env-suite help' for usage.");
  return 64;
}

export function formatSuiteHelp() {
  return [
    'Usage: agent-env-suite <command>',
    '',
    'Commands:',
    '  agent-env-suite claude-env <args...>       Run claude-env',
    '  agent-env-suite codex-env <args...>        Run codex-env',
    '  agent-env-suite dashboard <args...>        Run agent-env-dashboard',
    '',
    'Installed bins:',
    '  claude-env',
    '  codex-env',
    '  agent-env-dashboard',
    '',
    'Examples:',
    '  npx -y agent-env-suite claude-env help',
    '  npx -y agent-env-suite codex-env setup',
    '  npx -y agent-env-suite dashboard status',
  ].join('\n');
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
