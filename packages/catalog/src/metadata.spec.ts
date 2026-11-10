import {
  compareDeadlines,
  decodeDeadline,
  encodeDeadline,
  getDeadlineClock,
  getDeadlineLabel,
  getDeadlines,
  getDeadlineStatus,
  getDeadlineTimestamp,
  getMetadataTerms,
  getMostPressingDeadline,
  getOwners,
  getProjectDeadlines,
  getSafeUrl,
  matchesDeadlineFilters,
  matchesMetadataFilter,
} from "./metadata";
import type { CatalogIndex } from "./types";

const clock = getDeadlineClock("2027-01-15");

describe("Catalog metadata", () => {
  it("reads owners and deadlines as Core does", () => {
    const metadata = {
      owner: ["checkout-team", "", 1],
      deadlines: {
        review: { by: "2027-01-01", done: "2026-12-30", description: "Quarterly" },
        remove: { by: "2027-01-20", ticket: "X-1" },
        broken: { done: true },
      },
    };
    expect(getOwners(metadata)).toEqual(["checkout-team"]);
    expect(getDeadlines(metadata)).toEqual([
      { type: "review", by: "2027-01-01", done: "2026-12-30", description: "Quarterly" },
      { type: "remove", by: "2027-01-20" },
    ]);
    expect(getDeadlineStatus({ by: "2027-01-20" }, clock)).toBe("upcoming");
  });

  it("keeps each deadline in the index as one string, and reads it back", () => {
    for (const deadline of [
      { type: "review", by: "2027-01-01", done: "2026-12-30", description: "Quarterly | 日本語" },
      { type: "remove", by: "2027-01-20T09:00:00+01:00", done: true as const },
      { type: "notify", by: "2027-01-20" },
    ]) {
      expect(decodeDeadline(encodeDeadline(deadline))).toEqual(deadline);
    }
    expect(encodeDeadline({ type: "notify", by: "2027-01-20" })).toBe("notify\u001f2027-01-20");
  });

  it("finds the deadline that matters most", () => {
    const deadlines = [
      { type: "later", by: "2027-06-01" },
      { type: "soon", by: "2027-01-20" },
      { type: "late", by: "2027-01-10" },
      { type: "older", by: "2026-12-01" },
      { type: "done", by: "2026-01-01", done: true as const },
    ];
    expect(getMostPressingDeadline(deadlines, clock)?.deadline.type).toBe("older");
    expect(getMostPressingDeadline(deadlines.slice(0, 2), clock)?.deadline.type).toBe("soon");
    expect(getMostPressingDeadline([deadlines[4]], clock)).toBeUndefined();
    // open ones come first, and done ones after, most recent first
    expect(
      compareDeadlines({ status: "done", days: -3 }, { status: "overdue", days: -9 }),
    ).toBeGreaterThan(0);
    expect(
      compareDeadlines({ status: "done", days: -3 }, { status: "done", days: -9 }),
    ).toBeLessThan(0);
  });

  it("matches one deadline against every filter value", () => {
    const deadlines = [
      { type: "remove", by: "2027-01-20" },
      { type: "review", by: "2027-01-01", done: true as const },
    ];
    expect(matchesDeadlineFilters(deadlines, ["remove", "upcoming"], clock)).toBe(true);
    expect(matchesDeadlineFilters(deadlines, ["Remove"], clock)).toBe(true);
    expect(matchesDeadlineFilters(deadlines, ["remove", "done"], clock)).toBe(false);
    expect(matchesDeadlineFilters(deadlines, ["review", "done"], clock)).toBe(true);
    expect(matchesDeadlineFilters([], ["open"], clock)).toBe(false);
  });

  it("turns the rest of metadata into terms lists and search can read", () => {
    const terms = getMetadataTerms({
      owner: "x",
      deadlines: { review: { by: "2027-01-01" } },
      jira: "CHECKOUT-1",
      priority: 2,
      flag: false,
      none: null,
      stakeholders: ["product", "payments"],
      links: { design: "https://example.com" },
    });
    expect(terms).toEqual([
      "jira=CHECKOUT-1",
      "priority=2",
      "flag=false",
      "stakeholders=product",
      "stakeholders=payments",
      "links.design=https://example.com",
    ]);
    expect(matchesMetadataFilter(terms, "jira")).toBe(true);
    expect(matchesMetadataFilter(terms, "jira=checkout-1")).toBe(true);
    expect(matchesMetadataFilter(terms, "jira=checkout-2")).toBe(false);
    expect(matchesMetadataFilter(terms, "links")).toBe(true);
    expect(matchesMetadataFilter(terms, "links.design")).toBe(true);
    expect(matchesMetadataFilter(terms, "stakeholders=payments")).toBe(true);
    expect(matchesMetadataFilter(terms, "owner")).toBe(false);
    expect(matchesMetadataFilter(undefined, "jira")).toBe(false);
  });

  it("links only http and https URLs", () => {
    expect(getSafeUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(getSafeUrl("http://example.com")).toBe("http://example.com/");
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,x",
      "//example.com",
      "example.com",
      "https://exa mple.com",
    ]) {
      expect(getSafeUrl(value)).toBeUndefined();
    }
  });

  it("reads timestamps as the SDK does", () => {
    expect(getDeadlineTimestamp("2027-01-15T09:00:00+01:00")).toBe(
      Date.parse("2027-01-15T08:00:00Z"),
    );
    expect(getDeadlineTimestamp("2027-01-15T09:00:00.5Z")).toBe(
      Date.parse("2027-01-15T09:00:00.500Z"),
    );
    expect(getDeadlineTimestamp("2027-01-15T09:00:00")).toBeNull();
    expect(getDeadlineTimestamp("2027-02-30T09:00:00Z")).toBeNull();
    expect(getDeadlineLabel("notifyAPIUsers")).toBe("Notify API users");
  });

  it("collects every deadline in an index, archived definitions apart, nearest first", () => {
    const index = {
      set: "",
      counts: {},
      entities: {
        feature: [
          { key: "a", href: "", deadlines: ["remove\u001f2027-02-01"] },
          { key: "b", href: "", archived: true, deadlines: ["remove\u001f2026-01-01"] },
        ],
        variable: [{ key: "c", href: "", deadlines: ["review\u001f2027-01-01"] }],
        test: [{ key: "t", href: "", deadlines: ["review\u001f2027-01-01"] }],
      },
    } as unknown as CatalogIndex;
    expect(
      getProjectDeadlines(index, clock).map((item) => [item.type, item.entity.key, item.status]),
    ).toEqual([
      ["variable", "c", "overdue"],
      ["feature", "a", "upcoming"],
    ]);
  });
});
