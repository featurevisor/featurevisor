import { rewriteCatalogHtml } from "./html";

const original = `<!doctype html><html><head>
<link rel="icon" href="./favicon.png">
<script type="module" src="./assets/main.js"></script>
<link rel="stylesheet" href="./assets/main.css">
<link rel="modulepreload" href="/assets/chunk.js">
</head><body><img src='logo-text.png'><a href="#rules">Rules</a>
<a href="features/checkout">Checkout</a></body></html>`;

describe("Catalog HTML base marker", () => {
  it.each(["/", "/catalog/", "/internal/catalog/"])(
    "prefixes assets at %s without a base element",
    (base) => {
      const html = rewriteCatalogHtml(original, base);
      expect(html).toContain(`<meta name="featurevisor-catalog-base" content="${base}">`);
      for (const asset of ["favicon.png", "assets/main.js", "assets/main.css", "assets/chunk.js"]) {
        expect(html).toContain(`"${base}${asset}"`);
      }
      expect(html).toContain(`src='${base}logo-text.png'`);
      expect(html).not.toContain("<base");
      expect(html).toContain('<a href="#rules">');
      expect(html).toContain('<a href="features/checkout">');
      expect(rewriteCatalogHtml(html, base)).toBe(html);
    },
  );

  it("rebases existing exports repeatedly, including back to the root", () => {
    let html = original;
    for (const base of ["/catalog/", "/internal/catalog/", "/other/", "/", "/catalog/"]) {
      html = rewriteCatalogHtml(html, base);
      expect(html).toBe(rewriteCatalogHtml(original, base));
      expect(html.match(/name="featurevisor-catalog-base"/g)).toHaveLength(1);
    }
  });

  it("preserves remote, inline, empty and fragment asset references", () => {
    for (const url of [
      "https://cdn.test/main.js",
      "//cdn.test/main.js",
      "data:image/png;base64,x",
      "",
      "#icon",
      "?v=1",
    ]) {
      const tag = `<script src="${url}"></script><link href="${url}">`;
      expect(rewriteCatalogHtml(`<head>${tag}</head>`, "/catalog/")).toContain(tag);
    }
  });
});
