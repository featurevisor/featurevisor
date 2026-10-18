import { build } from "vite";
import { minify } from "terser";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import process from "node:process";
import assert from "node:assert/strict";

async function main() {
  const built = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2015",
      minify: false,
      lib: { entry: "packages/sdk/src/index.ts", formats: ["es"] },
    },
  });
  const source = (Array.isArray(built) ? built[0] : built).output.find(
    (item) => item.type === "chunk",
  ).code;
  const { code } = await minify(source, { module: true, compress: { passes: 2 } });
  const { createFeaturevisor } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const samples = 9,
    iterations = 2000,
    warmup = 1000;
  const rows = [];
  for (const fields of [10, 100, 1000]) {
    const value = Object.fromEntries(
      Array.from({ length: fields }, (_, index) => [
        `field${index}`,
        { label: `Value ${index}`, enabled: true },
      ]),
    );
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile: {
        schemaVersion: "2",
        revision: "large",
        segments: {},
        features: {},
        variables: {
          source: { type: "object", defaultValue: value },
          config: { type: "object", compose: [{ key: "value", variable: "source" }] },
        },
      },
    });
    const context = { userId: "trial-user" };
    const compose = () => f.getVariable("config", context);
    const direct = () => ({ value: f.getVariable("source", context) });
    assert.equal(JSON.stringify(compose()), JSON.stringify(direct()));
    const operations = [compose, direct],
      times = [[], []];
    for (const operation of operations) for (let i = 0; i < warmup; i++) operation();
    for (let sample = 0; sample < samples; sample++)
      for (const index of sample % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) operations[index]();
        times[index].push(((performance.now() - start) * 1000) / iterations);
      }
    const [composed, directGetter] = times.map((values) => ({
      samples: values,
      medianUs: [...values].sort((a, b) => a - b)[4],
    }));
    rows.push({
      fields,
      sourceBytes: Buffer.byteLength(JSON.stringify(value)),
      composed,
      directGetter,
      ratio: composed.medianUs / directGetter.medianUs,
    });
    f.close();
  }
  const json = JSON.stringify(
    { unit: "microseconds per read", samples, iterations, warmup, rows },
    null,
    2,
  );
  if (process.argv[2]) writeFileSync(process.argv[2], json + "\n");
  console.log(json);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
