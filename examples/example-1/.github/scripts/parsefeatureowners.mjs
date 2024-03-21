const parseFeatureOwners = (content) => {
  const lines = content.split("\n");
  const mappings = {
    "*": [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") {
      // Ignore comments and empty lines
      continue;
    } else if (trimmed.startsWith("*")) {
      // Global owner
      const usernames = trimmed
        .slice(1)
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);
      mappings["*"] = usernames;
    } else {
      // Feature-owner mapping
      const parts = trimmed.split(" ");

      if (!parts.length) {
        throw new Error(`Invalid FEATUREOWNERS line: ${line}`);
      }
      const feature = parts.shift();

      if (parts.length > 0) {
        let environment = null;
        if (["staging", "production"].includes(parts[0])) {
          environment = parts.shift();
        }
        let usernames = parts;
        if (usernames.length > 0) {
          if (environment) {
            mappings[feature][environment] = usernames;
          } else {
            mappings[feature] = {
              "*": usernames,
            };
          }
        }
      }
    }
  }

  return mappings;
};

export { parseFeatureOwners };
