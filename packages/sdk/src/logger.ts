export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMessage = string;

export interface LogDetails {
  [key: string]: any;
}

export type LogHandler = (level: LogLevel, message: LogMessage, details?: LogDetails) => void;

export interface CreateLoggerOptions {
  levels?: LogLevel[];
  handler?: LogHandler;
}

export const loggerPrefix = "[Featurevisor]";

export const defaultLogLevels: LogLevel[] = [
  // supported, but not enabled by default
  // "debug",

  // enabled by default
  "info",
  "warn",
  "error",
];

export const defaultLogHandler: LogHandler = function defaultLogHandler(
  level,
  message,
  details = {},
) {
  let method = "log";

  if (level === "info") {
    method = "info";
  } else if (level === "warn") {
    method = "warn";
  } else if (level === "error") {
    method = "error";
  }

  console[method](loggerPrefix, message, details);
};

export class Logger {
  private levels: LogLevel[];
  private handle: LogHandler;

  constructor(options: CreateLoggerOptions) {
    this.levels = options.levels || defaultLogLevels;
    this.handle = options.handler || defaultLogHandler;
  }

  setLevels(levels: LogLevel[]) {
    this.levels = levels;
  }

  log(level: LogLevel, message: LogMessage, details?: LogDetails) {
    if (this.levels.indexOf(level) !== -1) {
      this.handle(level, message, details);
    }
  }

  debug(message: LogMessage, details?: LogDetails) {
    this.log("debug", message, details);
  }

  info(message: LogMessage, details?: LogDetails) {
    this.log("info", message, details);
  }

  warn(message: LogMessage, details?: LogDetails) {
    this.log("warn", message, details);
  }

  error(message: LogMessage, details?: LogDetails) {
    this.log("error", message, details);
  }
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return new Logger(options);
}
