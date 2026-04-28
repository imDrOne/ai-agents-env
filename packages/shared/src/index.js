export {
  AGENT_DEFINITIONS,
  createInstallPlan,
  executeInstallPlan,
  formatInstallPlan,
} from './install-plan.js';
export {
  applyProjectFeatureChange,
  getProjectStatus,
  initProjectProfile,
  listProjectFeatures,
  projectProfilePath,
  readProjectProfile,
} from './project-env.js';
export { runAgentCli } from './agent-cli.js';
export { runCacCommand } from './cli-router.js';
export {
  createGlobalCleanupPlan,
  createProjectCleanupPlan,
  executeCleanupPlan,
  formatCleanupPlan,
} from './cleanup.js';
export {
  AUDIO_EXT_RE,
  classifyNotification,
  getSoundFiles,
  getSoundsDir,
  notifyMain,
  playSound,
  playSoundFile,
  resolveSoundPool,
} from './notify.js';
export {
  AGENT_SOUND_EVENTS,
  addSoundsToLibrary,
  agentConfigPath,
  assignEventSounds,
  getAgentSoundsDir,
  isAudioFileName,
  listSoundSettings,
  readAgentConfig,
  updateAgentSoundDir,
  validateAgentEvent,
  writeAgentConfig,
} from './sounds.js';
export { configDir, homePath, lstatSafe, writeFileIfChanged, writeJsonFile } from './platform.js';
