import * as clack from '@clack/prompts';

export function createClackPromptAdapter() {
  return {
    intro: clack.intro,
    outro: clack.outro,
    cancel: clack.cancel,
    isCancel: clack.isCancel,
    text: clack.text,
    confirm: clack.confirm,
    select: clack.select,
    multiselect: clack.multiselect,
  };
}

export function resolvePromptAdapter(io = {}) {
  return io.prompts ?? createClackPromptAdapter();
}

export function ensureInteractive(io = {}) {
  if (io.prompts) return { ok: true };
  const isTTY = io.isTTY ?? process.stdin.isTTY;
  if (!isTTY) {
    io.err?.('Interactive setup requires an interactive terminal. Use non-interactive install/project flags instead.');
    return { ok: false };
  }
  return { ok: true };
}

export function isPromptCancel(prompts, value) {
  return prompts.isCancel?.(value) || value === Symbol.for('cancel');
}

export function cancelSetup(prompts, message = 'Setup cancelled.') {
  prompts.cancel?.(message);
  return 130;
}
