import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createCodexSkillSyncPlan,
  executeCodexSkillSyncPlan,
  readCodexSkillManifest,
  syncCodexSkills,
} from '../packages/codex-env/src/skills.js';
import { main as codexMain } from '../packages/codex-env/src/cli.js';

function writeManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
  const manifestFile = path.join(dir, 'codex-skills.txt');
  fs.writeFileSync(
    manifestFile,
    [
      '# <skill-name> <marketplace>/<plugin>',
      '* claude-plugins-official/superpowers *',
      '',
      'caveman caveman/caveman caveman',
      '',
    ].join('\n'),
    'utf8',
  );
  return { dir, manifestFile };
}

function createPluginSkillCache(cacheRoot, marketplace, plugin, versions) {
  for (const version of versions) {
    const skillDir = path.join(cacheRoot, marketplace, plugin, version, 'skills', plugin);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${plugin} ${version}\n`, 'utf8');
  }
}

function createMultiSkillCache(cacheRoot, marketplace, plugin, version, skillNames) {
  for (const skillName of skillNames) {
    const skillDir = path.join(cacheRoot, marketplace, plugin, version, 'skills', skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
  }
}

test('readCodexSkillManifest parses skill mappings', () => {
  const { manifestFile } = writeManifest();
  const manifest = readCodexSkillManifest({ manifestFile });

  assert.deepEqual(manifest, [
    {
      destination: '*',
      marketplace: 'claude-plugins-official',
      plugin: 'superpowers',
      sourceSkill: '*',
    },
    {
      destination: 'caveman',
      marketplace: 'caveman',
      plugin: 'caveman',
      sourceSkill: 'caveman',
    },
  ]);
});

test('createCodexSkillSyncPlan selects newest concrete child skill directories', () => {
  const { manifestFile, dir } = writeManifest();
  const cacheRoot = path.join(dir, 'cache');
  const agentsHome = path.join(dir, 'agents');
  createMultiSkillCache(cacheRoot, 'claude-plugins-official', 'superpowers', '001-old', ['brainstorming']);
  createMultiSkillCache(cacheRoot, 'claude-plugins-official', 'superpowers', '003-new', [
    'brainstorming',
    'written-plan',
  ]);

  const plan = createCodexSkillSyncPlan({ manifestFile, cacheRoot, agentsHome });
  const brainstorming = plan.operations.find(op => op.skillName === 'brainstorming');
  const writtenPlan = plan.operations.find(op => op.skillName === 'written-plan');
  const caveman = plan.operations.find(op => op.destination === 'caveman');

  assert.ok(brainstorming);
  assert.ok(writtenPlan);
  assert.equal(brainstorming.kind, 'copySkill');
  assert.equal(writtenPlan.kind, 'copySkill');
  assert.match(brainstorming.source, /003-new\/skills\/brainstorming$/);
  assert.equal(brainstorming.target, path.join(agentsHome, 'skills', 'brainstorming'));
  assert.ok(caveman);
  assert.equal(caveman.kind, 'missingSkillSource');
});

test('syncCodexSkills dry-run does not write target skills', () => {
  const { manifestFile, dir } = writeManifest();
  const cacheRoot = path.join(dir, 'cache');
  const agentsHome = path.join(dir, 'agents');
  createPluginSkillCache(cacheRoot, 'caveman', 'caveman', ['v1']);
  const lines = [];

  const result = syncCodexSkills({
    manifestFile,
    cacheRoot,
    agentsHome,
    dryRun: true,
    io: { out: message => lines.push(message), err: message => lines.push(message) },
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(agentsHome, 'skills', 'caveman')), false);
  assert.match(lines.join('\n'), /would copy skill caveman/);
});

test('executeCodexSkillSyncPlan copies concrete skill directories', () => {
  const { manifestFile, dir } = writeManifest();
  const cacheRoot = path.join(dir, 'cache');
  const agentsHome = path.join(dir, 'agents');
  createPluginSkillCache(cacheRoot, 'caveman', 'caveman', ['v1']);
  const plan = createCodexSkillSyncPlan({ manifestFile, cacheRoot, agentsHome });

  const result = executeCodexSkillSyncPlan(plan, { io: { out: () => {}, err: () => {} } });

  assert.equal(result.copied, 1);
  assert.equal(fs.existsSync(path.join(agentsHome, 'skills', 'caveman', 'SKILL.md')), true);
  assert.equal(fs.readFileSync(path.join(agentsHome, 'skills', 'caveman', 'SKILL.md'), 'utf8'), '# caveman v1\n');
});

test('codex-env skills sync command supports dry-run', async () => {
  const { manifestFile, dir } = writeManifest();
  const cacheRoot = path.join(dir, 'cache');
  const agentsHome = path.join(dir, 'agents');
  createPluginSkillCache(cacheRoot, 'claude-plugins-official', 'superpowers', ['v1']);
  const lines = [];

  const code = await codexMain(
    [
      'skills',
      'sync',
      '--dry-run',
      '--manifest-file',
      manifestFile,
      '--cache-root',
      cacheRoot,
      '--agents-home',
      agentsHome,
    ],
    { out: message => lines.push(message), err: message => lines.push(message) },
  );

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /would copy skill superpowers/);
  assert.equal(fs.existsSync(path.join(agentsHome, 'skills', 'superpowers')), false);
});
