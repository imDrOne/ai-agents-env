import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyProjectFeatureChange,
  getProjectStatus,
  initProjectProfile,
  projectProfilePath,
} from '../packages/shared/src/index.js';

test('project overrides are local by default and agent-scoped', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-project-'));

  const result = applyProjectFeatureChange('claude', project, {
    type: 'plugin',
    name: 'superpowers',
    enabled: false,
  });

  assert.equal(result.scope, 'local');
  assert.equal(result.path, projectProfilePath('claude', project, 'local'));
  assert.equal(fs.existsSync(projectProfilePath('claude', project, 'local')), true);
  assert.equal(fs.existsSync(projectProfilePath('claude', project, 'tracked')), false);
  assert.equal(fs.existsSync(projectProfilePath('codex', project, 'local')), false);

  const claudeStatus = getProjectStatus('claude', project);
  const codexStatus = getProjectStatus('codex', project);
  assert.equal(claudeStatus.effective.plugins.superpowers, false);
  assert.equal(claudeStatus.sources.plugins.superpowers, 'local');
  assert.equal(codexStatus.effective.plugins.github, true);
});

test('tracked project profile is explicit', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-project-'));

  const init = initProjectProfile('codex', project, { scope: 'tracked' });
  applyProjectFeatureChange('codex', project, {
    type: 'skill',
    name: 'personal-workflow',
    enabled: false,
    scope: 'tracked',
  });

  assert.equal(init.scope, 'tracked');
  assert.equal(fs.existsSync(projectProfilePath('codex', project, 'tracked')), true);
  assert.equal(fs.existsSync(projectProfilePath('codex', project, 'local')), false);

  const status = getProjectStatus('codex', project);
  assert.equal(status.effective.skills['personal-workflow'], false);
  assert.equal(status.sources.skills['personal-workflow'], 'tracked');
});

test('local project profile is added to git info exclude when available', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-project-'));
  fs.mkdirSync(path.join(project, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(project, '.git', 'info', 'exclude'), '# local excludes\n', 'utf8');

  applyProjectFeatureChange('claude', project, {
    type: 'plugin',
    name: 'superpowers',
    enabled: false,
  });

  const exclude = fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\.agent-env\.local\/$/m);
});
