import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

jest.mock("react-markdown", () => (props: { children: string }) => props.children);

let mockIndex: unknown;
jest.mock("../useCatalogIndex", () => ({
  useCatalogIndex: () => ({ index: mockIndex, error: null }),
}));

import { CatalogProvider } from "../context/CatalogContext";
import { getListEntities, getMetadataChips, ListPage } from "./ListPage";
import { OverviewPage } from "./HomePage";
import { DeadlinesPage } from "./DeadlinesPage";
import { OverviewTab } from "./EntityDetailPage";
import { encodeDeadline, getDeadlineClock, getLocalDate } from "../metadata";
import { scoreEntity } from "../searchModel";
import type { CatalogIndex, CatalogManifest, EntitySummary } from "../types";

const manifest: CatalogManifest = {
  schemaVersion: "1",
  generatedAt: "",
  sets: false,
  setKeys: [],
  projectConfig: {
    tags: [],
    deadlineTypes: { remove: { description: "Remove the flag and its code" } },
  },
  paths: { projectHistory: "data/project/history" },
  counts: {},
};

/** A date some days from today, as the browser sees it */
const inDays = (days: number) => getLocalDate(Date.now() + days * 24 * 60 * 60 * 1000);
const deadline = (type: string, by: string, done?: string) =>
  encodeDeadline({ type, by, ...(done ? { done } : {}) });

const summaries: EntitySummary[] = [
  {
    key: "checkout",
    href: "",
    description: "New checkout",
    owners: ["checkout-team"],
    deadlines: [deadline("remove", inDays(10)), deadline("review", inDays(-30), inDays(-31))],
    metadataTerms: ["jira=CHECKOUT-1", "links.design=https://example.com"],
  },
  {
    key: "redesign",
    href: "",
    owners: ["growth-team", "checkout-team"],
    deadlines: [deadline("deprecate", inDays(-9))],
  },
  { key: "banner", href: "", owners: ["growth-team"], deadlines: [deadline("review", inDays(90))] },
  { key: "plain", href: "" },
  { key: "old", href: "", archived: true, deadlines: [deadline("remove", inDays(-100))] },
];

function withIndex(entities: Partial<Record<string, EntitySummary[]>>) {
  mockIndex = { set: "", counts: {}, entities } as unknown as CatalogIndex;
}

function render(route: string, catalog = manifest) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider initialManifest={catalog}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/deadlines" element={<DeadlinesPage />} />
          <Route path="/:entityPath" element={<ListPage />} />
        </Routes>
      </CatalogProvider>
    </MemoryRouter>,
  );
}

const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("metadata in lists", () => {
  const keys = (query: string) =>
    getListEntities([...summaries], query, "name").map((entity) => entity.key);

  it("filters by owner, every one named", () => {
    expect(keys("owner:checkout-team")).toEqual(["checkout", "redesign"]);
    expect(keys("owner:Checkout-Team owner:growth-team")).toEqual(["redesign"]);
    expect(keys("with:owner")).toEqual(["banner", "checkout", "redesign"]);
    expect(keys("without:owner")).toEqual(["old", "plain"]);
  });

  it("filters by deadline status and type, matching one deadline with every value", () => {
    expect(keys("deadline:overdue")).toEqual(["old", "redesign"]);
    expect(keys("deadline:upcoming")).toEqual(["checkout"]);
    expect(keys("deadline:later")).toEqual(["banner"]);
    expect(keys("deadline:done")).toEqual(["checkout"]);
    expect(keys("deadline:open")).toEqual(["banner", "checkout", "old", "redesign"]);
    expect(keys("deadline:remove")).toEqual(["checkout", "old"]);
    expect(keys("deadline:remove deadline:upcoming")).toEqual(["checkout"]);
    expect(keys("deadline:review deadline:done")).toEqual(["checkout"]);
    // checkout has a review and an upcoming deadline, but no upcoming review
    expect(keys("deadline:review deadline:upcoming")).toEqual([]);
    expect(keys("with:deadlines")).toEqual(["banner", "checkout", "old", "redesign"]);
    expect(keys("without:deadlines")).toEqual(["plain"]);
  });

  it("filters by metadata keys and values, and finds them as plain text", () => {
    expect(keys("metadata:jira")).toEqual(["checkout"]);
    expect(keys("metadata:jira=checkout-1")).toEqual(["checkout"]);
    expect(keys("metadata:jira=checkout-2")).toEqual([]);
    expect(keys("metadata:links")).toEqual(["checkout"]);
    expect(keys("with:metadata")).toEqual(["banner", "checkout", "old", "redesign"]);
    expect(keys("without:metadata")).toEqual(["plain"]);
    expect(keys("checkout-1")).toEqual(["checkout"]);
    expect(keys("growth-team")).toEqual(["banner", "redesign"]);
  });

  it("offers owner and deadline chips in labelled groups, only where they apply", () => {
    const clock = getDeadlineClock();
    expect(
      getMetadataChips(summaries, clock).map(({ group, label, token }) => [group, label, token]),
    ).toEqual([
      ["Owner", "checkout-team", "owner:checkout-team"],
      ["Owner", "growth-team", "owner:growth-team"],
      ["Owner", "None", "without:owner"],
      ["Deadlines", "Overdue", "deadline:overdue"],
      ["Deadlines", "Due in 30 days", "deadline:upcoming"],
      ["Deadlines", "Deprecate", "deadline:deprecate"],
      ["Deadlines", "Remove", "deadline:remove"],
      ["Deadlines", "Review", "deadline:review"],
    ]);
    expect(getMetadataChips([{ key: "plain", href: "" }], clock)).toEqual([]);

    withIndex({ feature: summaries });
    const html = render("/features");
    // features keep their other chips in one row, with owners and deadlines labelled after it
    expect(html).toContain('role="group" aria-label="Filters"');
    expect(html).toContain('role="group" aria-label="Owner"');
    expect(html).toContain('role="group" aria-label="Deadlines"');
    expect(html).toContain(">Owner</span>");
  });

  it("shows the most pressing deadline and the owner on each row", () => {
    withIndex({ feature: summaries });
    const html = render("/features");
    const row = (key: string) => {
      const start = html.indexOf(`>${key}<`);
      return text(html.slice(start, html.indexOf("</a>", start)));
    };
    expect(row("redesign")).toContain("overdue");
    expect(row("redesign")).toContain("owners growth-team +1");
    expect(row("checkout")).toContain("due in 10 days");
    expect(row("checkout")).toContain("owner checkout-team");
    expect(row("banner")).not.toContain("due in");
    // an archived definition's deadline needs no attention
    expect(row("old")).not.toContain("overdue");
    expect(row("plain")).not.toContain("owner");
  });
});

describe("metadata on the home page", () => {
  it("lists overdue deadlines and features without an owner, then what is coming up", () => {
    withIndex({ feature: summaries, variable: [] });
    const html = render("/");
    expect(html).toContain("Overdue deadlines");
    expect(html).toContain('href="/deadlines?status=overdue"');
    expect(html).toContain("Features without an owner");
    expect(html).toContain(`href="/features?q=${encodeURIComponent("without:owner")}"`);
    expect(html).toContain("Coming up");
    const comingUp = text(html.slice(html.indexOf("Coming up")));
    expect(comingUp.indexOf("Remove")).toBeLessThan(comingUp.indexOf("Review"));
    expect(comingUp).toContain("Due in 10 days");
    expect(comingUp).toContain("View all deadlines");
    // a project naming no owners and planning nothing sees none of it
    withIndex({ feature: [{ key: "plain", href: "" }] });
    const plain = render("/");
    expect(plain).not.toContain("Overdue deadlines");
    expect(plain).not.toContain("without an owner");
    expect(plain).not.toContain("Coming up");
  });
});

describe("the Deadlines page", () => {
  it("groups open deadlines by how they stand, and filters by status and type", () => {
    withIndex({ feature: summaries });
    const open = text(render("/deadlines"));
    expect(open).toContain("Overdue · 1");
    expect(open).toContain("Due in the next 30 days · 1");
    expect(open).toContain("Later · 1");
    expect(open).not.toContain("Done ·");
    expect(open).toContain("Overdue by 9 days");
    expect(open).not.toContain("old");

    const done = text(render("/deadlines?status=done"));
    expect(done).toContain("Done · 1");
    expect(done).not.toContain("Overdue ·");

    const removals = text(render("/deadlines?status=all&type=remove"));
    expect(removals).toContain("Remove");
    expect(removals).not.toContain("Deprecate checkout");
    expect(removals).not.toContain("Overdue ·");

    withIndex({ feature: [{ key: "plain", href: "" }] });
    expect(text(render("/deadlines"))).toContain("No deadlines");
  });
});

describe("metadata on a definition's Overview", () => {
  const renderOverview = (entity: Record<string, unknown>) =>
    renderToStaticMarkup(
      <MemoryRouter initialEntries={["/features/checkout"]}>
        <CatalogProvider initialManifest={manifest}>
          <Routes>
            <Route
              element={
                <Outlet
                  context={{
                    detail: { type: "feature", key: "checkout", entity },
                    setKey: undefined,
                  }}
                />
              }
            >
              <Route path="*" element={<OverviewTab />} />
            </Route>
          </Routes>
        </CatalogProvider>
      </MemoryRouter>,
    );

  it("shows the owner, every deadline and the rest of the metadata", () => {
    withIndex({ feature: [] });
    const html = renderOverview({
      description: "New checkout",
      bucketBy: "userId",
      metadata: {
        owner: ["checkout-team", "payments team"],
        jira: "CHECKOUT-1",
        stakeholders: ["product", "payments"],
        links: { design: "https://example.com/design", unsafe: "javascript:alert(1)" },
        count: 3,
        deadlines: {
          review: { by: inDays(-20), done: inDays(-18) },
          remove: { by: inDays(10), description: "Once every market moves", ticket: "CHECKOUT-2" },
        },
      },
    });
    const plain = text(html);
    expect(plain).toContain("Owners checkout-team payments team");
    expect(html).toContain(`href="/features?q=${encodeURIComponent("owner:checkout-team")}"`);
    expect(html).toContain(`href="/features?q=${encodeURIComponent('owner:"payments team"')}"`);

    expect(plain).toContain("Deadlines");
    // open deadlines first, then those done
    expect(plain.indexOf("Remove")).toBeLessThan(plain.indexOf("Review"));
    expect(plain).toContain("Remove the flag and its code");
    expect(plain).toContain("Once every market moves");
    expect(plain).toContain("ticket CHECKOUT-2");
    expect(plain).toContain("Due in 10 days");
    expect(plain).toContain("Done on");
    expect(plain).toContain("2 days after its deadline");

    expect(plain).toContain("Metadata");
    expect(plain).toContain("jira CHECKOUT-1");
    expect(html).toContain('href="https://example.com/design"');
    expect(plain).toContain("javascript:alert(1)");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("<code");
  });

  it("shows nothing for metadata a definition does not have", () => {
    withIndex({ feature: [] });
    const plain = text(renderOverview({ description: "Plain", bucketBy: "userId" }));
    expect(plain).not.toContain("Owner");
    expect(plain).not.toContain("Deadlines");
    expect(plain).not.toContain("Metadata");
    const ownerOnly = text(
      renderOverview({ description: "Owned", bucketBy: "userId", metadata: { owner: "a" } }),
    );
    expect(ownerOnly).toContain("Owner a");
    expect(ownerOnly).not.toContain("Metadata");
  });
});

describe("metadata in search", () => {
  it("finds owners and metadata values, naming what matched", () => {
    const entity = {
      key: "checkout",
      owners: ["checkout-team"],
      metadataTerms: ["jira=CHECKOUT-1"],
    };
    expect(scoreEntity(entity, ["checkout-1"])?.match).toEqual({
      kind: "metadata jira",
      value: "CHECKOUT-1",
    });
    expect(scoreEntity({ key: "x", owners: ["growth-team"] }, ["growth"])?.match).toEqual({
      kind: "owner",
      value: "growth-team",
    });
  });
});
