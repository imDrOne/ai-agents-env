import { createInstallPlan, executeInstallPlan, formatInstallPlan } from './install-plan.js';
import { configureSerenaForAgent } from './serena.js';
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
import {
  addSoundsToLibrary,
  assignEventSounds,
  listSoundSettings,
  updateAgentSoundDir,
} from './sounds.js';

export async function runAgentCli(agentId, argv, io = defaultIo(), options = {}) {
  const [command = 'help', ...rest] = argv;

  try {
    if (command === 'install') return installCommand(agentId, rest, io);
    if (command === 'project') return projectCommand(agentId, rest, io);
    if (command === 'clean') return cleanCommand(agentId, rest, io);
    if (command === 'sound') return soundCommand(agentId, rest, io);
    if (command === 'sound-add') return soundCommand(agentId, ['add', ...rest], io);
    if (command === 'status') {
      if (isHelpArgs(rest)) {
        printStatusHelp(agentId, io);
        return 0;
      }
      io.out(JSON.stringify({ agent: agentId, ok: true }, null, 2));
      return 0;
    }
    if (command === 'help' || command === '--help' || command === '-h') {
      printAgentHelp(agentId, io, options);
      return 0;
    }
    io.err(`Unknown command: ${command}`);
    printAgentHelp(agentId, io, options);
    return 64;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function soundCommand(agentId, argv, io) {
  const [subcommand = 'help', ...rest] = argv;
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printSoundHelp(agentId, io);
    return 0;
  }
  if (subcommand === 'add') return soundAddCommand(agentId, rest, io);
  if (subcommand === 'assign') return soundAssignCommand(agentId, rest, io);
  if (subcommand === 'list') return soundListCommand(agentId, rest, io);
  printSoundHelp(agentId, io);
  return 0;
}

async function soundAddCommand(agentId, argv, io) {
  const options = parseSoundOptions(argv, {
    boolean: new Set(['--assign']),
    value: new Set(['--home', '--sound-dir']),
  });
  if (options.positional.length === 0) {
    io.err(
      `Usage: ${agentId}-env sound add <file-or-directory...> [--assign] [--sound-dir <path>] [--home <path>]`,
    );
    return 64;
  }

  const result = addSoundsToLibrary(options.positional, {
    soundDir: options.values['--sound-dir'],
    env: io.env,
  });
  updateAgentSoundDir(agentId, result.soundsDir, {
    home: options.values['--home'],
    env: io.env,
  });

  for (const file of result.added) io.out(`Added ${file.name} -> ${file.path}`);
  for (const skip of result.skipped) io.out(`Skipped ${skip.source}: ${skip.reason}`);
  if (result.added.length === 0) return 0;

  const addedNames = result.added.map(file => file.name);
  if (options.flags['--assign']) {
    return soundAssignInteractive(agentId, io, {
      home: options.values['--home'],
      soundDir: result.soundsDir,
      initialSoundNames: addedNames,
    });
  }

  if (!isInteractive(io)) return 0;
  const prompts = resolvePromptAdapter(io);
  const shouldAssign = await prompts.confirm({
    message: 'Assign added sound(s) to an event now?',
    initialValue: true,
  });
  if (isPromptCancel(prompts, shouldAssign)) {
    return cancelSetup(prompts, 'Sound assignment cancelled.');
  }
  if (!shouldAssign) return 0;

  return soundAssignInteractive(agentId, io, {
    home: options.values['--home'],
    soundDir: result.soundsDir,
    initialSoundNames: addedNames,
  });
}

async function soundAssignCommand(agentId, argv, io) {
  const options = parseSoundOptions(argv, {
    boolean: new Set([]),
    value: new Set(['--home', '--sound-dir']),
  });
  const [event, ...soundNames] = options.positional;
  if (!event || soundNames.length === 0) {
    return soundAssignInteractive(agentId, io, {
      home: options.values['--home'],
      soundDir: options.values['--sound-dir'],
      event,
      initialSoundNames: soundNames,
    });
  }

  const result = assignEventSounds(agentId, event, soundNames, {
    home: options.values['--home'],
    soundDir: options.values['--sound-dir'],
    env: io.env,
  });
  io.out(`Assigned ${result.event}: ${result.soundNames.join(', ')}`);
  return 0;
}

function soundListCommand(agentId, argv, io) {
  const options = parseSoundOptions(argv, {
    boolean: new Set([]),
    value: new Set(['--home', '--sound-dir']),
  });
  const settings = listSoundSettings(agentId, {
    home: options.values['--home'],
    soundDir: options.values['--sound-dir'],
    env: io.env,
  });
  io.out(formatSoundSettings(settings));
  return 0;
}

async function soundAssignInteractive(agentId, io, options = {}) {
  const interactive = ensureInteractive(io);
  if (!interactive.ok) return 1;

  const prompts = resolvePromptAdapter(io);
  const settings = listSoundSettings(agentId, {
    home: options.home,
    soundDir: options.soundDir,
    env: io.env,
  });
  if (settings.sounds.length === 0) {
    io.err(
      `No sounds found in ${settings.soundsDir}. Add one with '${agentId}-env sound add <path>'.`,
    );
    return 1;
  }

  let { event } = options;
  if (!event) {
    event = await prompts.select({
      message: 'Event',
      options: settings.events.map(value => ({ value, label: value })),
      initialValue: settings.events[0],
    });
  }
  if (isPromptCancel(prompts, event)) return cancelSetup(prompts, 'Sound assignment cancelled.');

  const current = settings.eventSounds[event] ?? [];
  const initialValues = options.initialSoundNames?.length ? options.initialSoundNames : current;
  const soundNames = await prompts.multiselect({
    message: 'Sound pool',
    options: settings.sounds.map(file => ({ value: file.name, label: file.name })),
    initialValues,
  });
  if (isPromptCancel(prompts, soundNames)) {
    return cancelSetup(prompts, 'Sound assignment cancelled.');
  }
  if (!Array.isArray(soundNames) || soundNames.length === 0) {
    io.err('Select at least one sound.');
    return 1;
  }

  const result = assignEventSounds(agentId, event, soundNames, {
    home: options.home,
    soundDir: settings.soundsDir,
    env: io.env,
  });
  io.out(`Assigned ${result.event}: ${result.soundNames.join(', ')}`);
  return 0;
}

function installCommand(agentId, argv, io) {
  if (isHelpArgs(argv)) {
    printInstallHelp(agentId, io);
    return 0;
  }
  const options = parseCommonOptions(argv, {
    boolean: new Set(['--with-serena', '--dry-run', '--no-statusline', '--statusline-force']),
    value: new Set(['--home']),
  });
  const plan = createInstallPlan(agentId, {
    withSerena: Boolean(options.flags['--with-serena']),
    dryRun: Boolean(options.flags['--dry-run']),
    home: options.values['--home'],
    withStatusline: agentId === 'claude' ? !options.flags['--no-statusline'] : undefined,
    statuslineForce: Boolean(options.flags['--statusline-force']),
  });

  io.out(formatInstallPlan(plan));
  let changed = [];
  if (!plan.dryRun) {
    changed = executeInstallPlan(plan);
    io.out(`Applied ${changed.length} operation(s).`);
  }

  if (plan.withSerena) {
    const serena = configureSerenaForAgent(agentId, {
      home: plan.home,
      dryRun: plan.dryRun,
      io,
      env: io?.env,
      spawnSyncImpl: io?.spawnSyncImpl,
      existsSyncImpl: io?.existsSyncImpl,
      serenaCommand: io?.serenaCommand,
    });
    if (!serena.ok) return 1;
  }
  return 0;
}

function projectCommand(agentId, argv, io) {
  const [subcommand = 'help', ...rest] = argv;
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printProjectHelp(agentId, io);
    return 0;
  }
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
      io.err(
        `Usage: ${agentId}-env project ${subcommand} <plugin|skill|hook|instruction> <name> [--local|--tracked] [--project <path>] [--dry-run]`,
      );
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
    io.out(
      `${subcommand === 'enable' ? 'Enabled' : 'Disabled'} ${result.change.type}.${name} in ${result.scope} profile: ${result.path}`,
    );
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

  const projectPath =
    parsed.values['--project'] ??
    (await prompts.text({
      message: 'Project directory',
      defaultValue: process.cwd(),
    }));
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

  const dryRun =
    parsed.flags['--dry-run'] ||
    (await prompts.confirm({
      message: 'Run as dry-run first?',
      initialValue: true,
    }));
  if (isPromptCancel(prompts, dryRun)) return cancelSetup(prompts);

  const changes = [
    ...disable.map(feature => ({ feature, enabled: false })),
    ...enable.map(feature => ({ feature, enabled: true })),
  ];

  if (dryRun) {
    for (const change of changes) {
      io.out(
        `would ${change.enabled ? 'enable' : 'disable'} ${change.feature} in ${scope} profile for ${projectPath}`,
      );
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
    io.out(
      `${change.enabled ? 'Enabled' : 'Disabled'} ${result.change.type}.${result.change.name} in ${result.scope} profile: ${result.path}`,
    );
  }
  prompts.outro?.('Project setup complete.');
  return 0;
}

function cleanCommand(agentId, argv, io) {
  const [target = 'help', ...rest] = argv;
  if (target === 'help' || target === '--help' || target === '-h') {
    printCleanHelp(agentId, io);
    return 0;
  }
  if (target === 'global') {
    const options = parseCommonOptions(rest, {
      boolean: new Set(['--dry-run', '--wipe', '--confirm-wipe']),
      value: new Set(['--home']),
    });
    const dryRun = Boolean(options.flags['--dry-run']);
    const wipe = Boolean(options.flags['--wipe']);
    if (wipe && !dryRun && !options.flags['--confirm-wipe']) {
      io.err(
        `Destructive global wipe requires --confirm-wipe. Run '${agentId}-env clean global --wipe --dry-run' first.`,
      );
      return 1;
    }
    const plan = createGlobalCleanupPlan(agentId, {
      home: options.values['--home'],
      wipe,
      env: io?.env,
    });
    io.out(formatCleanupPlan(plan));
    const unsafe = plan.operations.find(
      op => op.kind === 'skip' && String(op.reason ?? '').startsWith('unsafe-'),
    );
    if (unsafe) {
      io.err(`Refusing to wipe unsafe home: ${unsafe.path} (${unsafe.reason})`);
      return 1;
    }
    const result = executeCleanupPlan(plan, { dryRun });
    if (!result.dryRun) {
      io.out(`Removed ${result.removed.length} item(s). Skipped ${result.skipped.length} item(s).`);
    }
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
    if (!result.dryRun) {
      io.out(`Removed ${result.removed.length} item(s). Skipped ${result.skipped.length} item(s).`);
    }
    return 0;
  }

  printCleanHelp(agentId, io);
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

function parseSoundOptions(argv, spec) {
  return parseCommonOptions(argv, spec);
}

function formatSoundSettings(settings) {
  const lines = [
    `Agent: ${settings.agent}`,
    `Config: ${settings.configPath}`,
    `Sound directory: ${settings.soundsDir}`,
    '',
    'Available sounds:',
  ];
  if (settings.sounds.length === 0) {
    lines.push('  (none)');
  } else {
    for (const file of settings.sounds) lines.push(`  ${file.name}`);
  }

  lines.push('', 'Assignments:');
  const assigned = Object.entries(settings.eventSounds);
  if (assigned.length === 0) {
    lines.push('  (none)');
  } else {
    for (const [event, sounds] of assigned) {
      lines.push(
        `  ${event}: ${Array.isArray(sounds) && sounds.length > 0 ? sounds.join(', ') : '(none)'}`,
      );
    }
  }
  return lines.join('\n');
}

function isInteractive(io) {
  return Boolean(io.prompts) || Boolean(io.isTTY ?? process.stdin.isTTY);
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

export function formatAgentHelp(agentId, options = {}) {
  const bin = `${agentId}-env`;
  const extraCommands = options.extraCommands ?? [];
  return [
    `Usage: ${bin} <command>`,
    '',
    'Commands:',
    ...extraCommands.map(command => `  ${bin} ${command}`),
    `  ${bin} install [--with-serena] [--dry-run] [--home <path>]${
      agentId === 'claude' ? ' [--skip-plugins] [--no-statusline] [--statusline-force]' : ''
    }`,
    `  ${bin} status`,
    `  ${bin} project status [--project <path>]`,
    `  ${bin} project setup [--project <path>] [--dry-run]`,
    `  ${bin} project init [--local|--tracked] [--project <path>]`,
    `  ${bin} project list`,
    `  ${bin} project enable <plugin|skill|hook|instruction> <name> [--local|--tracked]`,
    `  ${bin} project disable <plugin|skill|hook|instruction> <name> [--local|--tracked]`,
    `  ${bin} sound add <file-or-directory...> [--assign] [--sound-dir <path>]`,
    `  ${bin} sound assign [event] [sound...]`,
    `  ${bin} sound list`,
    `  ${bin} sound-add <file-or-directory...>`,
    `  ${bin} clean global [--dry-run] [--home <path>]`,
    `  ${bin} clean global --wipe [--dry-run|--confirm-wipe] [--home <path>]`,
    `  ${bin} clean project [--local|--tracked|--all] [--dry-run] [--project <path>]`,
    '',
    `Run '${bin} <command> --help' for command-specific usage.`,
  ].join('\n');
}

function printAgentHelp(agentId, io, options = {}) {
  io.out(formatAgentHelp(agentId, options));
}

export function formatInstallHelp(agentId) {
  const bin = `${agentId}-env`;
  const claudeOptions =
    agentId === 'claude'
      ? ' [--skip-plugins] [--no-statusline] [--statusline-force] [--plugins-file <path>] [--marketplaces-file <path>]'
      : '';
  return [
    `Usage: ${bin} install [options]`,
    '',
    'Options:',
    `  ${bin} install [--with-serena] [--dry-run] [--home <path>]${claudeOptions}`,
  ].join('\n');
}

export function formatProjectHelp(agentId) {
  const bin = `${agentId}-env`;
  return [
    `Usage: ${bin} project <command>`,
    '',
    'Commands:',
    `  ${bin} project status [--project <path>]`,
    `  ${bin} project setup [--project <path>] [--dry-run]`,
    `  ${bin} project init [--local|--tracked] [--project <path>]`,
    `  ${bin} project list`,
    `  ${bin} project enable <plugin|skill|hook|instruction> <name> [--local|--tracked] [--project <path>] [--dry-run]`,
    `  ${bin} project disable <plugin|skill|hook|instruction> <name> [--local|--tracked] [--project <path>] [--dry-run]`,
  ].join('\n');
}

function printProjectHelp(agentId, io) {
  io.out(formatProjectHelp(agentId));
}

function printInstallHelp(agentId, io) {
  io.out(formatInstallHelp(agentId));
}

export function formatSoundHelp(agentId) {
  const bin = `${agentId}-env`;
  return [
    `Usage: ${bin} sound <command>`,
    '',
    'Commands:',
    `  ${bin} sound add <file-or-directory...> [--assign] [--sound-dir <path>] [--home <path>]`,
    `  ${bin} sound assign [event] [sound...] [--sound-dir <path>] [--home <path>]`,
    `  ${bin} sound list [--sound-dir <path>] [--home <path>]`,
    `  ${bin} sound-add <file-or-directory...>`,
  ].join('\n');
}

function printSoundHelp(agentId, io) {
  io.out(formatSoundHelp(agentId));
}

export function formatCleanHelp(agentId) {
  const bin = `${agentId}-env`;
  return [
    `Usage: ${bin} clean <target>`,
    '',
    'Commands:',
    `  ${bin} clean global [--dry-run] [--home <path>]`,
    `  ${bin} clean global --wipe [--dry-run|--confirm-wipe] [--home <path>]`,
    `  ${bin} clean project [--local|--tracked|--all] [--dry-run] [--project <path>]`,
  ].join('\n');
}

function printCleanHelp(agentId, io) {
  io.out(formatCleanHelp(agentId));
}

export function formatStatusHelp(agentId) {
  const bin = `${agentId}-env`;
  return [`Usage: ${bin} status`, '', 'Show a minimal JSON health check for this agent CLI.'].join(
    '\n',
  );
}

function printStatusHelp(agentId, io) {
  io.out(formatStatusHelp(agentId));
}

function isHelpArgs(argv) {
  const [arg] = argv;
  return arg === 'help' || arg === '--help' || arg === '-h';
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
