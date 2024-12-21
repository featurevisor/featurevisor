import { createLogger } from "./logger";

describe("logger", () => {
  it("should log", () => {
    const logger = createLogger({
      levels: ["debug", "info", "warn", "error"],
      handler: jest.fn(),
    });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(logger).toBeDefined();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.setLevels).toBeDefined();
    expect(logger.log).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
    expect(logger.debug).toBeInstanceOf(Function);
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
    expect(logger.setLevels).toBeInstanceOf(Function);
  });

  it("should log with custom levels", () => {
    const logger = createLogger({
      levels: ["debug", "info"],
      handler: jest.fn(),
    });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(logger).toBeDefined();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.setLevels).toBeDefined();
    expect(logger.log).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
    expect(logger.debug).toBeInstanceOf(Function);
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
    expect(logger.setLevels).toBeInstanceOf(Function);
  });

  it("should log with default handler", () => {
    const logs: any[] = [];

    const realConsole = console;
    const customConsole = {
      log: (...args) => logs.push(args),
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    };

    console = customConsole as unknown as Console;

    const logger = createLogger({});

    logger.setLevels(["debug", "info", "warn", "error"]);

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(logger).toBeDefined();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.setLevels).toBeDefined();
    expect(logger.log).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
    expect(logger.debug).toBeInstanceOf(Function);
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
    expect(logger.setLevels).toBeInstanceOf(Function);

    expect(logs.length).toBe(4);

    console = realConsole; // eslint-ignore-line
  });

  it("should log with custom handler", () => {
    const handler = jest.fn();
    const logger = createLogger({
      levels: ["debug", "info", "warn", "error"],
      handler,
    });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(logger).toBeDefined();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.setLevels).toBeDefined();
    expect(logger.log).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
    expect(logger.debug).toBeInstanceOf(Function);
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
    expect(logger.setLevels).toBeInstanceOf(Function);
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it("should log with custom levels and handler", () => {
    const handler = jest.fn();
    const logger = createLogger({
      levels: ["debug", "info"],
      handler,
    });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(logger).toBeDefined();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.setLevels).toBeDefined();
    expect(logger.log).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
    expect(logger.debug).toBeInstanceOf(Function);
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
    expect(logger.setLevels).toBeInstanceOf(Function);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
