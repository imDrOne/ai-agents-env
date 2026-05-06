import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createClaudePluginPlan, installClaudePlugins, readClaudePluginManifest } from '../../claude-env/src/plugins.js';
import {
  createCodexSkillSyncPlan,
  readCodexSkillManifest,
  syncCodexSkills,
} from '../../codex-env/src/skills.js';
import {
  AGENT_DEFINITIONS,
  addSoundsToLibrary,
  applyProjectFeatureChange,
  createStatuslineInstallPlan,
  assignEventSounds,
  createGlobalCleanupPlan,
  createInstallPlan,
  createProjectCleanupPlan,
  executeStatuslineInstallPlan,
  executeCleanupPlan,
  formatCleanupPlan,
  formatInstallPlan,
  formatStatuslineInstallPlan,
  getProjectStatus,
  getSerenaStatus,
  getStatuslineStatus,
  initProjectProfile,
  listProjectFeatures,
  listSoundSettings,
  playSoundFile,
  writeStatuslineConfig,
} from '../../shared/src/index.js';
import { discoverAdapters, runDashboardInstall } from './cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, '..');
const WEB_DIST = path.join(DASHBOARD_ROOT, 'web', 'dist');
const DEFAULT_PORT = 7200;
const HOST = '127.0.0.1';

export function startDashboardServer(options = {}) {
  const port = Number(options.port ?? DEFAULT_PORT);
  const host = options.host ?? HOST;
  const open = Boolean(options.open ?? true);
  const server = http.createServer(createDashboardHandler(options));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const url = `http://localhost:${port}`;
      options.io?.out?.(`agent-env-dashboard UI: ${url}`);
      if (open) openBrowser(url, options);
      resolve({ server, url });
    });
  });
}

export function createDashboardHandler(options = {}) {
  const webDist = options.webDist ?? WEB_DIST;
  const services = { ...defaultServices(), ...(options.services ?? {}) };

  return async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://localhost');
      if (requestUrl.pathname.startsWith('/api/')) {
        const body = await readJsonBody(req);
        const payload = await handleApi(requestUrl, req.method ?? 'GET', body, services);
        sendJson(res, payload.status ?? 200, payload.body);
        return;
      }
      serveStatic(req, res, requestUrl.pathname, webDist);
    } catch (error) {
      sendJson(res, error.statusCode ?? 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function defaultServices() {
  return {
    addSoundsToLibrary,
    applyProjectFeatureChange,
    assignEventSounds,
    createGlobalCleanupPlan,
    createInstallPlan,
    createProjectCleanupPlan,
    executeCleanupPlan,
    formatCleanupPlan,
    formatInstallPlan,
    getProjectStatus,
    getSerenaStatus,
    initProjectProfile,
    installClaudePlugins,
    listProjectFeatures,
    listSoundSettings,
    playSoundFile,
    readClaudePluginManifest,
    readCodexSkillManifest,
    createClaudePluginPlan,
    createCodexSkillSyncPlan,
    createStatuslineInstallPlan,
    runDashboardInstall,
    executeStatuslineInstallPlan,
    formatStatuslineInstallPlan,
    getStatuslineStatus,
    writeStatuslineConfig,
    syncCodexSkills,
  };
}

async function handleApi(url, method, body, services) {
  const route = `${method.toUpperCase()} ${url.pathname}`;
  if (route === 'GET /api/status') return ok(statusPayload(services));
  if (route === 'POST /api/install') return ok(captureOutput(io => services.runDashboardInstall(body, io)));
  if (route === 'GET /api/plugins/claude') return ok(claudePluginsPayload(services));
  if (route === 'POST /api/plugins/claude/install') {
    return ok(captureOutput(io => services.installClaudePlugins({ ...body, io })));
  }
  if (route === 'GET /api/skills/codex') return ok(codexSkillsPayload(services));
  if (route === 'POST /api/skills/codex/sync') {
    return ok(captureOutput(io => services.syncCodexSkills({ ...body, io })));
  }
  if (route === 'GET /api/project/status') {
    const agent = requiredSearch(url, 'agent');
    const projectPath = url.searchParams.get('projectPath') || process.cwd();
    return ok(services.getProjectStatus(agent, projectPath));
  }
  if (route === 'POST /api/project/init') {
    return ok(services.initProjectProfile(requireBody(body, 'agent'), body.projectPath, { scope: body.scope }));
  }
  if (route === 'POST /api/project/feature') {
    return ok(
      services.applyProjectFeatureChange(requireBody(body, 'agent'), body.projectPath, {
        scope: body.scope,
        type: requireBody(body, 'type'),
        name: requireBody(body, 'name'),
        enabled: Boolean(body.enabled),
      }),
    );
  }
  if (route === 'GET /api/project/features') {
    return ok(services.listProjectFeatures(requiredSearch(url, 'agent')));
  }
  if (route === 'GET /api/sounds') {
    return ok(services.listSoundSettings(requiredSearch(url, 'agent'), soundOptions(url)));
  }
  if (route === 'POST /api/sounds/assign') {
    return ok(
      services.assignEventSounds(
        requireBody(body, 'agent'),
        requireBody(body, 'event'),
        requireBody(body, 'soundNames'),
        body,
      ),
    );
  }
  if (route === 'POST /api/sounds/upload') return ok(uploadSound(body, services));
  if (route === 'POST /api/sounds/test') {
    services.playSoundFile(requireBody(body, 'path'));
    return ok({ ok: true });
  }
  if (route === 'POST /api/cleanup/global') return ok(cleanupGlobal(body, services));
  if (route === 'POST /api/cleanup/project') return ok(cleanupProject(body, services));
  if (route === 'GET /api/serena/status') return ok(services.getSerenaStatus());
  if (route === 'GET /api/statusline') {
    return ok(services.getStatuslineStatus({ home: url.searchParams.get('home') || undefined }));
  }
  if (route === 'POST /api/statusline/install') return ok(statuslineInstall(body, services));
  if (route === 'POST /api/statusline/config') return ok(statuslineConfig(body, services));

  return {
    status: 404,
    body: { ok: false, error: `Unknown route: ${route}` },
  };
}

function statuslineConfig(body, services) {
  const { home, ...bodyConfig } = body;
  const changed = services.writeStatuslineConfig(home, body.config ?? bodyConfig);
  return {
    ok: true,
    changed,
    status: services.getStatuslineStatus({ home }),
  };
}

function statuslineInstall(body, services) {
  const plan = services.createStatuslineInstallPlan({
    home: body.home,
    dryRun: Boolean(body.dryRun),
    force: Boolean(body.force),
    config: typeof body.enabled === 'boolean' ? { enabled: body.enabled } : undefined,
  });
  const formatted = services.formatStatuslineInstallPlan(plan);
  if (plan.dryRun) return { plan, formatted, result: { dryRun: true, changed: [], skipped: [] } };
  const result = services.executeStatuslineInstallPlan(plan);
  return { plan, formatted, result };
}

function statusPayload(services) {
  const homes = Object.fromEntries(
    Object.entries(AGENT_DEFINITIONS).map(([agentId, agent]) => {
      const home = process.env[agent.homeEnv] ?? agent.defaultHome();
      return [
        agentId,
        {
          home,
          configPath: path.join(home, `${agent.cli}.json`),
          installed: fs.existsSync(path.join(home, `${agent.cli}.json`)),
        },
      ];
    }),
  );
  return {
    adapters: discoverAdapters(),
    serena: services.getSerenaStatus(),
    homes,
  };
}

function claudePluginsPayload(services) {
  const manifest = services.readClaudePluginManifest();
  const plan = services.createClaudePluginPlan();
  return {
    manifest,
    operations: plan.operations,
  };
}

function codexSkillsPayload(services) {
  const manifest = services.readCodexSkillManifest();
  const plan = services.createCodexSkillSyncPlan();
  return {
    manifest,
    agentsHome: plan.agentsHome,
    cacheRoot: plan.cacheRoot,
    operations: plan.operations,
    copyable: plan.operations.filter(operation => operation.kind === 'copySkill').length,
    missing: plan.operations.filter(operation => operation.kind === 'missingSkillSource').length,
  };
}

function cleanupGlobal(body, services) {
  const dryRun = Boolean(body.dryRun);
  const wipe = Boolean(body.wipe);
  if (wipe && !dryRun && !body.confirmWipe) {
    const error = new Error('Global wipe requires confirmWipe=true.');
    error.statusCode = 400;
    throw error;
  }
  const plan = services.createGlobalCleanupPlan(requireBody(body, 'agent'), {
    home: body.home,
    wipe,
  });
  const formatted = services.formatCleanupPlan(plan);
  const result = services.executeCleanupPlan(plan, { dryRun });
  return { plan, formatted, result };
}

function cleanupProject(body, services) {
  const plan = services.createProjectCleanupPlan(requireBody(body, 'agent'), {
    projectPath: body.projectPath,
    scope: body.scope,
  });
  const formatted = services.formatCleanupPlan(plan);
  const result = services.executeCleanupPlan(plan, { dryRun: Boolean(body.dryRun) });
  return { plan, formatted, result };
}

function uploadSound(body, services) {
  const agent = requireBody(body, 'agent');
  const fileName = path.basename(requireBody(body, 'fileName'));
  const contentBase64 = requireBody(body, 'contentBase64');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-sound-'));
  const tmpFile = path.join(tmpDir, fileName);
  fs.writeFileSync(tmpFile, Buffer.from(contentBase64, 'base64'));
  try {
    const result = services.addSoundsToLibrary([tmpFile], body);
    if (body.assignEvent && result.added.length > 0) {
      const names = result.added.map(file => file.name);
      const assignment = services.assignEventSounds(agent, body.assignEvent, names, {
        ...body,
        soundDir: result.soundsDir,
      });
      return { ...result, assignment };
    }
    return result;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function captureOutput(fn) {
  const output = [];
  const errors = [];
  const io = {
    out: message => output.push(String(message)),
    err: message => errors.push(String(message)),
  };
  const result = fn(io);
  const ok = typeof result === 'number' ? result === 0 : result?.ok !== false;
  return { ok, result, output, errors };
}

function ok(body) {
  return { status: 200, body };
}

function requiredSearch(url, name) {
  const value = url.searchParams.get(name);
  if (!value) {
    const error = new Error(`Missing query parameter: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function requireBody(body, name) {
  const value = body?.[name];
  if (value === undefined || value === null || value === '') {
    const error = new Error(`Missing field: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function soundOptions(url) {
  return {
    home: url.searchParams.get('home') || undefined,
    soundDir: url.searchParams.get('soundDir') || undefined,
  };
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function serveStatic(req, res, requestPath, webDist) {
  const filePath = resolveStaticPath(requestPath, webDist);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      const indexPath = path.join(webDist, 'index.html');
      fs.readFile(indexPath, (indexError, indexData) => {
        if (indexError) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Dashboard UI is not built. Run npm run build:web.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
}

function resolveStaticPath(requestPath, webDist) {
  const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
  const normalized = path.normalize(decodeURIComponent(cleanPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(webDist, normalized);
  return filePath.startsWith(webDist) ? filePath : null;
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function openBrowser(url, options = {}) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  spawnSyncImpl(opener, [url], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
}
