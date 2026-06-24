import util from "node:util";
import { clearActiveProgressLine } from "./terminal/progress-line.js";
import { createSafeStreamWriter } from "./terminal/stream-writer.js";

export type RuntimeEnv = {
  log: typeof console.log;
  error: typeof console.error;
  exit: (code: number) => never;
};

function isBrokenPipeError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EPIPE" || code === "EIO";
}

let streamErrorHandlersInstalled = false;

function installBrokenPipeHandlers() {
  if (streamErrorHandlersInstalled) {
    return;
  }
  streamErrorHandlersInstalled = true;
  const handleStreamError = (err: unknown) => {
    if (isBrokenPipeError(err)) {
      return;
    }
    throw err;
  };
  process.stdout.on("error", handleStreamError);
  process.stderr.on("error", handleStreamError);
}

const stdoutWriter = createSafeStreamWriter();
const stderrWriter = createSafeStreamWriter();

function formatArgs(args: Parameters<typeof console.log>) {
  return util.format(...args);
}

export const defaultRuntime: RuntimeEnv = {
  log: (...args: Parameters<typeof console.log>) => {
    installBrokenPipeHandlers();
    clearActiveProgressLine();
    stdoutWriter.writeLine(process.stdout, formatArgs(args));
  },
  error: (...args: Parameters<typeof console.error>) => {
    installBrokenPipeHandlers();
    clearActiveProgressLine();
    stderrWriter.writeLine(process.stderr, formatArgs(args));
  },
  exit: (code) => {
    process.exit(code);
    throw new Error("unreachable"); // satisfies tests when mocked
  },
};
