export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMessage = string;

export interface LogDetails {
  [key: string]: any;
}

export type LogHandler = (level: LogLevel, message: LogMessage, details?: LogDetails) => void;

export interface CreateLoggerOptions {
  levels?: LogLevel[];
}

const defaultLevels: LogLevel[] = [
  // supported, but not enabled by default
  // "debug",
  // "info",

  // enabled by default
  "warn",
  "error",
];
const prefix = "[Featurevisor]";

export function createLogger(options: CreateLoggerOptions = {}): LogHandler {
  const levels = options.levels || defaultLevels;

  return function (level, message, details = {}) {
    if (levels.indexOf(level) === -1) {
      return;
    }

    switch (level) {
      case "debug":
        console.log(prefix, message, details);
      case "info":
        console.info(prefix, message, details);
      case "warn":
        console.warn(prefix, message, details);
      case "error":
        console.error(prefix, message, details);
    }
  };
}
