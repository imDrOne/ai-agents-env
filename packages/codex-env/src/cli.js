import { notifyMain, runAgentCli } from '../../shared/src/index.js';
import { skillsCommand } from './skills.js';

export async function main(argv, io) {
  if (argv[0] === 'skills') {
    return skillsCommand(argv.slice(1), io);
  }
  if (argv[0] === 'notify') {
    return notifyMain(argv.slice(1), io?.notifyDeps);
  }
  return runAgentCli('codex', argv, io);
}
