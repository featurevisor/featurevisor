/**
 * Questions the Query page offers ready to run, as a product manager or an engineer would ask
 * them. Each is ordinary FQL to read, change and share. Examples that need a feature, a team or
 * an attribute take one from the project, and are left out when it has none.
 */

export interface Example {
  title: string;
  about: string;
  query: string;
}

export interface ExampleGroup {
  section: string;
  examples: Example[];
}

/** What a project has, for examples that name its own features, teams and attributes */
export interface ExampleSource {
  features: Array<{
    key: string;
    variations: string[];
    variables: string[];
    segments: string[];
    requires: string[];
  }>;
  variables: string[];
  /** Attributes, most used first */
  attributes: string[];
  /** Owners, owning most first */
  owners: string[];
  /** Attributes features bucket by alone, which split rollouts rather than name audiences */
  bucketBy: string[];
}

const lines = (...text: string[]) => text.join("\n");
const quote = (text: string) => `'${text.replace(/'/g, "\\'")}'`;

/** The names the examples use: a team, an attribute rows vary by, an experiment and a feature */
function namesOf(source: ExampleSource) {
  const experiments = source.features.filter((feature) => feature.variations.length > 1);
  return {
    owner: source.owners[0] as string | undefined,
    attribute: source.attributes.find((attribute) => !source.bucketBy.includes(attribute)),
    // One with variables shows a value per variation too
    experiment: experiments.find((feature) => feature.variables.length) ?? experiments[0],
    // Targeted by segments, and deciding alone, so every row's answer is its own
    feature:
      source.features.find((feature) => feature.segments.length && !feature.requires.length) ??
      source.features[0],
    variable: source.variables[0] as string | undefined,
  };
}

/** Examples, by section, naming what this project has */
export function examplesFor(source: ExampleSource): ExampleGroup[] {
  const { owner, attribute, experiment, feature, variable } = namesOf(source);
  const treatment = experiment?.variations[experiment.variations.length - 1];
  const optional = (example: Example | false | undefined | "") => (example ? [example] : []);

  const groups: ExampleGroup[] = [
    {
      section: "What is defined",
      examples: [
        {
          title: "Features and their owners",
          about: "Every feature with its owner, tags and what it buckets by",
          query: lines("FROM features", "SELECT key, owner, tags, bucketBy", "ORDER BY owner, key"),
        },
        ...optional(
          owner && {
            title: "Everything a team owns",
            about: `Features, global variables and segments ${owner} owns`,
            query: lines(
              "FROM features, variables, segments",
              `WHERE owners includes ${quote(owner)}`,
              "SELECT kind, key, description",
              "ORDER BY kind, key",
            ),
          },
        ),
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
        ...optional(
          attribute && {
            title: "What compares an attribute",
            about: `Features and global variables whose own conditions compare ${attribute}`,
            query: lines(
              "FROM features, variables",
              `WHERE attributes includes ${quote(attribute)}`,
              "SELECT kind, key, segments, attributes, requires",
            ),
          },
        ),
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
            "ORDER BY deadlineStatus, deadline",
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
            "ORDER BY updated DESC",
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
            "ORDER BY 'Rollout' DESC",
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
        ...optional(
          feature && {
            title: "Where a feature is on",
            about: `${feature.key} for every audience its rules name, in each environment`,
            query: lines(
              "FROM features",
              `WHERE key == ${quote(feature.key)}`,
              "VARY *",
              "ENVIRONMENT *",
              "SELECT feature(key)",
              "AS MATRIX",
            ),
          },
        ),
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
        ...optional(
          attribute && {
            title: `Experiments by ${attribute}`,
            about: `Each experiment's split for every ${attribute} its rules name`,
            query: lines(
              "FROM features",
              "WHERE variations notEmpty",
              `VARY ${attribute}`,
              "SELECT feature(key).variation",
              "AS MATRIX",
            ),
          },
        ),
        ...optional(
          experiment &&
            attribute &&
            treatment && {
              title: `Who gets ${treatment}`,
              about: `Each ${attribute} where everyone gets ${experiment.key}'s ${treatment}`,
              query: lines(
                `VARY ${attribute}`,
                `WHERE feature(${quote(experiment.key)}).variation == ${quote(treatment)}`,
                `SELECT ${attribute}, feature(${quote(experiment.key)}).variation`,
              ),
            },
        ),
      ],
    },
    {
      section: "People",
      examples: [
        {
          title: "What one person gets",
          about: "Every feature for user-1, and its variation",
          query: lines(
            "FROM features",
            "CONTEXT { userId: 'user-1' }",
            "SELECT key, feature(key), feature(key).variation",
          ),
        },
        ...optional(
          (experiment || feature) && {
            title: "Places in a rollout",
            about: "What someone at each place gets, as test specs write at",
            query: lines(
              "AT 10, 50, 90",
              `SELECT feature(${quote((experiment || feature)!.key)})${
                experiment ? `, feature(${quote(experiment.key)}).variation` : ""
              }`,
            ),
          },
        ),
        ...optional(
          attribute &&
            (feature || experiment || variable) && {
              title: "Columns from anywhere",
              about: `A row per ${attribute}, columns from features and a global variable`,
              query: lines(
                `VARY ${attribute}`,
                "SELECT",
                [
                  `  ${attribute}`,
                  ...(feature ? [`  feature(${quote(feature.key)})`] : []),
                  ...(experiment
                    ? [
                        `  feature(${quote(experiment.key)}).variation`,
                        ...experiment.variables
                          .slice(0, 1)
                          .map((name) => `  feature(${quote(experiment.key)}).${name}`),
                      ]
                    : []),
                  ...(variable ? [`  variable(${quote(variable)})`] : []),
                ].join(",\n"),
              ),
            },
        ),
        ...optional(
          attribute && {
            title: `Global variables by ${attribute}`,
            about: `Every global variable's value for each ${attribute} its overrides name`,
            query: lines(
              "FROM variables",
              `VARY ${attribute}`,
              "SELECT variable(key)",
              "AS MATRIX",
            ),
          },
        ),
      ],
    },
  ];
  return groups.filter((group) => group.examples.length);
}

/** The query the page opens with, which names nothing a project may lack */
export const FIRST_QUERY = lines(
  "FROM features",
  "SELECT key, owner, tags, bucketBy",
  "ORDER BY owner, key",
);
