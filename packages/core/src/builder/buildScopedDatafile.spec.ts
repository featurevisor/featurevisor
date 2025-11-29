import { DatafileContent } from "@featurevisor/types";
import { buildScopedDatafile } from "./buildScopedDatafile";

describe("core: buildScopedDatafile", function () {
  test("buildScopedDatafile is a function", function () {
    expect(buildScopedDatafile).toBeInstanceOf(Function);
  });

  // ============================================
  // BASIC CASES
  // ============================================

  test("simple context: single segment match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "1",
      revision: "5",
      segments: {
        android: {
          conditions: [{ attribute: "platform", operator: "equals", value: "android" }],
        },
        ios: {
          conditions: [{ attribute: "platform", operator: "equals", value: "ios" }],
        },
        web: {
          conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
        },
      },
      features: {
        showBanner: {
          bucketBy: "userId",
          traffic: [
            {
              key: "web",
              segments: "web",
              percentage: 100000,
              allocation: [],
            },
            {
              key: "ios",
              segments: "ios",
              percentage: 50000,
              allocation: [],
            },
            {
              key: "android",
              segments: "android",
              percentage: 25000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scopedDatafileContent = buildScopedDatafile(originalDatafileContent, { platform: "web" });

    expect(scopedDatafileContent).toEqual({
      schemaVersion: "1",
      revision: "5",
      segments: [],
      features: {
        showBanner: {
          bucketBy: "userId",
          traffic: [
            {
              key: "web",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    });
  });

  test("simple context: no matching segments", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium",
              segments: "premium",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scopedDatafileContent = buildScopedDatafile(originalDatafileContent, { tier: "free" });

    expect(scopedDatafileContent).toEqual({
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {},
    });
  });

  test("wildcard segments: always match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scopedDatafileContent = buildScopedDatafile(originalDatafileContent, { platform: "web" });

    expect(scopedDatafileContent).toEqual({
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    });
  });

  test("multiple traffic rules: partial match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
        uk: {
          conditions: [{ attribute: "country", operator: "equals", value: "uk" }],
        },
        ca: {
          conditions: [{ attribute: "country", operator: "equals", value: "ca" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "us",
              segments: "us",
              percentage: 100000,
              allocation: [],
            },
            {
              key: "uk",
              segments: "uk",
              percentage: 50000,
              allocation: [],
            },
            {
              key: "ca",
              segments: "ca",
              percentage: 25000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scopedDatafileContent = buildScopedDatafile(originalDatafileContent, { country: "uk" });

    expect(scopedDatafileContent).toEqual({
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "uk",
              segments: "*",
              percentage: 50000,
              allocation: [],
            },
          ],
        },
      },
    });
  });

  // ============================================
  // COMPLEX SEGMENT COMBINATIONS
  // ============================================

  test("AND segments: all must match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-us",
              segments: { and: ["premium", "us"] },
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // Both conditions match
    const scoped1 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
    });
    expect(scoped1.features.feature1.traffic.length).toBe(1);
    expect(scoped1.features.feature1.traffic[0].segments).toBe("*");

    // Only one condition matches
    const scoped2 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "uk",
    });
    expect(scoped2.features).toEqual({});
  });

  test("OR segments: at least one must match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        enterprise: {
          conditions: [{ attribute: "tier", operator: "equals", value: "enterprise" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-or-enterprise",
              segments: { or: ["premium", "enterprise"] },
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // First segment matches
    const scoped1 = buildScopedDatafile(originalDatafileContent, { tier: "premium" });
    expect(scoped1.features.feature1.traffic.length).toBe(1);
    expect(scoped1.features.feature1.traffic[0].segments).toBe("*");

    // Second segment matches
    const scoped2 = buildScopedDatafile(originalDatafileContent, { tier: "enterprise" });
    expect(scoped2.features.feature1.traffic.length).toBe(1);

    // Neither matches
    const scoped3 = buildScopedDatafile(originalDatafileContent, { tier: "free" });
    expect(scoped3.features).toEqual({});
  });

  test("NOT segments: segment must not match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        beta: {
          conditions: [{ attribute: "environment", operator: "equals", value: "beta" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "not-beta",
              segments: { not: ["beta"] },
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // Not beta - should match
    const scoped1 = buildScopedDatafile(originalDatafileContent, { environment: "production" });
    expect(scoped1.features.feature1.traffic.length).toBe(1);

    // Is beta - should not match
    const scoped2 = buildScopedDatafile(originalDatafileContent, { environment: "beta" });
    expect(scoped2.features).toEqual({});
  });

  test("nested AND/OR/NOT combinations", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        enterprise: {
          conditions: [{ attribute: "tier", operator: "equals", value: "enterprise" }],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
        beta: {
          conditions: [{ attribute: "environment", operator: "equals", value: "beta" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "complex",
              segments: {
                and: [{ or: ["premium", "enterprise"] }, "us", { not: ["beta"] }],
              },
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // Matches: premium OR enterprise, AND us, AND NOT beta
    const scoped1 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
      environment: "production",
    });
    expect(scoped1.features.feature1.traffic.length).toBe(1);

    // Fails: is beta
    const scoped2 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
      environment: "beta",
    });
    expect(scoped2.features).toEqual({});

    // Fails: wrong country
    const scoped3 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "uk",
      environment: "production",
    });
    expect(scoped3.features).toEqual({});
  });

  test("array of segments: implicit AND", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-us",
              segments: ["premium", "us"],
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // Both match
    const scoped1 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
    });
    expect(scoped1.features.feature1.traffic.length).toBe(1);

    // Only one matches
    const scoped2 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "uk",
    });
    expect(scoped2.features).toEqual({});
  });

  // ============================================
  // FORCE RULES
  // ============================================

  test("force rules: with conditions matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "admin123" }],
              variation: "enabled",
            },
          ],
        },
      },
    };

    const scoped1 = buildScopedDatafile(originalDatafileContent, { userId: "admin123" });
    expect(scoped1.features.feature1.force).toBeDefined();
    expect(scoped1.features.feature1.force!.length).toBe(1);
    expect(scoped1.features.feature1.force![0].conditions).toBe("*");

    const scoped2 = buildScopedDatafile(originalDatafileContent, { userId: "user456" });
    expect(scoped2.features.feature1).toBeUndefined();
  });

  test("force rules: with segments matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        admin: {
          conditions: [{ attribute: "role", operator: "equals", value: "admin" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              segments: "admin",
              variation: "enabled",
            },
          ],
        },
      },
    };

    const scoped1 = buildScopedDatafile(originalDatafileContent, { role: "admin" });
    expect(scoped1.features.feature1.force).toBeDefined();
    expect(scoped1.features.feature1.force!.length).toBe(1);
    expect(scoped1.features.feature1.force![0].segments).toBe("*");

    const scoped2 = buildScopedDatafile(originalDatafileContent, { role: "user" });
    expect(scoped2.features.feature1).toBeUndefined();
  });

  test("force rules: with both conditions and segments (OR logic)", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        admin: {
          conditions: [{ attribute: "role", operator: "equals", value: "admin" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "admin123" }],
              segments: "admin",
              variation: "enabled",
            },
          ],
        },
      },
    };

    // Matches via conditions
    const scoped1 = buildScopedDatafile(originalDatafileContent, { userId: "admin123" });
    expect(scoped1.features.feature1.force).toBeDefined();

    // Matches via segments
    const scoped2 = buildScopedDatafile(originalDatafileContent, { role: "admin" });
    expect(scoped2.features.feature1.force).toBeDefined();

    // Neither matches
    const scoped3 = buildScopedDatafile(originalDatafileContent, {
      userId: "user456",
      role: "user",
    });
    expect(scoped3.features.feature1).toBeUndefined();
  });

  test("force rules: multiple force rules, some matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        admin: {
          conditions: [{ attribute: "role", operator: "equals", value: "admin" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "admin123" }],
              variation: "enabled",
            },
            {
              segments: "admin",
              variation: "disabled",
            },
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "user999" }],
              variation: "enabled",
            },
          ],
        },
      },
    };

    // First force matches
    const scoped1 = buildScopedDatafile(originalDatafileContent, { userId: "admin123" });
    expect(scoped1.features.feature1.force!.length).toBe(1);
    expect(scoped1.features.feature1.force![0].variation).toBe("enabled");

    // Second force matches
    const scoped2 = buildScopedDatafile(originalDatafileContent, { role: "admin" });
    expect(scoped2.features.feature1.force!.length).toBe(1);
    expect(scoped2.features.feature1.force![0].variation).toBe("disabled");

    // Third force matches
    const scoped3 = buildScopedDatafile(originalDatafileContent, { userId: "user999" });
    expect(scoped3.features.feature1.force!.length).toBe(1);
  });

  // ============================================
  // VARIABLE OVERRIDES
  // ============================================

  test("variable overrides: with conditions matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
          variations: [
            {
              value: "control",
              variables: {
                message: "Hello",
              },
              variableOverrides: {
                message: [
                  {
                    conditions: [{ attribute: "country", operator: "equals", value: "us" }],
                    value: "Hello from US",
                  },
                  {
                    conditions: [{ attribute: "country", operator: "equals", value: "uk" }],
                    value: "Hello from UK",
                  },
                ],
              },
            },
          ],
        },
      },
    };

    const scoped1 = buildScopedDatafile(originalDatafileContent, { country: "us" });
    expect(scoped1.features.feature1.variations![0].variableOverrides).toBeDefined();
    expect(scoped1.features.feature1.variations![0].variableOverrides!.message.length).toBe(1);
    expect(scoped1.features.feature1.variations![0].variableOverrides!.message[0].value).toBe(
      "Hello from US",
    );
    expect(scoped1.features.feature1.variations![0].variableOverrides!.message[0].conditions).toBe(
      "*",
    );

    const scoped2 = buildScopedDatafile(originalDatafileContent, { country: "uk" });
    expect(scoped2.features.feature1.variations![0].variableOverrides!.message[0].value).toBe(
      "Hello from UK",
    );

    const scoped3 = buildScopedDatafile(originalDatafileContent, { country: "ca" });
    expect(scoped3.features.feature1.variations![0].variableOverrides).toBeUndefined();
  });

  test("variable overrides: with segments matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
          variations: [
            {
              value: "control",
              variables: {
                discount: 0,
              },
              variableOverrides: {
                discount: [
                  {
                    segments: "premium",
                    value: 20,
                  },
                ],
              },
            },
          ],
        },
      },
    };

    const scoped1 = buildScopedDatafile(originalDatafileContent, { tier: "premium" });
    expect(scoped1.features.feature1.variations![0].variableOverrides).toBeDefined();
    expect(scoped1.features.feature1.variations![0].variableOverrides!.discount[0].segments).toBe(
      "*",
    );

    const scoped2 = buildScopedDatafile(originalDatafileContent, { tier: "free" });
    expect(scoped2.features.feature1.variations![0].variableOverrides).toBeUndefined();
  });

  test("variable overrides: multiple overrides, some matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
          variations: [
            {
              value: "control",
              variables: {
                price: 100,
              },
              variableOverrides: {
                price: [
                  {
                    conditions: [{ attribute: "country", operator: "equals", value: "us" }],
                    value: 90,
                  },
                  {
                    segments: "premium",
                    value: 80,
                  },
                  {
                    conditions: [{ attribute: "country", operator: "equals", value: "uk" }],
                    value: 95,
                  },
                ],
              },
            },
          ],
        },
      },
    };

    // First override matches
    const scoped1 = buildScopedDatafile(originalDatafileContent, { country: "us" });
    expect(scoped1.features.feature1.variations![0].variableOverrides!.price.length).toBe(1);
    expect(scoped1.features.feature1.variations![0].variableOverrides!.price[0].value).toBe(90);

    // Second override matches
    const scoped2 = buildScopedDatafile(originalDatafileContent, { tier: "premium" });
    expect(scoped2.features.feature1.variations![0].variableOverrides!.price.length).toBe(1);
    expect(scoped2.features.feature1.variations![0].variableOverrides!.price[0].value).toBe(80);
  });

  // ============================================
  // EDGE CASES
  // ============================================

  test("empty datafile", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {},
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { platform: "web" });
    expect(scoped).toEqual({
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {},
    });
  });

  test("feature with no traffic and no force", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { platform: "web" });
    expect(scoped.features).toEqual({});
  });

  test("feature with only force, no traffic", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "admin" }],
              variation: "enabled",
            },
          ],
        },
      },
    };

    const scoped1 = buildScopedDatafile(originalDatafileContent, { userId: "admin" });
    expect(scoped1.features.feature1).toBeDefined();
    expect(scoped1.features.feature1.force).toBeDefined();

    const scoped2 = buildScopedDatafile(originalDatafileContent, { userId: "user" });
    expect(scoped2.features).toEqual({});
  });

  test("multiple features: some matching, some not", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        web: {
          conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
        },
        mobile: {
          conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "web",
              segments: "web",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
        feature2: {
          bucketBy: "userId",
          traffic: [
            {
              key: "mobile",
              segments: "mobile",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
        feature3: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { platform: "web" });
    expect(Object.keys(scoped.features).length).toBe(2);
    expect(scoped.features.feature1).toBeDefined();
    expect(scoped.features.feature3).toBeDefined();
    expect(scoped.features.feature2).toBeUndefined();
  });

  test("complex nested conditions in segments", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [
            {
              and: [
                { attribute: "tier", operator: "equals", value: "premium" },
                { attribute: "status", operator: "equals", value: "active" },
              ],
            },
          ],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-us",
              segments: { and: ["premium", "us"] },
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // All nested conditions match
    const scoped1 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      status: "active",
      country: "us",
    });
    expect(scoped1.features.feature1.traffic.length).toBe(1);

    // Nested condition fails
    const scoped2 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      status: "inactive",
      country: "us",
    });
    expect(scoped2.features).toEqual({});
  });

  test("schema version v2: segments as object", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        web: {
          conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "web",
              segments: "web",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { platform: "web" });
    expect(scoped.schemaVersion).toBe("2");
    expect(Array.isArray(scoped.segments)).toBe(false);
    expect(typeof scoped.segments).toBe("object");
    expect(Object.keys(scoped.segments).length).toBe(0);
  });

  test("missing context attributes: should not match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium",
              segments: "premium",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, {});
    expect(scoped.features).toEqual({});
  });

  test("multiple context attributes: complex matching", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
        web: {
          conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-us-web",
              segments: { and: ["premium", "us", "web"] },
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    // All match
    const scoped1 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
      platform: "web",
    });
    expect(scoped1.features.feature1.traffic.length).toBe(1);

    // Extra context attributes should not affect matching
    const scoped2 = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
      platform: "web",
      userId: "123",
      email: "test@example.com",
    });
    expect(scoped2.features.feature1.traffic.length).toBe(1);
  });

  test("stringified segments: should parse and match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
      },
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-us",
              segments: JSON.stringify({ and: ["premium", "us"] }),
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { tier: "premium", country: "us" });
    expect(scoped.features.feature1.traffic.length).toBe(1);
    expect(scoped.features.feature1.traffic[0].segments).toBe("*");
  });

  test("stringified conditions: should parse and match", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              conditions: JSON.stringify([
                { attribute: "userId", operator: "equals", value: "admin123" },
              ]),
              variation: "enabled",
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { userId: "admin123" });
    expect(scoped.features.feature1.force).toBeDefined();
    expect(scoped.features.feature1.force!.length).toBe(1);
  });

  test("variations without variableOverrides: should preserve", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
          variations: [
            {
              value: "control",
              variables: {
                message: "Hello",
              },
            },
            {
              value: "treatment",
              variables: {
                message: "Hi",
              },
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { platform: "web" });
    expect(scoped.features.feature1.variations).toBeDefined();
    expect(scoped.features.feature1.variations!.length).toBe(2);
    expect(scoped.features.feature1.variations![0].variableOverrides).toBeUndefined();
  });

  test("feature with empty traffic array and matching force", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {},
      features: {
        feature1: {
          bucketBy: "userId",
          traffic: [],
          force: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "admin" }],
              variation: "enabled",
            },
          ],
        },
      },
    };

    const scoped = buildScopedDatafile(originalDatafileContent, { userId: "admin" });
    expect(scoped.features.feature1).toBeDefined();
    expect(scoped.features.feature1.traffic.length).toBe(0);
    expect(scoped.features.feature1.force).toBeDefined();
  });

  test("complex real-world scenario: e-commerce feature", function () {
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        premium: {
          conditions: [{ attribute: "tier", operator: "equals", value: "premium" }],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
        mobile: {
          conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
        },
        beta: {
          conditions: [{ attribute: "environment", operator: "equals", value: "beta" }],
        },
      },
      features: {
        checkout: {
          bucketBy: "userId",
          traffic: [
            {
              key: "premium-us",
              segments: { and: ["premium", "us"] },
              percentage: 100000,
              allocation: [],
            },
            {
              key: "mobile",
              segments: "mobile",
              percentage: 50000,
              allocation: [],
            },
            {
              key: "all",
              segments: "*",
              percentage: 25000,
              allocation: [],
            },
          ],
          force: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "admin" }],
              variation: "enabled",
            },
            {
              segments: { not: ["beta"] },
              variation: "enabled",
            },
          ],
          variations: [
            {
              value: "control",
              variables: {
                discount: 0,
                message: "Welcome",
              },
              variableOverrides: {
                discount: [
                  {
                    segments: "premium",
                    value: 20,
                  },
                ],
                message: [
                  {
                    conditions: [{ attribute: "country", operator: "equals", value: "us" }],
                    value: "Welcome to US",
                  },
                ],
              },
            },
          ],
        },
      },
    };

    // Complex matching scenario
    const scoped = buildScopedDatafile(originalDatafileContent, {
      tier: "premium",
      country: "us",
      platform: "web",
      userId: "user123",
    });

    expect(scoped.features.checkout).toBeDefined();
    expect(scoped.features.checkout.traffic.length).toBe(2); // premium-us and all
    expect(scoped.features.checkout.force).toBeDefined();
    expect(scoped.features.checkout.force!.length).toBe(1); // not beta matches
    expect(scoped.features.checkout.variations![0].variableOverrides).toBeDefined();
    expect(scoped.features.checkout.variations![0].variableOverrides!.discount.length).toBe(1);
    expect(scoped.features.checkout.variations![0].variableOverrides!.message.length).toBe(1);
  });
});
