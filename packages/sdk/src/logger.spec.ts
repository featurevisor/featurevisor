import { createLogger, Logger, LogLevel, defaultLogHandler } from "./logger";

describe("logger", () => {
  let consoleSpy: jest.SpyInstance; // eslint-disable-line

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "info").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("createLogger", () => {
    it("should create a logger with default options", () => {
      const logger = createLogger();
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should create a logger with custom level", () => {
      const logger = createLogger({ level: "debug" });
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should create a logger with custom handler", () => {
      const customHandler = jest.fn();
      const logger = createLogger({ handler: customHandler });

      logger.info("test message");
      expect(customHandler).toHaveBeenCalledWith("info", "test message", undefined);
    });
  });

  describe("Logger", () => {
    describe("constructor", () => {
      it("should use default log level when none provided", () => {
        const logger = new Logger({});
        logger.debug("debug message");

        // Debug should not be logged with default level (info)
        expect(console.log).not.toHaveBeenCalled();
      });

      it("should use provided log level", () => {
        const logger = new Logger({ level: "debug" });
        logger.debug("debug message");

        // Debug should be logged with debug level
        expect(console.log).toHaveBeenCalledWith("[Featurevisor]", "debug message", {});
      });

      it("should use default handler when none provided", () => {
        const logger = new Logger({});
        logger.info("test message");

        expect(console.info).toHaveBeenCalledWith("[Featurevisor]", "test message", {});
      });

      it("should use provided handler", () => {
        const customHandler = jest.fn();
        const logger = new Logger({ handler: customHandler });

        logger.info("test message");
        expect(customHandler).toHaveBeenCalledWith("info", "test message", undefined);
      });
    });

    describe("setLevel", () => {
      it("should update the log level", () => {
        const logger = new Logger({ level: "info" });

        // Debug should not be logged initially
        logger.debug("debug message");
        expect(console.log).not.toHaveBeenCalled();

        // Set to debug level
        logger.setLevel("debug");
        logger.debug("debug message");
        expect(console.log).toHaveBeenCalledWith("[Featurevisor]", "debug message", {});
      });
    });

    describe("log level filtering", () => {
      it("should log error messages at all levels", () => {
        const levels: LogLevel[] = ["debug", "info", "warn", "error"];

        levels.forEach((level) => {
          const logger = new Logger({ level });
          logger.error("error message");
          expect(console.error).toHaveBeenCalledWith("[Featurevisor]", "error message", {});
          jest.clearAllMocks();
        });
      });

      it("should log warn messages at warn level and above", () => {
        const logger = new Logger({ level: "warn" });

        logger.warn("warn message");
        expect(console.warn).toHaveBeenCalledWith("[Featurevisor]", "warn message", {});

        logger.error("error message");
        expect(console.error).toHaveBeenCalledWith("[Featurevisor]", "error message", {});
      });

      it("should not log info messages at warn level", () => {
        const logger = new Logger({ level: "warn" });

        logger.info("info message");
        expect(console.info).not.toHaveBeenCalled();
      });

      it("should not log debug messages at info level", () => {
        const logger = new Logger({ level: "info" });

        logger.debug("debug message");
        expect(console.log).not.toHaveBeenCalled();
      });

      it("should log all messages at debug level", () => {
        const logger = new Logger({ level: "debug" });

        logger.debug("debug message");
        expect(console.log).toHaveBeenCalledWith("[Featurevisor]", "debug message", {});

        logger.info("info message");
        expect(console.info).toHaveBeenCalledWith("[Featurevisor]", "info message", {});

        logger.warn("warn message");
        expect(console.warn).toHaveBeenCalledWith("[Featurevisor]", "warn message", {});

        logger.error("error message");
        expect(console.error).toHaveBeenCalledWith("[Featurevisor]", "error message", {});
      });
    });

    describe("convenience methods", () => {
      let logger: Logger;

      beforeEach(() => {
        logger = new Logger({ level: "debug" });
      });

      it("should call debug method correctly", () => {
        logger.debug("debug message");
        expect(console.log).toHaveBeenCalledWith("[Featurevisor]", "debug message", {});
      });

      it("should call info method correctly", () => {
        logger.info("info message");
        expect(console.info).toHaveBeenCalledWith("[Featurevisor]", "info message", {});
      });

      it("should call warn method correctly", () => {
        logger.warn("warn message");
        expect(console.warn).toHaveBeenCalledWith("[Featurevisor]", "warn message", {});
      });

      it("should call error method correctly", () => {
        logger.error("error message");
        expect(console.error).toHaveBeenCalledWith("[Featurevisor]", "error message", {});
      });

      it("should handle details parameter", () => {
        const details = { key: "value", number: 42 };

        logger.info("message with details", details);
        expect(console.info).toHaveBeenCalledWith(
          "[Featurevisor]",
          "message with details",
          details,
        );
      });
    });

    describe("log method", () => {
      it("should call handler with correct parameters", () => {
        const customHandler = jest.fn();
        const logger = new Logger({ handler: customHandler, level: "debug" });
        const details = { test: true };

        logger.log("info", "test message", details);
        expect(customHandler).toHaveBeenCalledWith("info", "test message", details);
      });

      it("should not call handler when level is filtered out", () => {
        const customHandler = jest.fn();
        const logger = new Logger({ handler: customHandler, level: "warn" });

        logger.log("debug", "debug message");
        expect(customHandler).not.toHaveBeenCalled();
      });
    });
  });

  describe("defaultLogHandler", () => {
    it("should use console.log for debug level", () => {
      defaultLogHandler("debug", "debug message");
      expect(console.log).toHaveBeenCalledWith("[Featurevisor]", "debug message", {});
    });

    it("should use console.info for info level", () => {
      defaultLogHandler("info", "info message");
      expect(console.info).toHaveBeenCalledWith("[Featurevisor]", "info message", {});
    });

    it("should use console.warn for warn level", () => {
      defaultLogHandler("warn", "warn message");
      expect(console.warn).toHaveBeenCalledWith("[Featurevisor]", "warn message", {});
    });

    it("should use console.error for error level", () => {
      defaultLogHandler("error", "error message");
      expect(console.error).toHaveBeenCalledWith("[Featurevisor]", "error message", {});
    });

    it("should handle undefined details", () => {
      defaultLogHandler("info", "message without details");
      expect(console.info).toHaveBeenCalledWith("[Featurevisor]", "message without details", {});
    });

    it("should handle provided details", () => {
      const details = { key: "value" };
      defaultLogHandler("info", "message with details", details);
      expect(console.info).toHaveBeenCalledWith("[Featurevisor]", "message with details", details);
    });
  });
});
