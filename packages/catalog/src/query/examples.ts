/**
 * Questions the Query page offers ready to run, as a product manager or an engineer would ask
 * them. Each is ordinary FQL to read, change and share.
 */

export interface Example {
  title: string;
  about: string;
  query: string;
}

const lines = (...text: string[]) => text.join("\n");

export const EXAMPLES: Array<{ section: string; examples: Example[] }> = [
  {
    section: "What is defined",
    examples: [
      {
        title: "Features and their owners",
        about: "Every feature with its owner, tags and what it buckets by",
        query: lines("FROM features", "SELECT key, owner, tags, bucketBy", "SORT BY owner, key"),
      },
      {
        title: "Everything a team owns",
        about: "Features, global variables and segments of one team",
        query: lines(
          "FROM features, variables, segments",
          "WHERE owners includes 'platform-team'",
          "SELECT kind, key, description",
          "SORT BY kind, key",
        ),
      },
      {
        title: "Gaps to fill",
        about: "Features without an owner, a description or tests",
        query: lines(
          "FROM features",
          "WHERE owner notExists or description notExists or tested == false",
          "SELECT key, owner, description, tested",
        ),
      },
      {
        title: "Unused segments",
        about: "Segments no feature or global variable depends on",
        query: lines("FROM segments", "WHERE usedBy == 0", "SELECT key, description"),
      },
      {
        title: "What compares an attribute",
        about: "Features whose own conditions compare country",
        query: lines(
          "FROM features",
          "WHERE attributes includes 'country'",
          "SELECT key, segments, attributes, requires",
        ),
      },
    ],
  },
  {
    section: "Owners and deadlines",
    examples: [
      {
        title: "Deadlines coming up",
        about: "Open deadlines, overdue first",
        query: lines(
          "FROM features, variables",
          "WHERE deadlineStatus in ['overdue', 'today', 'upcoming', 'later']",
          "SELECT kind, key, owner, deadlineType, deadline, deadlineStatus",
          "SORT BY deadlineStatus, deadline",
        ),
      },
      {
        title: "Features per owner",
        about: "How many features each team owns",
        query: lines("FROM features", "SELECT owner, count()", "GROUP BY owner"),
      },
      {
        title: "Features per tag",
        about: "How many features carry each tag",
        query: lines("FROM features", "SELECT tags, count()", "GROUP BY tags"),
      },
      {
        title: "Recently changed",
        about: "The ten latest changes to features, variables and segments",
        query: lines(
          "FROM features, variables, segments",
          "SELECT kind, key, updatedBy, updated",
          "SORT BY updated DESC",
          "LIMIT 10",
        ),
      },
    ],
  },
  {
    section: "Rollouts",
    examples: [
      {
        title: "Rollouts in production",
        about: "How many features are on, partly on or off for everyone",
        query: lines(
          "FROM features",
          "ENVIRONMENT production",
          "SELECT feature(key), count()",
          "GROUP BY feature(key)",
        ),
      },
      {
        title: "Rollouts in progress",
        about: "Features partly rolled out in production, furthest first",
        query: lines(
          "FROM features",
          "WHERE rollout(feature(key)) > 0 and rollout(feature(key)) < 100",
          "ENVIRONMENT production",
          "SELECT key, owner, rollout(feature(key)) AS 'Rollout'",
          "SORT BY 'Rollout' DESC",
        ),
      },
      {
        title: "Ready to ship",
        about: "Fully on in staging, not yet for everyone in production",
        query: lines(
          "FROM features",
          "WHERE rollout(feature(key, 'staging')) == 100",
          "  and rollout(feature(key, 'production')) < 100",
          "SELECT key, owner, feature(key, 'staging') AS 'Staging',",
          "  feature(key, 'production') AS 'Production'",
        ),
      },
      {
        title: "Environments side by side",
        about: "Features whose rules differ, in staging and production",
        query: lines(
          "FROM features",
          "WHERE differs == true",
          "ENVIRONMENT staging, production",
          "SELECT feature(key)",
          "AS MATRIX",
        ),
      },
      {
        title: "Deprecated, still on",
        about: "Deprecated features someone still gets in production",
        query: lines(
          "FROM features",
          "WHERE deprecated == true and rollout(feature(key)) > 0",
          "ENVIRONMENT production",
          "SELECT key, owner, feature(key)",
        ),
      },
      {
        title: "Where a feature is on",
        about: "foo for every audience its rules name, in each environment",
        query: lines(
          "FROM features",
          "WHERE key == 'foo'",
          "VARY *",
          "ENVIRONMENT *",
          "SELECT feature(key)",
          "AS MATRIX",
        ),
      },
    ],
  },
  {
    section: "Experiments",
    examples: [
      {
        title: "Experiments in production",
        about: "Every experiment's split for everyone",
        query: lines(
          "FROM features",
          "WHERE variations notEmpty",
          "ENVIRONMENT production",
          "SELECT key, owner, feature(key).variation",
        ),
      },
      {
        title: "Experiments by country",
        about: "Each experiment's split in every country its rules name",
        query: lines(
          "FROM features",
          "WHERE variations notEmpty",
          "VARY country",
          "SELECT feature(key).variation",
          "AS MATRIX",
        ),
      },
      {
        title: "Who gets the treatment",
        about: "Countries where everyone sees allowSignup's treatment",
        query: lines(
          "VARY country",
          "WHERE feature('allowSignup').variation == 'treatment'",
          "SELECT country, feature('allowSignup').variation",
        ),
      },
    ],
  },
  {
    section: "People",
    examples: [
      {
        title: "What one person gets",
        about: "Every feature for a Dutch user, and its variation",
        query: lines(
          "FROM features",
          "FOR { userId: 'user-1', country: 'nl' }",
          "SELECT key, feature(key), feature(key).variation",
        ),
      },
      {
        title: "Columns from anywhere",
        about: "A row per country, columns from several features and a global variable",
        query: lines(
          "VARY country",
          "SELECT",
          "  country,",
          "  feature('foo') AS 'Foo',",
          "  feature('foo').variation,",
          "  feature('foo').bar,",
          "  feature('allowSignup').variation,",
          "  variable('checkoutSettings').currency",
        ),
      },
      {
        title: "Global variables by country",
        about: "Every global variable's value in each country its overrides name",
        query: lines("FROM variables", "VARY country", "SELECT variable(key)", "AS MATRIX"),
      },
    ],
  },
];

/** The query the page opens with */
export const FIRST_QUERY = EXAMPLES[0].examples[0].query;
