export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMessage = string;

export interface LogDetails {
  [key: string]: any;
}

export type LogHandler = (level: LogLevel, message: LogMessage, details?: LogDetails) => void;

export interface CreateLoggerOptions {
  level?: LogLevel;
  handler?: LogHandler;
}

export const loggerPrefix = "[Featurevisor]";

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
  static allLevels: LogLevel[] = [
    // enabled by default
    "error",
    "warn",
    "info",

    // not enabled by default
    "debug",
  ];

  static defaultLevel: LogLevel = "info";

  private level: LogLevel;
  private handle: LogHandler;

  constructor(options: CreateLoggerOptions) {
    this.level = options.level || Logger.defaultLevel;
    this.handle = options.handler || defaultLogHandler;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  log(level: LogLevel, message: LogMessage, details?: LogDetails) {
    const shouldHandle = Logger.allLevels.indexOf(this.level) >= Logger.allLevels.indexOf(level);

    if (!shouldHandle) {
      return;
    }

    this.handle(level, message, details);
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
