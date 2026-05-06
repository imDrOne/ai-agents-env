import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileIfChanged } from './platform.js';

const DASHBOARD_PORT = 24282;
export const VALID_SERENA_CLIENTS = Object.freeze(new Set(['both', 'codex', 'claude', 'none']));

export function getSerenaDashboardUrl(port = DASHBOARD_PORT) {
  return `http://localhost:${port}/dashboard/index.html`;
}

export function serenaClientEnabled(agentId, clients = 'both') {
  return clients === 'both' || clients === agentId;
}

export function buildSerenaNativeMcpConfig(serenaCommand, context = 'codex') {
  return {
    type: 'stdio',
    command: serenaCommand,
    args: [
      'start-mcp-server',
      '--project-from-cwd',
      `--context=${context}`,
      '--enable-web-dashboard=true',
      '--open-web-dashboard=false',
    ],
  };
}

export function applyCodexSerenaConfig(text, { enabled, serenaCommand }) {
  if (!enabled || !serenaCommand) return removeTomlSection(text);

  const mcp = buildSerenaNativeMcpConfig(serenaCommand, 'codex');
  return upsertTomlSection(text, [
    '[mcp_servers.serena]',
    'startup_timeout_sec = 60',
    `command = ${tomlString(mcp.command)}`,
    `args = ${tomlArray(mcp.args)}`,
  ]);
}

export function configureSerenaForAgent(agentId, options = {}) {
  if (agentId === 'codex') return configureCodexSerena(options);
  if (agentId === 'claude') return configureClaudeSerena(options);
  throw new Error(`Unknown Serena client: ${agentId}`);
}

export function getSerenaStatus(options = {}) {
  const uvBinary = resolveUvBinary(options);
  const serenaBinary = resolveSerenaBinary({ ...options, uvBinary });
  return {
    uv: {
      available: Boolean(uvBinary),
      command: uvBinary,
    },
    serena: {
      available: Boolean(serenaBinary),
      command: serenaBinary,
    },
    dashboardUrl: getSerenaDashboardUrl(),
  };
}

export function resolveUvBinary(options = {}) {
  return findExecutable('uv', options);
}

export function resolveSerenaBinary(options = {}) {
  const {
    existsSyncImpl = fs.existsSync,
    homeDir = os.homedir(),
    platform = process.platform,
  } = options;
  const uvBinary = options.uvBinary ?? resolveUvBinary(options);
  const toolBinDir = resolveUvToolBinDir(uvBinary, options);
  if (toolBinDir) {
    const shim = path.join(toolBinDir, executableName('serena', platform));
    if (existsSyncImpl(shim)) return shim;
  }
  return findExecutable('serena', { ...options, homeDir, platform });
}

function configureCodexSerena({
  home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  enabled = true,
  dryRun = false,
  io = defaultIo(),
  serenaCommand,
  env = process.env,
  ...resolverOptions
} = {}) {
  const configPath = path.join(home, 'config.toml');
  const command = serenaCommand ?? resolveSerenaBinary({ env, ...resolverOptions });

  if (dryRun) {
    const action = enabled ? 'configure' : 'remove';
    io.out(`  [dry-run] would ${action} Codex Serena MCP in ${configPath}`);
    if (enabled && command) io.out(`  [dry-run] Serena command: ${command}`);
    return { ok: true, dryRun: true, changed: [] };
  }

  const currentText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  if (enabled && !command) {
    const nextText = applyCodexSerenaConfig(currentText, { enabled: false, serenaCommand: null });
    if (nextText !== currentText) writeFileIfChanged(configPath, nextText);
    io.err('  error: Serena binary not found; Codex Serena MCP config was not enabled');
    return { ok: false, changed: nextText !== currentText ? [configPath] : [] };
  }

  const nextText = applyCodexSerenaConfig(currentText, { enabled, serenaCommand: command });
  const changed = writeFileIfChanged(configPath, nextText) ? [configPath] : [];
  io.out(
    enabled ? '  configured Codex Serena MCP (native)' : '  removed Codex Serena MCP config',
  );
  return { ok: true, changed };
}

function configureClaudeSerena({
  enabled = true,
  dryRun = false,
  io = defaultIo(),
  spawnSyncImpl = spawnSync,
  serenaCommand,
  env = process.env,
  ...resolverOptions
} = {}) {
  const command = serenaCommand ?? resolveSerenaBinary({ env, spawnSyncImpl, ...resolverOptions });
  const mcp = command ? buildSerenaNativeMcpConfig(command, 'claude-code') : null;

  if (dryRun) {
    const action = enabled ? 'configure' : 'remove';
    io.out(`  [dry-run] would ${action} Claude Serena MCP via claude CLI`);
    if (enabled && command) io.out(`  [dry-run] Serena command: ${command}`);
    return { ok: true, dryRun: true, changed: [] };
  }

  if (!enabled) {
    return removeClaudeSerenaConfig({ io, spawnSyncImpl });
  }

  if (!command || !mcp) {
    removeClaudeSerenaConfig({ io, spawnSyncImpl });
    io.err('  error: Serena binary not found; Claude Serena MCP config was not enabled');
    return { ok: false, changed: [] };
  }

  const payload = JSON.stringify(mcp);
  const probe = spawnSyncImpl('claude', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (probe.status !== 0 || probe.error) {
    io.err('  warning: claude CLI not found; configure Claude Serena MCP manually:');
    io.err(`    claude mcp add-json serena ${shellQuote(payload)} --scope user`);
    return { ok: false, changed: [] };
  }

  const result = spawnSyncImpl('claude', ['mcp', 'add-json', 'serena', payload, '--scope', 'user'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status === 0) {
    io.out('  configured Claude Serena MCP (native)');
    return { ok: true, changed: ['claude:user:serena'] };
  }

  const output = firstOutputLine(result);
  if (/already exists/i.test(output)) {
    const update = spawnSyncImpl(
      'claude',
      ['mcp', 'add-json', '--force', 'serena', payload, '--scope', 'user'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    if (update.status === 0) {
      io.out('  configured Claude Serena MCP (native, updated existing entry)');
      return { ok: true, changed: ['claude:user:serena'] };
    }
  }

  io.err('  warning: failed to configure Claude Serena MCP; manual command:');
  io.err(`    claude mcp add-json serena ${shellQuote(payload)} --scope user`);
  return { ok: false, changed: [] };
}

function removeClaudeSerenaConfig({ io, spawnSyncImpl }) {
  const probe = spawnSyncImpl('claude', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (probe.status !== 0 || probe.error) {
    io.out('  skipped Claude Serena MCP removal (claude CLI not found)');
    return { ok: true, changed: [] };
  }

  const result = spawnSyncImpl('claude', ['mcp', 'remove', 'serena', '--scope', 'user'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const output = firstOutputLine(result);
  if (result.status === 0) {
    io.out('  removed Claude Serena MCP config');
    return { ok: true, changed: ['claude:user:serena'] };
  }
  if (/not found|does not exist|no mcp server/i.test(output)) return { ok: true, changed: [] };

  io.err(`  warning: failed to remove Claude Serena MCP config${output ? ` - ${output}` : ''}`);
  return { ok: false, changed: [] };
}

function findExecutable(binaryName, options = {}) {
  const {
    spawnSyncImpl = spawnSync,
    existsSyncImpl = fs.existsSync,
    env = process.env,
    homeDir = os.homedir(),
    platform = process.platform,
  } = options;
  const lookup = spawnSyncImpl(platform === 'win32' ? 'where' : 'which', [binaryName], {
    encoding: 'utf8',
    stdio: 'pipe',
    env,
  });
  if (lookup.status === 0) {
    for (const candidate of parseLookupOutput(lookup.stdout || '')) {
      if (existsSyncImpl(candidate)) return candidate;
    }
    const [first] = parseLookupOutput(lookup.stdout || '');
    if (first) return first;
  }

  for (const candidate of defaultExecutableCandidates(binaryName, homeDir, platform)) {
    if (existsSyncImpl(candidate)) return candidate;
  }
  return null;
}

function resolveUvToolBinDir(uvBinary, options = {}) {
  if (!uvBinary) return null;
  const { spawnSyncImpl = spawnSync } = options;
  const result = spawnSyncImpl(uvBinary, ['tool', 'dir', '--bin'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return null;
  const [dir] = parseLookupOutput(result.stdout || '');
  return dir || null;
}

function defaultExecutableCandidates(name, homeDir = os.homedir(), platform = process.platform) {
  const exe = executableName(name, platform);
  const candidates = [path.join(homeDir, '.local', 'bin', exe)];
  if (platform === 'win32') {
    candidates.push(path.join(homeDir, 'AppData', 'Local', 'Programs', 'uv', 'bin', exe));
  }
  return candidates;
}

function executableName(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.exe` : name;
}

function parseLookupOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

function removeTomlSection(text) {
  return text.replace(/^\[mcp_servers\.serena\]\n[\s\S]*?(?=^\[|(?![\s\S]))/m, '');
}

function upsertTomlSection(text, lines) {
  const replacement = lines.join('\n');
  const nextText = text.replace(
    /^\[mcp_servers\.serena\]\n[\s\S]*?(?=^\[|(?![\s\S]))/m,
    `${replacement}\n`,
  );
  if (nextText !== text) return nextText;
  const base = text.endsWith('\n') || text.length === 0 ? text : `${text}\n`;
  return `${base}${base.length > 0 ? '\n' : ''}${replacement}\n`;
}

function firstOutputLine(result) {
  return (result.stderr || result.stdout || '').trim().split(/\r?\n/)[0] || '';
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
