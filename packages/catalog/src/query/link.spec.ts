import { parsePath } from "react-router-dom";

import { isQueryHash, queryHash, queryHref, queryOf, searchWithoutQuery } from "./link";

describe("query links", () => {
  const query = "FROM features\nWHERE key == 'a#b?c'\nORDER BY key";

  it("keeps the query after #, whatever it holds", () => {
    const href = queryHref("/sets/web", query);
    expect(href).toMatch(/^\/sets\/web\/query#q=/);
    expect(href.slice(href.indexOf("#") + 1)).not.toMatch(/[#?]/);
    expect(queryOf({ hash: queryHash(query), search: "?view=full" })).toBe(query);
  });

  it("reads an older link's ?q=, and the fragment first", () => {
    expect(queryOf({ hash: "", search: "?q=FROM+segments" })).toBe("FROM segments");
    expect(queryOf({ hash: "#q=FROM+features", search: "?q=FROM+segments" })).toBe("FROM features");
    expect(queryOf({ hash: "#rule-everyone", search: "" })).toBe(null);
    expect(searchWithoutQuery("?q=FROM+segments&view=full")).toBe("?view=full");
    expect(searchWithoutQuery("?q=FROM+segments")).toBe("");
  });

  it("survives the hash router, whose route already sits after #", () => {
    // The hash router writes a link after its own #, and reads the route back with parsePath
    const url = `https://catalog.example.com/#${queryHref("/sets/web", query)}`;
    const route = parsePath(new URL(url).hash.slice(1));
    expect(route.pathname).toBe("/sets/web/query");
    expect(queryOf({ hash: route.hash ?? "", search: route.search ?? "" })).toBe(query);
  });

  it("tells a query from an anchor", () => {
    expect(isQueryHash(queryHash(query))).toBe(true);
    expect(isQueryHash("#rule-everyone")).toBe(false);
    expect(isQueryHash("")).toBe(false);
  });
});
