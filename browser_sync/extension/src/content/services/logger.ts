export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function safeSerialize(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return "[unserializable-meta]";
  }
}

interface LoggerFactoryOptions {
  minLevel?: LogLevel;
}

function createLoggerInternal(prefix: string, enabled: boolean, options: LoggerFactoryOptions): Logger {
  const minLevelWeight = LEVEL_WEIGHT[options.minLevel || "debug"];

  function write(level: LogLevel, message: string, meta?: unknown): void {
    if (!enabled) return;
    if (LEVEL_WEIGHT[level] < minLevelWeight) return;

    const ts = new Date().toISOString();
    const metaPart = meta === undefined ? "" : ` ${safeSerialize(meta)}`;
    const formatted = `[${ts}] [${prefix}] [${level.toUpperCase()}] ${message}${metaPart}`;

    try {
      if (level === "error") {
        console.error(formatted);
      } else {
        console.log(formatted);
      }
    } catch (_error) {
      // Silent by design: logging should not break sync flow.
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (scope) => createLoggerInternal(`${prefix}:${scope}`, enabled, options),
  };
}

export function createLogger(prefix: string, enabled: boolean, options: LoggerFactoryOptions = {}): Logger {
  return createLoggerInternal(prefix, enabled, options);
}
