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
  // "info",

  // enabled by default
  "warn",
  "error",
];

export const defaultLogHandler: LogHandler = function defaultLogHandler(
  level,
  message,
  details = {},
) {
  switch (level) {
    case "debug":
      console.log(loggerPrefix, message, details);
    case "info":
      console.info(loggerPrefix, message, details);
    case "warn":
      console.warn(loggerPrefix, message, details);
    case "error":
      console.error(loggerPrefix, message, details);
  }
};

export class Logger {
  private levels: LogLevel[];
  private handle: LogHandler;

  constructor(options: CreateLoggerOptions) {
    this.levels = options.levels as LogLevel[];
    this.handle = options.handler as LogHandler;
  }

  setLevels(levels: LogLevel[]) {
    this.levels = levels;
  }

  log(level: LogLevel, message: LogMessage, details?: LogDetails) {
    if (this.levels.includes(level)) {
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
  const levels = options.levels || defaultLogLevels;
  const logHandler = options.handler || defaultLogHandler;

  return new Logger({ levels, handler: logHandler });
}
