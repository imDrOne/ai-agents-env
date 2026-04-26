import { spawnSync } from 'node:child_process';
import { runCacCommand } from '../../shared/src/index.js';

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
      cli.command('install', 'Install dashboard facade').action(run(() => installCommand(io)));
      cli.command('setup', 'Configure dashboard facade').action(run(() => setupCommand(io)));
      cli.command('ui', 'Start dashboard UI').action(run(() => uiCommand(io)));
    },
    io,
  );
}

function showAdapters(io) {
  io.out(JSON.stringify({ adapters: discoverAdapters() }, null, 2));
  return 0;
}

function installCommand(io) {
  io.out('agent-env-dashboard is facade-only. It does not install Claude, Codex, or Serena.');
  return 0;
}

function setupCommand(io) {
  io.out('agent-env-dashboard setup is facade-only. Install Claude/Codex separately, then run agent-env-dashboard ui.');
  return 0;
}

function uiCommand(io) {
  io.out('Dashboard UI server is not implemented in this slice. Adapter discovery is available via `agent-env-dashboard status`.');
  return 0;
}

export function discoverAdapters() {
  return KNOWN_ADAPTERS.map(adapter => ({
    ...adapter,
    available: commandAvailable(adapter.command),
  }));
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
