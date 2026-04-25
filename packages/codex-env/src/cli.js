import { runAgentCli } from '../../shared/src/index.js';

export function main(argv, io) {
  return runAgentCli('codex', argv, io);
}
