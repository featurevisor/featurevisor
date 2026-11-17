/**
 * Where a report's FQL lives in a URL: after `#`, as `#q=FROM+features…`. A fragment never
 * reaches a server, so a long query is never cut off by a server's or a proxy's limit on a
 * URL's length, and only the page reads it. With the hash router, the route's own fragment
 * holds it, as `#/query#q=…`. Links from before it moved still work, with `?q=`.
 */

const PARAM = "q";

/** The fragment that holds a query, `#` included */
export function queryHash(query: string): string {
  return `#${new URLSearchParams({ [PARAM]: query })}`;
}

/** A link to the Query page that runs a query, under a Set's base path or none */
export function queryHref(basePath: string, query: string): string {
  return `${basePath}/query${queryHash(query)}`;
}

/** The query a location holds, after `#` or in an older link's `?q=` */
export function queryOf(location: { hash: string; search: string }): string | null {
  return (
    new URLSearchParams(location.hash.slice(1)).get(PARAM) ??
    new URLSearchParams(location.search).get(PARAM)
  );
}

/** The search without an older link's query, which the fragment holds instead */
export function searchWithoutQuery(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** Whether a fragment holds a query rather than naming an anchor to scroll to */
export function isQueryHash(hash: string): boolean {
  return hash.startsWith(`#${PARAM}=`);
}
