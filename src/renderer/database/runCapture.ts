/**
 * Run a command through the streaming Task service and capture its full output
 * (Phase 8C/8D). Resolves on the task's EXIT event — not `task.run`'s promise —
 * so every `onOutput` event (delivered before exit in IPC send order) is
 * captured. Used for one-shot CLI captures (query run, `zornux db …`).
 */
let counter = 0;

export interface CapturedRun {
  code: number | null;
  output: string;
}

export async function captureTask(command: string, cwd: string): Promise<CapturedRun> {
  counter += 1;
  const id = `capture-${counter}-${Date.now()}`;
  let output = '';
  let code: number | null = null;
  let offOutput = (): void => {};
  let offExit = (): void => {};

  const exited = new Promise<void>((resolve) => {
    offOutput = window.znxstudio.task.onOutput((event) => {
      if (event.id === id) output += event.data;
    });
    offExit = window.znxstudio.task.onExit((event) => {
      if (event.id === id) {
        code = event.code;
        resolve();
      }
    });
  });

  try {
    await window.znxstudio.task.run({ id, command, cwd });
    await exited;
  } finally {
    offOutput();
    offExit();
  }

  return { code, output };
}
