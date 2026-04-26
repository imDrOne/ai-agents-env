import { cac } from 'cac';

export async function runCacCommand(name, argv, configure, io = defaultIo()) {
  const cli = cac(name);
  let exitCode = 0;

  const run = handler => async (...args) => {
    const result = await handler(...args);
    exitCode = typeof result === 'number' ? result : 0;
  };

  configure(cli, run);

  cli.on('command:*', () => {
    io.err?.(`Unknown command: ${cli.args.join(' ')}`);
    exitCode = 64;
  });

  try {
    cli.help();
    cli.parse([process.argv[0] ?? 'node', name, ...argv], { run: false });
    await cli.runMatchedCommand();
    return exitCode;
  } catch (error) {
    io.err?.(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function defaultIo() {
  return {
    out: message => console.log(message),
    err: message => console.error(message),
  };
}
