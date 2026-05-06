import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import { createDashboardHandler } from '../packages/dashboard/src/server.js';

test('dashboard server serves built index html', async () => {
  const { handler } = createTestHandler();
  const response = await callHandler(handler, { url: '/', method: 'GET' });

  assert.equal(response.status, 200);
  assert.match(response.text, /agent-env-dashboard test/);
});

test('dashboard status api returns adapters and serena status', async () => {
  const { handler } = createTestHandler();
  const response = await callHandler(handler, { url: '/api/status', method: 'GET' });
  const body = JSON.parse(response.text);

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body.adapters), true);
  assert.equal(typeof body.serena.dashboardUrl, 'string');
});

test('dashboard install api dry-run does not create homes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-api-install-'));
  const { handler } = createTestHandler();
  const response = await callHandler(handler, {
    url: '/api/install',
    method: 'POST',
    body: {
      claudeHome: path.join(root, '.claude'),
      codexHome: path.join(root, '.codex'),
      serenaClients: 'none',
      dryRun: true,
    },
  });
  const body = JSON.parse(response.text);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
});

test('dashboard statusline api previews and installs settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-statusline-'));
  const home = path.join(root, '.claude');
  const { handler } = createTestHandler();

  const statusResponse = await callHandler(handler, {
    url: `/api/statusline?home=${encodeURIComponent(home)}`,
    method: 'GET',
  });
  const status = JSON.parse(statusResponse.text);
  assert.equal(statusResponse.status, 200);
  assert.match(status.preview, /claude-opus-4-7/);

  const installResponse = await callHandler(handler, {
    url: '/api/statusline/install',
    method: 'POST',
    body: { home, dryRun: false },
  });
  const install = JSON.parse(installResponse.text);
  assert.equal(installResponse.status, 200);
  assert.equal(install.result.skipped.length, 0);
  assert.equal(fs.existsSync(path.join(home, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(home, 'statusline.json')), true);
});

test('dashboard cleanup api rejects unconfirmed wipe', async () => {
  const { handler } = createTestHandler();
  const response = await callHandler(handler, {
    url: '/api/cleanup/global',
    method: 'POST',
    body: { agent: 'codex', wipe: true, dryRun: false },
  });
  const body = JSON.parse(response.text);

  assert.equal(response.status, 400);
  assert.match(body.error, /confirmWipe/);
});

function createTestHandler() {
  const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-web-'));
  fs.writeFileSync(path.join(webDist, 'index.html'), '<h1>agent-env-dashboard test</h1>', 'utf8');
  return { handler: createDashboardHandler({ webDist }) };
}

function callHandler(handler, { url, method, body }) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(text ? [text] : []);
  req.url = url;
  req.method = method;

  let status = 200;
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.writeHead = (nextStatus, nextHeaders = {}) => {
    status = nextStatus;
    res.headers = nextHeaders;
    return res;
  };
  res.end = chunk => {
    if (chunk) chunks.push(Buffer.from(chunk));
    res.emit('finish');
    return res;
  };

  return new Promise((resolve, reject) => {
    res.once('finish', () => {
      resolve({
        status,
        headers: res.headers ?? {},
        text: Buffer.concat(chunks).toString('utf8'),
      });
    });
    handler(req, res).catch?.(reject);
  });
}
