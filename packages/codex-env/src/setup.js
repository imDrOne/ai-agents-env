import {
  configureSerenaForAgent,
  createInstallPlan,
  ensurePlannotatorInstalled,
  executeInstallPlan,
  formatInstallPlan,
} from '../../shared/src/index.js';
import {
  cancelSetup,
  ensureInteractive,
  isPromptCancel,
  resolvePromptAdapter,
} from '../../shared/src/prompts.js';
import { syncCodexSkills } from './skills.js';

const COMPONENTS = [
  { value: 'notifications', label: 'Notifications' },
  { value: 'skills', label: 'Sync skills from Claude plugin cache' },
  { value: 'serena', label: 'Serena MCP wiring' },
];

export async function setupCommand(io = defaultIo()) {
  const interactive = ensureInteractive(io);
  if (!interactive.ok) return 1;

  const prompts = resolvePromptAdapter(io);
  prompts.intro?.('codex-env setup');

  const home = await prompts.text({
    message: 'Codex home directory',
    placeholder: '~/.codex',
    defaultValue: process.env.CODEX_HOME || '',
  });
  if (isPromptCancel(prompts, home)) return cancelSetup(prompts);

  const components = await prompts.multiselect({
    message: 'Select Codex components',
    options: COMPONENTS,
    initialValues: ['notifications'],
  });
  if (isPromptCancel(prompts, components)) return cancelSetup(prompts);

  const dryRun = await prompts.confirm({
    message: 'Run as dry-run first?',
    initialValue: true,
  });
  if (isPromptCancel(prompts, dryRun)) return cancelSetup(prompts);

  let cacheRoot;
  let agentsHome;
  if (components.includes('skills')) {
    cacheRoot = await prompts.text({
      message: 'Claude plugin cache root',
      placeholder: '~/.claude/plugins/cache',
    });
    if (isPromptCancel(prompts, cacheRoot)) return cancelSetup(prompts);

    agentsHome = await prompts.text({
      message: 'Agents home directory',
      placeholder: '~/.agents',
      defaultValue: process.env.AGENTS_HOME || '',
    });
    if (isPromptCancel(prompts, agentsHome)) return cancelSetup(prompts);
  }

  const plan = createInstallPlan('codex', {
    home: home || undefined,
    dryRun,
    withSerena: components.includes('serena'),
  });
  io.out(formatInstallPlan(plan));
  if (!dryRun) executeInstallPlan(plan);

  if (components.includes('serena')) {
    const serena = configureSerenaForAgent('codex', {
      home: plan.home,
      dryRun,
      io,
      env: io?.env,
      spawnSyncImpl: io?.spawnSyncImpl,
      existsSyncImpl: io?.existsSyncImpl,
      serenaCommand: io?.serenaCommand,
    });
    if (!serena.ok) return 1;
  }

  const plannotator = ensurePlannotatorInstalled({
    dryRun,
    io,
    spawnSyncImpl: io?.spawnSyncImpl,
    platform: io?.platform,
  });
  if (!plannotator.ok) return 1;

  if (components.includes('skills')) {
    const result = syncCodexSkills({
      dryRun,
      cacheRoot: cacheRoot || undefined,
      agentsHome: agentsHome || undefined,
      io,
    });
    if (!result.ok) return 1;
  }

  prompts.outro?.(dryRun ? 'Dry-run complete.' : 'Setup complete.');
  return 0;
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
