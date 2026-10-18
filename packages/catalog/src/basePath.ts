/** The exporter sets the base before the browser requests any assets or data. */
export function getCatalogBasePath(): string {
  if (typeof document === "undefined") return "/";
  return (
    document.querySelector('meta[name="featurevisor-catalog-base"]')?.getAttribute("content") || "/"
  );
}
