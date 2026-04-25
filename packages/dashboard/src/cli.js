import { spawnSync } from 'node:child_process';

const KNOWN_ADAPTERS = Object.freeze([
  { id: 'claude', displayName: 'Claude Code', command: 'claude-env' },
  { id: 'codex', displayName: 'Codex', command: 'codex-env' },
]);

export async function main(argv, io = defaultIo()) {
  const [command = 'help'] = argv;
  if (command === 'status' || command === 'adapters') {
    io.out(JSON.stringify({ adapters: discoverAdapters() }, null, 2));
    return 0;
  }
  if (command === 'install') {
    io.out('agent-env-dashboard is facade-only. It does not install Claude, Codex, or Serena.');
    return 0;
  }
  if (command === 'ui') {
    io.out('Dashboard UI server is not implemented in this slice. Adapter discovery is available via `agent-env-dashboard status`.');
    return 0;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    io.out(
      [
        'Usage: agent-env-dashboard <command>',
        '',
        'Commands:',
        '  agent-env-dashboard install',
        '  agent-env-dashboard status',
        '  agent-env-dashboard adapters',
        '  agent-env-dashboard ui',
      ].join('\n'),
    );
    return 0;
  }
  io.err(`Unknown command: ${command}`);
  return 64;
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
