import {
  configureSerenaForAgent,
  createInstallPlan,
  executeInstallPlan,
  formatInstallPlan,
} from '../../shared/src/index.js';
import {
  cancelSetup,
  ensureInteractive,
  isPromptCancel,
  resolvePromptAdapter,
} from '../../shared/src/prompts.js';
import { installClaudePlugins, readClaudePluginManifest } from './plugins.js';

const COMPONENTS = [
  { value: 'plugins', label: 'Claude plugins' },
  { value: 'notifications', label: 'Notification hooks' },
  { value: 'statusline', label: 'Claude statusline' },
  { value: 'serena', label: 'Serena MCP wiring' },
];

export async function setupCommand(io = defaultIo()) {
  const interactive = ensureInteractive(io);
  if (!interactive.ok) return 1;

  const prompts = resolvePromptAdapter(io);
  prompts.intro?.('claude-env setup');

  const home = await prompts.text({
    message: 'Claude home directory',
    placeholder: '~/.claude',
    defaultValue: process.env.CLAUDE_HOME || '',
  });
  if (isPromptCancel(prompts, home)) return cancelSetup(prompts);

  const components = await prompts.multiselect({
    message: 'Select Claude components',
    options: COMPONENTS,
    initialValues: ['plugins', 'notifications', 'statusline'],
  });
  if (isPromptCancel(prompts, components)) return cancelSetup(prompts);

  const dryRun = await prompts.confirm({
    message: 'Run as dry-run first?',
    initialValue: true,
  });
  if (isPromptCancel(prompts, dryRun)) return cancelSetup(prompts);

  let selectedPlugins = null;
  if (components.includes('plugins')) {
    const manifest = readClaudePluginManifest();
    selectedPlugins = await prompts.multiselect({
      message: 'Select Claude plugins',
      options: manifest.plugins.map(plugin => ({ value: plugin, label: plugin })),
      initialValues: manifest.plugins,
    });
    if (isPromptCancel(prompts, selectedPlugins)) return cancelSetup(prompts);
  }

  const plan = createInstallPlan('claude', {
    home: home || undefined,
    dryRun,
    withSerena: components.includes('serena'),
    withStatusline: components.includes('statusline'),
  });
  io.out(formatInstallPlan(plan));
  if (!dryRun) executeInstallPlan(plan);

  if (components.includes('serena')) {
    const serena = configureSerenaForAgent('claude', {
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

  if (components.includes('plugins')) {
    const result = installClaudePlugins({
      dryRun,
      io,
      onlyPlugins: selectedPlugins,
      spawnSyncImpl: io?.spawnSyncImpl,
      platform: io?.platform,
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
