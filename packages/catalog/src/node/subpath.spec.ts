import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { serveCatalog, type CatalogRuntime, type CatalogServerHandle } from ".";
import { rewriteCatalogHtml } from "./html";

describe("Catalog subpath server", () => {
  let root: string;
  let handle: CatalogServerHandle;
  let handler: (request: any, response: any) => Promise<void>;
  const base = "/internal/catalog/";
  const hash = "a".repeat(64);

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-mount-"));
    fs.mkdirSync(path.join(root, "data/blocks"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "data/manifest.json"), "{}");
    fs.writeFileSync(path.join(root, `data/blocks/${hash}.json`), "{}");
    fs.writeFileSync(path.join(root, "assets/main.js"), "export {};");
    fs.writeFileSync(path.join(root, "favicon.png"), "png");
    fs.writeFileSync(
      path.join(root, "index.html"),
      rewriteCatalogHtml(
        '<html><head><script src="./assets/main.js"></script></head><body></body></html>',
        base,
      ),
    );
    const server = Object.assign(new EventEmitter(), {
      listen: jest.fn((_port, _host, callback) => callback()),
      close: jest.fn((callback) => callback()),
    });
    jest.spyOn(http, "createServer").mockImplementation(((callback: typeof handler) => {
      handler = callback;
      return server;
    }) as any);
    handle = await serveCatalog(
      {} as CatalogRuntime,
      root,
      {
        catalogDirectoryPath: root,
        catalogBasePath: base,
      },
      {},
      { liveReload: true },
    );
  });

  afterEach(async () => {
    await handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function request(url: string, host = "127.0.0.1:3000") {
    return new Promise<{ status: number; headers: Record<string, string>; body: string }>(
      (resolve, reject) => {
        const result = { status: 0, headers: {} as Record<string, string>, body: "" };
        const response = {
          setHeader: (key: string, value: string) => {
            result.headers[key] = value;
          },
          writeHead: (status: number, headers: Record<string, string>) => {
            result.status = status;
            Object.assign(result.headers, headers);
          },
          end: (body: string | Buffer) => {
            result.body = body?.toString() || "";
            resolve(result);
          },
        };
        handler({ url, headers: { host } }, response).catch(reject);
      },
    );
  }

  it("redirects the bare mount while preserving queries and rejects neighbouring mounts", async () => {
    expect(await request("/internal/catalog?keep=1")).toMatchObject({
      status: 308,
      headers: { Location: `${base}?keep=1` },
    });
    for (const url of [
      "/",
      "/data/manifest.json",
      "/internal/catalogue/",
      "/internal/catalog-extra/",
    ]) {
      expect((await request(url)).status).toBe(404);
    }
  });

  it("serves the shell on deep routes, assets, favicon and immutable blocks within the mount", async () => {
    for (const route of ["", "index.html", "features/checkout%252Fcart/tests?assertion=1"]) {
      const response = await request(base + route);
      expect(response.status).toBe(200);
      expect(response.body).toContain(`src="${base}assets/main.js"`);
      expect(response.body).toContain('meta[name="featurevisor-catalog-base"]');
      expect(response.body).not.toContain("<base");
    }
    expect(await request(`${base}assets/main.js`)).toMatchObject({
      status: 200,
      body: "export {};",
    });
    expect(await request(`${base}favicon.ico`)).toMatchObject({ status: 200, body: "png" });
    expect(await request(`${base}data/manifest.json`, "attacker.example:3000")).toMatchObject({
      status: 421,
      headers: { "X-Content-Type-Options": "nosniff" },
    });
    expect((await request(`${base}data/manifest.json`)).headers["Cache-Control"]).toBe("no-cache");
    expect((await request(`${base}data/blocks/${hash}.json`)).headers["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    for (const route of [
      "assets/missing.js",
      "data/missing.json",
      "%2e%2e/secret",
      "%5c..%5csecret",
    ]) {
      expect((await request(base + route)).status).toBe(404);
    }
    expect((await request(`${base}%E0%A4%A`)).status).toBe(400);
    expect((await request(`${base}%00`)).status).toBe(400);
  });

  it("moves the mount and tells existing SSE clients the new prefix", async () => {
    const response = {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
    const client = Object.assign(new EventEmitter(), {
      url: `${base}__featurevisor_catalog_reload`,
      headers: { host: "localhost:3000" },
    });
    await handler(client, response);
    expect(response.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    handle.setBasePath("/new/");
    handle.triggerReload();
    expect(response.write).toHaveBeenCalledWith("data: /new/\n\n");
    expect((await request(`${base}data/manifest.json`)).status).toBe(404);
    expect((await request("/new/data/manifest.json")).status).toBe(200);
    client.emit("close");
    response.write.mockClear();
    handle.triggerReload();
    expect(response.write).not.toHaveBeenCalled();
  });

  it.each(["features/cart/tests", ""])(
    "uses meta content for live reload and preserves %s, query and fragment",
    async (route) => {
      const html = (await request(base + route)).body;
      const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
      let listener!: (event: { data: string }) => void;
      const location = {
        pathname: base + route,
        search: "?assertion=case",
        hash: "#/features/cart",
        assign: jest.fn(),
        reload: jest.fn(),
      };
      const source = {
        addEventListener: jest.fn((_name, callback) => {
          listener = callback;
        }),
        close: jest.fn(),
        onerror: () => {},
      };
      const EventSource = jest.fn(() => source);
      const querySelector = jest.fn(() => ({
        getAttribute: (key: string) => (key === "content" ? base : null),
      }));
      const setTimeout = jest.fn();
      runInNewContext(script, {
        document: { querySelector },
        window: { location },
        EventSource,
        setTimeout,
      });
      expect(querySelector).toHaveBeenCalledWith('meta[name="featurevisor-catalog-base"]');
      expect(EventSource).toHaveBeenCalledWith(`${base}__featurevisor_catalog_reload`);
      listener({ data: "/new/" });
      expect(location.assign).toHaveBeenCalledWith(`/new/${route}?assertion=case#/features/cart`);
      listener({ data: base });
      expect(location.reload).toHaveBeenCalledTimes(1);
      listener({ data: "//external.test/" });
      expect(location.assign).toHaveBeenCalledTimes(1);
      source.onerror();
      expect(source.close).toHaveBeenCalled();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);
    },
  );
});
