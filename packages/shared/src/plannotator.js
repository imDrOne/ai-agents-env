import { spawnSync } from 'node:child_process';

const PLANNOTATOR_INSTALL_URLS = Object.freeze({
  posix: 'https://plannotator.ai/install.sh',
  windows: 'https://plannotator.ai/install.ps1',
});

export function ensurePlannotatorInstalled({
  dryRun = false,
  spawnSyncImpl = spawnSync,
  io = defaultIo(),
  platform = process.platform,
} = {}) {
  if (commandAvailable('plannotator', { spawnSyncImpl, platform })) {
    io.out('  plannotator already available');
    return { ok: true, dryRun, installed: false, skipped: true, reason: 'already-installed' };
  }

  const spec = plannotatorInstallSpec(platform);
  if (!spec) {
    io.err(`  plannotator auto-install is not supported on platform: ${platform}`);
    return { ok: false, dryRun, installed: false, skipped: true, reason: 'unsupported-platform' };
  }

  if (dryRun) {
    io.out(`  [dry-run] would install plannotator via ${spec.url}`);
    return { ok: true, dryRun, installed: false, skipped: false, reason: 'dry-run' };
  }

  const result = spawnSyncImpl(spec.command, spec.args, {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0 || result.error) {
    const detail = firstOutputLine(result);
    io.err(`  plannotator install failed${detail ? ` - ${detail}` : ''}`);
    return { ok: false, dryRun, installed: false, skipped: false, reason: 'install-failed' };
  }

  io.out(`  plannotator installed via ${spec.url}`);
  return { ok: true, dryRun, installed: true, skipped: false, reason: null };
}

function plannotatorInstallSpec(platform) {
  if (platform === 'win32') {
    return {
      url: PLANNOTATOR_INSTALL_URLS.windows,
      command: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `irm ${PLANNOTATOR_INSTALL_URLS.windows} | iex`,
      ],
    };
  }

  if (platform === 'darwin' || platform === 'linux') {
    return {
      url: PLANNOTATOR_INSTALL_URLS.posix,
      command: 'bash',
      args: ['-lc', `curl -fsSL ${PLANNOTATOR_INSTALL_URLS.posix} | bash`],
    };
  }

  return null;
}

function commandAvailable(command, { spawnSyncImpl, platform }) {
  const lookup = platform === 'win32' ? 'where' : 'which';
  const result = spawnSyncImpl(lookup, [command], { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function firstOutputLine(result) {
  return (result.stderr || result.stdout || '').trim().split(/\r?\n/)[0] || '';
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
