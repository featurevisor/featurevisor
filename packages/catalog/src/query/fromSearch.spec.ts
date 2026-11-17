import { searchToFql } from "./fromSearch";

describe("searchToFql", () => {
  it("writes a list's filters and words as WHERE, keeping their case", () => {
    expect(searchToFql("feature", "tag:web owner:Growth-Team deadline:overdue checkout")).toBe(
      [
        "FROM features",
        "WHERE tags includes 'web'",
        "  and owners includes 'Growth-Team'",
        "  and deadlineStatus == 'overdue'",
        "  and (key contains 'checkout' or description contains 'checkout')",
      ].join("\n"),
    );
  });

  it("knows with, without, metadata and deadline types", () => {
    expect(
      searchToFql(
        "segment",
        "without:usage with:owner metadata:jira=FV-12 metadata:team deadline:remove",
      ),
    ).toBe(
      [
        "FROM segments",
        "WHERE usedBy == 0",
        "  and owner exists",
        "  and metadata.jira == 'FV-12'",
        "  and metadata.team exists",
        "  and deadlineType == 'remove'",
      ].join("\n"),
    );
  });

  it("leaves what FQL has no property for as a comment, and opens a bare list as FROM", () => {
    expect(searchToFql("feature", "uses:segment:netherlands in:production")).toBe(
      [
        "# Not in FQL: uses:segment:netherlands",
        "FROM features",
        "WHERE environments includes 'production'",
      ].join("\n"),
    );
    expect(searchToFql("attribute", "")).toBe("FROM attributes");
  });
});
