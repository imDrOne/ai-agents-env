import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileIfChanged, writeJsonFile } from './platform.js';
import {
  createStatuslineInstallPlan,
  executeStatuslineInstallPlan,
} from './statusline.js';

export const AGENT_DEFINITIONS = Object.freeze({
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    cli: 'claude-env',
    homeEnv: 'CLAUDE_HOME',
    defaultHome: () => path.join(os.homedir(), '.claude'),
    foreignHomes: ['CODEX_HOME'],
    defaultFeatures: {
      plugins: {
        'frontend-design': true,
        plannotator: true,
        superpowers: true,
        warp: true,
        codex: true,
        playwright: true,
        caveman: true,
      },
      skills: {},
      hooks: {
        notifications: true,
        statusline: true,
      },
    },
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    cli: 'codex-env',
    homeEnv: 'CODEX_HOME',
    defaultHome: () => path.join(os.homedir(), '.codex'),
    foreignHomes: ['CLAUDE_HOME'],
    defaultFeatures: {
      plugins: {
        github: true,
        caveman: true,
      },
      skills: {
        'personal-workflow': true,
        'claude-commands-bridge': true,
        'plannotator-compound': true,
      },
      hooks: {
        notifications: true,
      },
    },
  },
});

export function createInstallPlan(agentId, options = {}) {
  const agent = AGENT_DEFINITIONS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const env = options.env ?? process.env;
  const home = options.home ?? env[agent.homeEnv] ?? agent.defaultHome();
  const operations = [
    { kind: 'ensureDir', path: home, agent: agentId },
    {
      kind: 'writeJson',
      path: path.join(home, `${agent.cli}.json`),
      agent: agentId,
      data: {
        version: 1,
        agent: agentId,
        managedBy: agent.cli,
        features: agent.defaultFeatures,
      },
    },
  ];

  if (agentId === 'claude') {
    operations.push(
      { kind: 'ensureDir', path: path.join(home, 'commands'), agent: agentId },
      { kind: 'ensureDir', path: path.join(home, 'hooks'), agent: agentId },
      { kind: 'ensureDir', path: path.join(home, 'agents'), agent: agentId },
      {
        kind: 'writeFile',
        path: path.join(home, 'CLAUDE.md'),
        agent: agentId,
        content: '# Claude Environment\n\nManaged by claude-env.\n',
      },
    );
    if (options.withStatusline !== false) {
      const statuslinePlan = createStatuslineInstallPlan({
        home,
        dryRun: options.dryRun,
        force: options.statuslineForce,
        command: options.statuslineCommand,
        config: options.statuslineConfig,
      });
      operations.push(...statuslinePlan.operations.filter(op => op.kind !== 'ensureDir'));
    }
  } else if (agentId === 'codex') {
    operations.push(
      { kind: 'ensureDir', path: path.join(home, 'rules'), agent: agentId },
      {
        kind: 'writeFile',
        path: path.join(home, 'AGENTS.md'),
        agent: agentId,
        content: '# Codex Environment\n\nManaged by codex-env.\n',
      },
      {
        kind: 'writeFile',
        path: path.join(home, 'config.toml'),
        agent: agentId,
        content: [
          'model = "gpt-5.4"',
          'model_reasoning_effort = "high"',
          '',
          '[features]',
          'multi_agent = true',
          '',
        ].join('\n'),
      },
    );
  }

  return {
    agent: agentId,
    home,
    withSerena: Boolean(options.withSerena),
    dryRun: Boolean(options.dryRun),
    operations,
  };
}

export function formatInstallPlan(plan) {
  return plan.operations
    .map(op => {
      if (op.kind === 'ensureDir') return `ensure directory ${op.path}`;
      if (op.kind === 'writeFile') return `write file ${op.path}`;
      if (op.kind === 'writeJson') return `write json ${op.path}`;
      if (op.kind === 'writeStatuslineConfig') return `write json ${op.path}`;
      if (op.kind === 'mergeClaudeStatusLine') return `merge Claude statusLine into ${op.path}`;
      return `${op.kind} ${op.path ?? ''}`.trim();
    })
    .join('\n');
}

export function executeInstallPlan(plan) {
  const changed = [];
  for (const op of plan.operations) {
    if (op.kind === 'ensureDir') {
      fs.mkdirSync(op.path, { recursive: true });
      changed.push(op.path);
    } else if (op.kind === 'writeFile') {
      if (writeFileIfChanged(op.path, op.content)) changed.push(op.path);
    } else if (op.kind === 'writeJson') {
      if (writeJsonFile(op.path, op.data)) changed.push(op.path);
    } else if (op.kind === 'writeStatuslineConfig' || op.kind === 'mergeClaudeStatusLine') {
      const result = executeStatuslineInstallPlan({ operations: [op] });
      changed.push(...result.changed);
    } else {
      throw new Error(`Unsupported install operation: ${op.kind}`);
    }
  }
  return changed;
}
