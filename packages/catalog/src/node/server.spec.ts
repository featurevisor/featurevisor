import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import { EventEmitter } from "events";

import { createCatalogApi, serveCatalog, startCatalogDevMode, type CatalogRuntime } from ".";
import { watchCatalogInputs } from "./watch";

jest.mock("http", () => ({ ...jest.requireActual("http"), createServer: jest.fn() }));
jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  execFileSync: jest.fn(() => ""),
}));
jest.mock("./watch", () => ({
  ...jest.requireActual("./watch"),
  watchCatalogInputs: jest.fn(),
}));

describe("Catalog server startup", () => {
  let root: string;
  let previousExitCode: typeof process.exitCode;
  let server: EventEmitter & {
    listen: jest.Mock;
    close: jest.Mock;
    closeAllConnections: jest.Mock;
  };
  let errorLog: jest.SpyInstance;
  const runtime: CatalogRuntime = {
    getProjectSetExecutions: jest.fn(async () => []),
    getCatalogTargetMemberships: jest.fn(async () => ({})),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    previousExitCode = process.exitCode;
    errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    root = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-server-startup-"));
    fs.mkdirSync(path.join(root, "data"));
    fs.writeFileSync(path.join(root, "data", "manifest.json"), "{}");
    server = Object.assign(new EventEmitter(), {
      listen: jest.fn((_port, _host, callback) => {
        if (callback) server.once("listening", callback);
        return server;
      }),
      close: jest.fn((callback) => callback()),
      closeAllConnections: jest.fn(),
    });
    jest.mocked(http.createServer).mockReturnValue(server as unknown as http.Server);
    jest.mocked(watchCatalogInputs).mockReset().mockReturnValue(jest.fn());
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    server.removeAllListeners();
    jest.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function startServer() {
    return serveCatalog(runtime, root, { catalogDirectoryPath: root }, {}, { port: "0" });
  }

  function failSynchronously(error: Error) {
    server.listen.mockImplementation((_port, _host, callback) => {
      // Model a listener installed before listen() encounters a synchronous failure.
      if (callback) server.once("listening", callback);
      throw error;
    });
  }

  it("does not resolve ready until listening succeeds and removes the startup error listener", async () => {
    let ready = false;
    const pending = startServer().then((handle) => {
      ready = true;
      return handle;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(server.listen.mock.calls[0].slice(0, 2)).toEqual([0, "127.0.0.1"]);
    server.emit("listening");
    const handle = await pending;
    expect(ready).toBe(true);
    expect(server.listenerCount("listening")).toBe(0);
    expect(server.listenerCount("error")).toBe(1);
    expect(process.exitCode).toBe(previousExitCode);
    await handle.close();
    await handle.close();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });

  it("releases open browser connections rather than waiting indefinitely on close", async () => {
    let finish: (() => void) | undefined;
    server.close.mockImplementation((callback) => {
      finish = callback;
    });
    server.closeAllConnections.mockImplementation(() => finish?.());
    const pending = startServer();
    server.emit("listening");
    const handle = await pending;
    await handle.close();
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(
      server.closeAllConnections.mock.invocationCallOrder[0],
    );
  });

  it("rejects an emitted bind error instead of returning a ready server", async () => {
    const error = Object.assign(new Error("bind denied"), { code: "EPERM" });
    const pending = startServer();
    const rejected = expect(pending).rejects.toBe(error);
    server.emit("error", error);
    await rejected;
    expect(errorLog).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["event", "throw"])(
    "removes startup listeners after a listen %s failure",
    async (mode) => {
      const error = Object.assign(new Error("listen failed"), { code: "EADDRINUSE" });
      if (mode === "throw") failSynchronously(error);
      const pending = startServer();
      const rejected = expect(pending).rejects.toBe(error);
      if (mode === "event") server.emit("error", error);
      await rejected;
      // Keep only the permanent error logger, never a pending readiness callback.
      expect(server.listenerCount("error")).toBe(1);
      expect(server.listenerCount("listening")).toBe(0);
    },
  );

  it.each(["event", "throw"])(
    "does not install dev watchers or exit hooks after a listen %s failure",
    async (mode) => {
      const error = Object.assign(new Error("bind denied"), { code: "EPERM" });
      if (mode === "throw") failSynchronously(error);
      const exitListeners = process.listeners("exit");
      const api = createCatalogApi(runtime);
      const exportCatalog = jest.fn(async () => ({
        outputDirectoryPath: root,
        manifest: {} as any,
      }));
      const pending = startCatalogDevMode(
        runtime,
        { ...api, exportCatalog },
        root,
        { catalogDirectoryPath: root },
        {},
        { _: [], outDir: root, port: "0" },
      );
      const rejected = expect(pending).rejects.toBe(error);
      await Promise.resolve();
      expect(server.listen).toHaveBeenCalledTimes(1);
      if (mode === "event") server.emit("error", error);
      await rejected;
      await jest.advanceTimersByTimeAsync(5000);
      expect(exportCatalog).toHaveBeenCalledTimes(1);
      expect(watchCatalogInputs).not.toHaveBeenCalled();
      expect(process.listeners("exit")).toEqual(exitListeners);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
