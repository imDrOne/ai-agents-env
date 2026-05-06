import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeJsonFile } from './platform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const R = '\x1b[0m';
const gray = '\x1b[0;90m';
const cyan = '\x1b[0;36m';
const bold = '\x1b[1m';
const white = '\x1b[0;37m';
const yellow = '\x1b[0;33m';
const dim = '\x1b[2m';
const red = '\x1b[0;31m';
const green = '\x1b[0;32m';
const orange = '\x1b[0;33m';
const ICON = '\u{1F504}';
const SEP = `  ${gray}\u2502${R}  `;
const PHRASE_FILE = path.join(os.tmpdir(), 'cc_pump_phrase.json');
const PHRASE_TTL = 30 * 60 * 1000;

export const DEFAULT_STATUSLINE_CONFIG = Object.freeze({
  version: 1,
  managedBy: 'claude-env',
  enabled: true,
  preset: 'draft',
  padding: 0,
  refreshInterval: 60,
  segments: {
    dateTime: true,
    project: true,
    git: true,
    model: true,
    context: true,
    fiveHourLimit: true,
    session: true,
    weeklyLimit: true,
    pumpPhrase: true,
  },
});

export function statuslineConfigPath(home = claudeHome()) {
  return path.join(home, 'statusline.json');
}

export function claudeSettingsPath(home = claudeHome()) {
  return path.join(home, 'settings.json');
}

export function createStatuslineInstallPlan(options = {}) {
  const home = options.home ?? claudeHome(options.env);
  const config = normalizeStatuslineConfig(options.config);
  const command = resolveStatuslineCommand(options);
  return {
    agent: 'claude',
    home,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    command,
    operations: [
      { kind: 'ensureDir', path: home, agent: 'claude' },
      {
        kind: 'writeStatuslineConfig',
        path: statuslineConfigPath(home),
        agent: 'claude',
        data: config,
      },
      {
        kind: 'mergeClaudeStatusLine',
        path: claudeSettingsPath(home),
        agent: 'claude',
        statusLine: buildClaudeStatusLine({ command, config }),
        force: Boolean(options.force),
      },
    ],
  };
}

export function formatStatuslineInstallPlan(plan) {
  return plan.operations
    .map(op => {
      if (op.kind === 'ensureDir') return `ensure directory ${op.path}`;
      if (op.kind === 'writeStatuslineConfig') return `write json ${op.path}`;
      if (op.kind === 'mergeClaudeStatusLine') return `merge Claude statusLine into ${op.path}`;
      return `${op.kind} ${op.path ?? ''}`.trim();
    })
    .join('\n');
}

export function executeStatuslineInstallPlan(plan) {
  const changed = [];
  const skipped = [];
  for (const op of plan.operations) {
    if (op.kind === 'ensureDir') {
      fs.mkdirSync(op.path, { recursive: true });
      changed.push(op.path);
    } else if (op.kind === 'writeStatuslineConfig') {
      if (writeJsonFile(op.path, op.data)) changed.push(op.path);
    } else if (op.kind === 'mergeClaudeStatusLine') {
      const result = mergeClaudeStatusLine(op.path, op.statusLine, { force: op.force });
      if (result.changed) changed.push(op.path);
      if (result.skipped) skipped.push({ ...op, reason: result.reason });
    } else {
      throw new Error(`Unsupported statusline install operation: ${op.kind}`);
    }
  }
  return { changed, skipped };
}

export function getStatuslineStatus(options = {}) {
  const home = options.home ?? claudeHome(options.env);
  const configPath = statuslineConfigPath(home);
  const settingsPath = claudeSettingsPath(home);
  const config = readStatuslineConfig(home);
  const settings = readJson(settingsPath, {});
  const statusLine = settings?.statusLine;
  const command = resolveStatuslineCommand(options);
  const expected = buildClaudeStatusLine({ command, config });
  return {
    home,
    configPath,
    settingsPath,
    config,
    command,
    expectedStatusLine: expected,
    installed: sameStatusLine(statusLine, expected),
    hasStatusLine: Boolean(statusLine),
    conflict: Boolean(statusLine && !sameStatusLine(statusLine, expected)),
    statusLine: statusLine ?? null,
    preview: renderStatusline(mockStatuslineData(), { home }),
  };
}

export function readStatuslineConfig(home = claudeHome()) {
  const filePath = statuslineConfigPath(home);
  const saved = readJson(filePath, null);
  return normalizeStatuslineConfig(saved);
}

export function writeStatuslineConfig(home, config) {
  const filePath = statuslineConfigPath(home);
  const data = normalizeStatuslineConfig(config);
  return writeJsonFile(filePath, data);
}

export function buildClaudeStatusLine({ command, config = DEFAULT_STATUSLINE_CONFIG }) {
  return {
    type: 'command',
    command,
    padding: Number(config.padding ?? DEFAULT_STATUSLINE_CONFIG.padding),
    refreshInterval: Number(config.refreshInterval ?? DEFAULT_STATUSLINE_CONFIG.refreshInterval),
  };
}

export function renderStatusline(data, options = {}) {
  const config = normalizeStatuslineConfig(options.config ?? readStatuslineConfig(options.home));
  if (!config.enabled) return '\n';
  const segments = config.segments ?? DEFAULT_STATUSLINE_CONFIG.segments;

  const model = data?.model?.display_name ?? 'Claude';
  const ctxPct = data?.context_window?.used_percentage ?? 0;
  const five = data?.rate_limits?.five_hour ?? {};
  const fivePct = five?.used_percentage ?? 0;
  const resetsAt = five?.resets_at ?? 0;
  const sevenDay = data?.rate_limits?.seven_day ?? {};
  const wkPct = sevenDay?.used_percentage ?? null;
  const wkResetsAt = sevenDay?.resets_at ?? null;

  const sessId = getSessionId();
  const sessHash = absHash(sessId);
  const sessFile = path.join(os.tmpdir(), `cc_sess_${sessHash}.json`);
  const sessUsage = readOrCreateSession(sessFile, fivePct);

  const gitBranch = run('git', ['branch', '--show-current']);
  const gitChangedRaw = run('git', ['status', '--short']);
  const gitChanged = gitChangedRaw ? gitChangedRaw.split('\n').filter(Boolean).length : 0;
  const projectName = path.basename(process.cwd());
  const pumpPhrase = readPumpPhrase();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  let out = segments.dateTime ? `${gray}${dateStr}${R}  ${white}${bold}${timeStr}${R}` : '';
  if (segments.project && projectName) out += `${out ? SEP : ''}${cyan}\u2341 ${projectName}${R}`;
  if (segments.git && gitBranch) out += `  ${gray}on${R} ${yellow}${gitBranch}${R}`;
  if (segments.git && gitChanged > 0) out += `  ${gray}~${gitChanged} files${R}`;
  out += '\n';

  const second = [];
  if (segments.model) second.push(`${cyan}${bold}${model}${R}`);
  if (segments.context) {
    second.push(`${gray}ctx${R} ${progressBar(ctxPct)} ${colorForPct(ctxPct)}${Math.floor(ctxPct)}%${R}`);
  }
  if (segments.fiveHourLimit) {
    let part = `${gray}5h${R} ${progressBar(fivePct)} ${pctStr(fivePct)}`;
    if (resetsAt) {
      const mins = Math.max(0, Math.floor((resetsAt - Date.now() / 1000) / 60));
      if (mins > 0) part += ` ${gray} ${ICON}${fmtDuration(mins)}${R}`;
    }
    second.push(part);
  }
  if (segments.session && sessUsage) second.push(`${gray}sess${R} ${pctStr(sessUsage)}`);
  if (segments.weeklyLimit && wkPct !== null) {
    let part = `${gray}week${R} ${progressBar(wkPct)} ${pctStr(wkPct)}`;
    if (wkResetsAt) part += ` ${gray}${fmtResetsWeekly(wkResetsAt)}${R}`;
    second.push(part);
  }

  out += second.join('  ');
  if (segments.pumpPhrase && pumpPhrase) out += `${SEP}${dim}"${pumpPhrase}"${R}`;
  return `${out}\n`;
}

export function readPumpPhrase() {
  try {
    if (!fs.existsSync(PHRASE_FILE)) return null;
    const cached = JSON.parse(fs.readFileSync(PHRASE_FILE, 'utf8'));
    const phrase = cached?.phrase;
    const ts = (cached?.ts ?? 0) * 1000;
    if (phrase && Date.now() - ts < PHRASE_TTL) return phrase;
  } catch {
    /* ignore */
  }
  return null;
}

export function statuslineMain(_argv, options = {}) {
  let raw = '';
  try {
    raw = options.stdin ?? fs.readFileSync('/dev/stdin', 'utf8');
  } catch {
    options.out?.('\n') ?? process.stdout.write('\n');
    return 0;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    options.out?.('\n') ?? process.stdout.write('\n');
    return 0;
  }

  const rendered = renderStatusline(data, options);
  options.out?.(rendered) ?? process.stdout.write(rendered);
  return 0;
}

export function mockStatuslineData() {
  return {
    model: { display_name: 'claude-opus-4-7' },
    context_window: { used_percentage: 38 },
    rate_limits: {
      five_hour: { used_percentage: 22, resets_at: 0 },
      seven_day: { used_percentage: 11 },
    },
  };
}

function mergeClaudeStatusLine(settingsPath, statusLine, options = {}) {
  const settings = readJson(settingsPath, {});
  const current = settings?.statusLine;
  if (current && !sameStatusLine(current, statusLine) && !options.force) {
    return { changed: false, skipped: true, reason: 'existing-statusline' };
  }
  const next = { ...settings, statusLine };
  if (JSON.stringify(settings) === JSON.stringify(next)) return { changed: false };
  writeJsonFile(settingsPath, next);
  return { changed: true };
}

function sameStatusLine(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function normalizeStatuslineConfig(config) {
  return {
    ...DEFAULT_STATUSLINE_CONFIG,
    ...(config ?? {}),
    segments: {
      ...DEFAULT_STATUSLINE_CONFIG.segments,
      ...(config?.segments ?? {}),
    },
  };
}

function resolveStatuslineCommand(options = {}) {
  if (options.command) return options.command;
  const bin = options.binPath ?? path.resolve(__dirname, '..', '..', 'claude-env', 'bin', 'claude-env');
  return `${shellQuote(process.execPath)} ${shellQuote(bin)} statusline`;
}

function shellQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function claudeHome(env = process.env) {
  return env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function colorForPct(pct) {
  if (pct >= 80) return red;
  if (pct >= 50) return orange;
  return green;
}

function pctStr(pct) {
  return `${colorForPct(pct)}${Math.floor(pct)}%${R}`;
}

function fmtDuration(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h|${String(m).padStart(2, '0')}m` : `${h}h`;
  }
  return `${mins}m`;
}

function fmtResetsWeekly(ts) {
  const dt = new Date(ts * 1000);
  const day = dt.toLocaleDateString('en-US', { weekday: 'short' });
  const hour = dt.getHours();
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return ` ${ICON}${day} ${h12}${ampm}`;
}

function progressBar(pct, width = 8) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `${gray}[${R}${colorForPct(pct)}${'█'.repeat(filled)}${gray}${'░'.repeat(empty)}]${R}`;
}

function run(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2000 });
    return (result.stdout || '').trim();
  } catch {
    return '';
  }
}

function getSessionId() {
  return (
    process.env.WT_SESSION ||
    process.env.TERM_SESSION_ID ||
    process.env.WINDOWID ||
    String(process.ppid ?? process.pid)
  );
}

function absHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1_000_000;
}

function readOrCreateSession(sessFile, fivePct) {
  try {
    if (fs.existsSync(sessFile)) {
      const saved = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      return Math.max(0, Math.round((fivePct - (saved.win_start ?? fivePct)) * 10) / 10);
    }
    fs.writeFileSync(
      sessFile,
      JSON.stringify({ win_start: fivePct, ts: Date.now() / 1000 }),
      'utf8',
    );
    return 0;
  } catch {
    return null;
  }
}
