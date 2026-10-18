/** Update only asset URLs, leaving document fragments and navigation links untouched. */
export function rewriteCatalogHtml(html: string, basePath: string): string {
  const marker = /<meta\s+name=["']featurevisor-catalog-base["'][^>]*>/i;
  const previousMarker = html.match(marker)?.[0];
  const previousBase = previousMarker?.match(/content=["']([^"']*)["']/i)?.[1] || "/";
  const meta = `<meta name="featurevisor-catalog-base" content="${basePath}">`;

  // Rebase a previous export as well as the relative URLs in Vite's original output.
  const updated = html.replace(/<(?:script|link|img)\b[^>]*>/gi, (tag) =>
    tag.replace(/\b(src|href)=("|')([^"']*)\2/gi, (attribute, name, quote, url: string) => {
      if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(url)) return attribute;
      const relative = url.startsWith(previousBase)
        ? url.slice(previousBase.length)
        : url.replace(/^(?:\.\/|\/)/, "");
      return `${name}=${quote}${basePath}${relative}${quote}`;
    }),
  );

  return marker.test(updated)
    ? updated.replace(marker, meta)
    : updated.replace(/<head\b[^>]*>/i, (head) => `${head}${meta}`);
}
