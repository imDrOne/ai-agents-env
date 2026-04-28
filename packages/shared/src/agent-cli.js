import {
  createInstallPlan,
  executeInstallPlan,
  formatInstallPlan,
} from './install-plan.js';
import {
  createGlobalCleanupPlan,
  createProjectCleanupPlan,
  executeCleanupPlan,
  formatCleanupPlan,
} from './cleanup.js';
import {
  applyProjectFeatureChange,
  getProjectStatus,
  initProjectProfile,
  listProjectFeatures,
} from './project-env.js';
import { cancelSetup, ensureInteractive, isPromptCancel, resolvePromptAdapter } from './prompts.js';

export async function runAgentCli(agentId, argv, io = defaultIo()) {
  const [command = 'help', ...rest] = argv;

  try {
    if (command === 'install') return installCommand(agentId, rest, io);
    if (command === 'project') return projectCommand(agentId, rest, io);
    if (command === 'clean') return cleanCommand(agentId, rest, io);
    if (command === 'status') {
      io.out(JSON.stringify({ agent: agentId, ok: true }, null, 2));
      return 0;
    }
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp(agentId, io);
      return 0;
    }
    io.err(`Unknown command: ${command}`);
    printHelp(agentId, io);
    return 64;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function installCommand(agentId, argv, io) {
  const options = parseCommonOptions(argv, {
    boolean: new Set(['--with-serena', '--dry-run']),
    value: new Set(['--home']),
  });
  const plan = createInstallPlan(agentId, {
    withSerena: Boolean(options.flags['--with-serena']),
    dryRun: Boolean(options.flags['--dry-run']),
    home: options.values['--home'],
  });

  io.out(formatInstallPlan(plan));
  if (plan.dryRun) return 0;

  const changed = executeInstallPlan(plan);
  io.out(`Applied ${changed.length} operation(s).`);
  return 0;
}

function projectCommand(agentId, argv, io) {
  const [subcommand = 'help', ...rest] = argv;
  if (subcommand === 'setup') return projectSetupCommand(agentId, rest, io);
  if (subcommand === 'status') {
    const options = parseProjectOptions(rest);
    io.out(JSON.stringify(getProjectStatus(agentId, options.projectPath), null, 2));
    return 0;
  }
  if (subcommand === 'list') {
    io.out(JSON.stringify(listProjectFeatures(agentId), null, 2));
    return 0;
  }
  if (subcommand === 'init') {
    const options = parseProjectOptions(rest);
    const result = initProjectProfile(agentId, options.projectPath, { scope: options.scope });
    io.out(`Initialized ${result.scope} project profile: ${result.path}`);
    return 0;
  }
  if (subcommand === 'enable' || subcommand === 'disable') {
    const { positional, ...options } = parseProjectOptions(rest);
    const [type, name] = positional;
    if (!type || !name) {
      io.err(`Usage: ${agentId}-env project ${subcommand} <plugin|skill|hook|instruction> <name> [--local|--tracked] [--project <path>] [--dry-run]`);
      return 64;
    }
    const change = {
      type,
      name,
      enabled: subcommand === 'enable',
      scope: options.scope,
    };
    if (options.dryRun) {
      io.out(JSON.stringify({ agent: agentId, projectPath: options.projectPath, change }, null, 2));
      return 0;
    }
    const result = applyProjectFeatureChange(agentId, options.projectPath, change);
    io.out(`${subcommand === 'enable' ? 'Enabled' : 'Disabled'} ${result.change.type}.${name} in ${result.scope} profile: ${result.path}`);
    return 0;
  }
  printProjectHelp(agentId, io);
  return 0;
}

async function projectSetupCommand(agentId, argv, io) {
  const parsed = parseCommonOptions(argv, {
    boolean: new Set(['--dry-run']),
    value: new Set(['--project']),
  });
  const interactive = ensureInteractive(io);
  if (!interactive.ok) return 1;

  const prompts = resolvePromptAdapter(io);
  prompts.intro?.(`${agentId}-env project setup`);

  const projectPath = parsed.values['--project'] ?? await prompts.text({
    message: 'Project directory',
    defaultValue: process.cwd(),
  });
  if (isPromptCancel(prompts, projectPath)) return cancelSetup(prompts);

  const scope = await prompts.select({
    message: 'Where should project settings be stored?',
    options: [
      { value: 'local', label: 'Local only (.agent-env.local)' },
      { value: 'tracked', label: 'Tracked in repo (.agent-env)' },
    ],
    initialValue: 'local',
  });
  if (isPromptCancel(prompts, scope)) return cancelSetup(prompts);

  const featureOptions = flattenFeatureOptions(listProjectFeatures(agentId));
  const disable = await prompts.multiselect({
    message: 'Disable features for this project',
    options: featureOptions,
    initialValues: [],
  });
  if (isPromptCancel(prompts, disable)) return cancelSetup(prompts);

  const enable = await prompts.multiselect({
    message: 'Force-enable features for this project',
    options: featureOptions,
    initialValues: [],
  });
  if (isPromptCancel(prompts, enable)) return cancelSetup(prompts);

  const dryRun = parsed.flags['--dry-run'] || await prompts.confirm({
    message: 'Run as dry-run first?',
    initialValue: true,
  });
  if (isPromptCancel(prompts, dryRun)) return cancelSetup(prompts);

  const changes = [
    ...disable.map(feature => ({ feature, enabled: false })),
    ...enable.map(feature => ({ feature, enabled: true })),
  ];

  if (dryRun) {
    for (const change of changes) {
      io.out(`would ${change.enabled ? 'enable' : 'disable'} ${change.feature} in ${scope} profile for ${projectPath}`);
    }
    prompts.outro?.('Project setup dry-run complete.');
    return 0;
  }

  initProjectProfile(agentId, projectPath, { scope });
  for (const change of changes) {
    const [type, ...nameParts] = change.feature.split('.');
    const result = applyProjectFeatureChange(agentId, projectPath, {
      scope,
      type,
      name: nameParts.join('.'),
      enabled: change.enabled,
    });
    io.out(`${change.enabled ? 'Enabled' : 'Disabled'} ${result.change.type}.${result.change.name} in ${result.scope} profile: ${result.path}`);
  }
  prompts.outro?.('Project setup complete.');
  return 0;
}

function cleanCommand(agentId, argv, io) {
  const [target = 'help', ...rest] = argv;
  if (target === 'global') {
    const options = parseCommonOptions(rest, {
      boolean: new Set(['--dry-run']),
      value: new Set(['--home']),
    });
    const plan = createGlobalCleanupPlan(agentId, { home: options.values['--home'] });
    io.out(formatCleanupPlan(plan));
    const result = executeCleanupPlan(plan, { dryRun: Boolean(options.flags['--dry-run']) });
    if (!result.dryRun) io.out(`Removed ${result.removed.length} item(s). Skipped ${result.skipped.length} item(s).`);
    return 0;
  }

  if (target === 'project') {
    const options = parseCleanProjectOptions(rest);
    const plan = createProjectCleanupPlan(agentId, {
      projectPath: options.projectPath,
      scope: options.scope,
    });
    io.out(formatCleanupPlan(plan));
    const result = executeCleanupPlan(plan, { dryRun: options.dryRun });
    if (!result.dryRun) io.out(`Removed ${result.removed.length} item(s). Skipped ${result.skipped.length} item(s).`);
    return 0;
  }

  io.out(
    [
      `Usage: ${agentId}-env clean global [--dry-run] [--home <path>]`,
      `       ${agentId}-env clean project [--local|--tracked|--all] [--dry-run] [--project <path>]`,
    ].join('\n'),
  );
  return 0;
}

function parseProjectOptions(argv) {
  const parsed = parseCommonOptions(argv, {
    boolean: new Set(['--tracked', '--local', '--dry-run']),
    value: new Set(['--project']),
  });
  const scope = parsed.flags['--tracked'] ? 'tracked' : 'local';
  return {
    positional: parsed.positional,
    projectPath: parsed.values['--project'] ?? process.cwd(),
    scope,
    dryRun: Boolean(parsed.flags['--dry-run']),
  };
}

function parseCleanProjectOptions(argv) {
  const parsed = parseCommonOptions(argv, {
    boolean: new Set(['--local', '--tracked', '--all', '--dry-run']),
    value: new Set(['--project']),
  });
  const scope = parsed.flags['--all'] ? 'both' : parsed.flags['--tracked'] ? 'tracked' : 'local';
  return {
    projectPath: parsed.values['--project'] ?? process.cwd(),
    scope,
    dryRun: Boolean(parsed.flags['--dry-run']),
  };
}

function flattenFeatureOptions(features) {
  const options = [];
  for (const [type, values] of Object.entries(features)) {
    for (const name of Object.keys(values ?? {})) {
      const value = `${type}.${name}`;
      options.push({ value, label: value });
    }
  }
  return options;
}

function parseCommonOptions(argv, spec) {
  const flags = {};
  const values = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    if (spec.boolean.has(key)) {
      flags[key] = true;
    } else if (spec.value.has(key)) {
      values[key] = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (!values[key]) throw new Error(`Missing value for ${key}`);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { flags, values, positional };
}

function printHelp(agentId, io) {
  const bin = `${agentId}-env`;
  io.out(
    [
      `Usage: ${bin} <command>`,
      '',
      'Commands:',
      `  ${bin} install [--with-serena] [--dry-run] [--home <path>]`,
      `  ${bin} project status [--project <path>]`,
      `  ${bin} project setup [--project <path>] [--dry-run]`,
      `  ${bin} project init [--local|--tracked] [--project <path>]`,
      `  ${bin} project list`,
      `  ${bin} project enable <plugin|skill|hook|instruction> <name> [--local|--tracked]`,
      `  ${bin} project disable <plugin|skill|hook|instruction> <name> [--local|--tracked]`,
      `  ${bin} clean global [--dry-run] [--home <path>]`,
      `  ${bin} clean project [--local|--tracked|--all] [--dry-run] [--project <path>]`,
    ].join('\n'),
  );
}

function printProjectHelp(agentId, io) {
  io.out(`Run '${agentId}-env help' for project command usage.`);
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
