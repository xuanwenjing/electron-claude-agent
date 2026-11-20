import { formatWithOptions } from "node:util";

import type { ConsoleLog } from "../../shared/requestLogs";

type ConsoleLevel = ConsoleLog["level"];
const levels: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

const limit = 200;
let entries: ConsoleLog[] = [];
let nextId = 0;
let installed = false;

export function recordConsole(level: ConsoleLevel, args: unknown[]): void {
  let message = "";
  try {
    message = formatWithOptions({ depth: 4, colors: false, breakLength: 120 }, ...args);
  } catch {
    message = args.map((item) => String(item)).join(" ");
  }
  entries.push({ id: ++nextId, at: new Date().toISOString(), level, message });
  if (entries.length > limit) entries = entries.slice(-limit);
}

export function listConsoleLogs(): ConsoleLog[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearConsoleLogs(): void {
  entries = [];
}

/** 继续输出到原来的终端，同时留一份给日志面板。 */
export function installConsoleCapture(target: Pick<Console, ConsoleLevel> = console): void {
  if (target === console && installed) return;
  for (const level of levels) {
    const original = target[level].bind(target);
    target[level] = ((...args: unknown[]) => {
      original(...args);
      recordConsole(level, args);
    }) as Console[typeof level];
  }
  if (target === console) installed = true;
}
