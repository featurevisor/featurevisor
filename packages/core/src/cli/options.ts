export interface CLIOptionDefinition {
  type: "array" | "boolean" | "number" | "string";
  alias?: string | string[];
  choices?: readonly string[];
  description?: string;
  hidden?: boolean;
  demandOption?: boolean;
}

export type CLIOptionDefinitions = Record<string, CLIOptionDefinition>;

const outputOptions: CLIOptionDefinitions = {
  json: { type: "boolean", description: "print structured JSON output" },
  pretty: { type: "boolean", description: "pretty print JSON output" },
};

const setOption: CLIOptionDefinitions = {
  set: { type: "string", description: "select a project set" },
};

const targetOption: CLIOptionDefinitions = {
  target: { type: "array", description: "select one or more targets" },
};

const legacyOptions: CLIOptionDefinitions = {
  withScopes: { type: "boolean", alias: "with-scopes", hidden: true },
  withTags: { type: "boolean", alias: "with-tags", hidden: true },
  schemaVersion: { type: "string", alias: "schema-version", hidden: true },
};

export function getCompatibilityCLIOptions(): CLIOptionDefinitions {
  return legacyOptions;
}

const definitions: Record<string, CLIOptionDefinitions> = {
  "assess-distribution": {
    ...setOption,
    ...targetOption,
    environment: { type: "string", description: "environment to evaluate" },
    feature: { type: "string", description: "feature key to evaluate" },
    context: { type: "string", description: "JSON targeting context" },
    populateUuid: { type: "array", description: "context attributes to populate with UUIDs" },
    n: { type: "number", description: "number of evaluations" },
    inflate: {
      type: "number",
      description: "multiply definitions by this factor using synthetic copies for measurement",
    },
    verbose: { type: "boolean", description: "print generated contexts" },
  },
  benchmark: {
    ...setOption,
    ...targetOption,
    environment: { type: "string", description: "environment to evaluate" },
    feature: { type: "string", description: "feature key to evaluate" },
    context: { type: "string", description: "JSON targeting context" },
    variation: { type: "boolean", description: "benchmark variation evaluation" },
    variable: { type: "string", description: "benchmark a variable key" },
    n: { type: "number", description: "number of evaluations" },
    inflate: {
      type: "number",
      description: "multiply definitions by this factor using synthetic copies for measurement",
    },
  },
  build: {
    ...outputOptions,
    ...setOption,
    ...targetOption,
    verbose: { type: "boolean", description: "include error stack traces" },
    print: { type: "boolean", description: "print a generated datafile as JSON" },
    revision: { type: "string", description: "override the generated revision" },
    revisionFromHash: { type: "boolean", description: "generate revision from content hash" },
    environment: { type: "string", description: "build one environment" },
    feature: { type: "string", description: "build one feature" },
    variable: { type: "string", description: "build one global variable" },
    stateFiles: { type: "boolean", description: "write build state files" },
    inflate: {
      type: "number",
      description: "multiply definitions by this factor using synthetic copies for measurement",
    },
    datafilesDir: { type: "string", description: "override the datafiles directory" },
  },
  catalog: {
    outDir: { type: "string", description: "Catalog output directory" },
    branch: { type: "string", description: "branch for Catalog source and edit links" },
    port: { type: "number", alias: "p", description: "server port" },
    assets: { type: "boolean", description: "copy Catalog UI assets" },
    noAssets: { type: "boolean", description: "skip copying Catalog UI assets" },
    hashRouter: { type: "boolean", description: "use hash based browser routes" },
    testReport: {
      type: "string",
      description: "show results from a `featurevisor test --json` report file",
    },
    prettyOutput: { type: "boolean", description: "format Catalog JSON for inspection" },
    blockSize: { type: "number", description: "target Catalog block size in bytes" },
  },
  config: outputOptions,
  diff: {
    ...outputOptions,
    ...setOption,
    from: { type: "string", description: "starting Git reference (or working-tree)" },
    to: { type: "string", description: "ending Git reference (or working-tree)" },
  },
  evaluate: {
    ...outputOptions,
    ...setOption,
    ...targetOption,
    environment: { type: "string", description: "environment to evaluate" },
    feature: { type: "string", description: "feature key to evaluate" },
    variable: { type: "string", description: "global variable key to evaluate" },
    context: { type: "string", description: "JSON targeting context" },
    inflate: {
      type: "number",
      description: "multiply definitions by this factor using synthetic copies for measurement",
    },
    verbose: { type: "boolean", description: "print detailed evaluation logs" },
    explain: { type: "boolean", description: "explain SDK outcomes using CLI metadata" },
  },
  "find-duplicate-segments": {
    ...setOption,
    authors: { type: "boolean", description: "include entity authors" },
  },
  "find-usage": {
    ...setOption,
    feature: { type: "string", description: "find usage of a feature" },
    variable: { type: "string", description: "show dependencies of a global variable" },
    segment: { type: "string", description: "find usage of a segment" },
    attribute: { type: "string", description: "find usage of an attribute" },
    unusedSegments: { type: "boolean", description: "find unused segments" },
    unusedAttributes: { type: "boolean", description: "find unused attributes" },
    authors: { type: "boolean", description: "include entity authors" },
  },
  "generate-code": {
    ...setOption,
    language: { type: "string", choices: ["typescript"] },
    outDir: { type: "string", description: "generated code output directory" },
    tag: { type: "array", description: "include one or more feature or variable tags" },
    target: { type: "array", description: "include one or more feature or variable targets" },
    react: { type: "boolean", description: "generate React helpers" },
    importSdkPath: { type: "string", hidden: true },
    importReactPath: { type: "string", hidden: true },
  },
  fmt: {
    ...outputOptions,
    ...setOption,
    check: {
      type: "boolean",
      description: "list files that need formatting and exit with 1 if any do, without writing",
    },
    diff: { type: "boolean", description: "print what formatting would change, without writing" },
    since: {
      type: "string",
      description:
        "only files changed since HEAD left this Git reference, with uncommitted and untracked ones",
    },
    stdinFilepath: {
      type: "string",
      description: "format text from stdin as the definition at this path, and print it",
    },
    // the formatter's FORMAT_ENTITY_TYPES, which a test keeps in step
    entityType: {
      type: "string",
      choices: [
        "attribute",
        "schema",
        "segment",
        "feature",
        "variable",
        "target",
        "test",
        "scenario",
      ],
    },
    keyPattern: { type: "string", description: "filter entity keys by regular expression" },
  },
  info: {
    ...setOption,
    ...targetOption,
  },
  convert: {
    ...outputOptions,
    to: {
      type: "string",
      choices: ["flat", "environments", "sets", "expressions", "trees"],
      description: "the shape to convert to, or how to write conditions",
    },
    environments: {
      type: "string",
      description:
        "comma separated environments to create, or the order of environments made from sets",
    },
    sets: {
      type: "string",
      description: "comma separated sets to create from a project without either",
    },
    keep: { type: "string", description: "the environment or set a conversion to flat keeps" },
    apply: {
      type: "boolean",
      description: "write the conversion, which otherwise is only previewed",
    },
  },
  migrate: {
    ...outputOptions,
    check: {
      type: "boolean",
      description:
        "list what migration would change and exit with 1 if anything would, without writing",
    },
    diff: { type: "boolean", description: "print what migration would change, without writing" },
  },
  init: {
    example: { type: "string", description: "initialize from an example project" },
  },
  lint: {
    ...outputOptions,
    ...setOption,
    verbose: { type: "boolean", description: "include error stack traces" },
    entityType: {
      type: "string",
      choices: [
        "feature",
        "segment",
        "schema",
        "attribute",
        "target",
        "variable",
        "test",
        "scenario",
      ],
    },
    keyPattern: { type: "string", description: "filter entity keys by regular expression" },
    authors: { type: "boolean", description: "include entity authors" },
    v3MutationOrder: {
      type: "boolean",
      alias: "v3-mutation-order",
      description: "show values that change because v4 applies mutations in authored order",
    },
  },
  list: {
    executionProtocol: {
      type: "boolean",
      description: "emit the versioned test execution document",
      hidden: true,
    },
    executionMetadata: {
      type: "boolean",
      description: "include test source and case identities",
      hidden: true,
    },
    case: { type: "string", description: "select an exact expanded test case", hidden: true },
    ...outputOptions,
    ...setOption,
    datafiles: { type: "boolean", description: "list built datafiles and their sizes" },
    features: { type: "boolean", description: "list features" },
    segments: { type: "boolean", description: "list segments" },
    schemas: { type: "boolean", description: "list reusable schemas" },
    attributes: { type: "boolean", description: "list context attributes" },
    targets: { type: "boolean", description: "list build targets" },
    variables: { type: "boolean", description: "list global variables" },
    tests: { type: "boolean", description: "list test specifications" },
    scenarios: { type: "boolean", description: "list authored scenario definitions" },
    target: { type: "array", description: "filter features or variables by one or more targets" },
    entityType: { type: "string", choices: ["feature", "segment", "variable", "scenario"] },
    applyMatrix: { type: "boolean", description: "expand test assertion matrices" },
    assertionPattern: { type: "string", description: "filter assertion descriptions" },
    keyPattern: { type: "string", description: "filter keys by regular expression" },
    description: { type: "string", description: "filter descriptions by regular expression" },
    archived: { type: "boolean", description: "filter by archived status" },
    promotable: { type: "boolean", description: "filter by promotable status" },
    disabledIn: { type: "string", description: "filter features disabled in an environment" },
    enabledIn: { type: "string", description: "filter features enabled in an environment" },
    disabled: { type: "boolean", description: "filter disabled features, without environments" },
    enabled: { type: "boolean", description: "filter enabled features, without environments" },
    tag: { type: "array", description: "filter features or variables by one or more tags" },
    variable: { type: "array", description: "filter features by variable keys" },
    variation: { type: "array", description: "filter features by variation values" },
    withTests: { type: "boolean" },
    withoutTests: { type: "boolean" },
    withVariables: { type: "boolean" },
    withoutVariables: { type: "boolean" },
    withVariations: { type: "boolean" },
    withoutVariations: { type: "boolean" },
  },
  promote: {
    from: { type: "string", description: "source project set" },
    to: { type: "string", description: "destination project set" },
    target: { type: "array", description: "include definitions needed by targets" },
    tag: { type: "array", description: "include features with tags" },
    includeFeatures: { type: "array", description: "include matching feature keys" },
    excludeFeatures: { type: "array", description: "exclude matching feature keys" },
    conflicts: { type: "string", choices: ["source", "destination", "fail"] },
    allowEmpty: { type: "boolean" },
    apply: { type: "boolean" },
    audit: { type: "string" },
    showUnchanged: { type: "boolean" },
  },
  test: {
    ...outputOptions,
    case: { type: "string", description: "rerun an exact expanded test case" },
    coverage: { type: "boolean", description: "report observed rule and override selections" },
    uncovered: { type: "boolean", description: "list definitions without associated specs" },
    ...setOption,
    ...targetOption,
    keyPattern: { type: "string", description: "filter test keys by regular expression" },
    assertionPattern: { type: "string", description: "filter assertions by regular expression" },
    entityType: { type: "string", choices: ["feature", "segment", "variable", "scenario"] },
    onlyFailures: { type: "boolean" },
    quiet: { type: "boolean", description: "suppress SDK warnings" },
    showDatafile: { type: "boolean" },
    verbose: { type: "boolean" },
    inflate: {
      type: "number",
      description: "multiply definitions by this factor using synthetic copies for measurement",
    },
  },
};

export function getBuiltinCLIOptions(command: string): CLIOptionDefinitions | undefined {
  const commandOptions = definitions[command.split(" ")[0]];

  if (!commandOptions) {
    return undefined;
  }

  return {
    ...commandOptions,
    ...legacyOptions,
  };
}
