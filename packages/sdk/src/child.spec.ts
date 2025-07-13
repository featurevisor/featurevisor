import { createInstance } from "./instance";

describe("sdk: child", function () {
  it("should create a child instance", function () {
    const f = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            variablesSchema: {
              color: {
                key: "color",
                type: "string",
                defaultValue: "red",
              },
              showSidebar: {
                key: "showSidebar",
                type: "boolean",
                defaultValue: false,
              },
              sidebarTitle: {
                key: "sidebarTitle",
                type: "string",
                defaultValue: "sidebar title",
              },
              count: {
                key: "count",
                type: "integer",
                defaultValue: 0,
              },
              price: {
                key: "price",
                type: "double",
                defaultValue: 9.99,
              },
              paymentMethods: {
                key: "paymentMethods",
                type: "array",
                defaultValue: ["paypal", "creditcard"],
              },
              flatConfig: {
                key: "flatConfig",
                type: "object",
                defaultValue: {
                  key: "value",
                },
              },
              nestedConfig: {
                key: "nestedConfig",
                type: "json",
                defaultValue: JSON.stringify({
                  key: {
                    nested: "value",
                  },
                }),
              },
            },
            variations: [
              { value: "control" },
              {
                value: "treatment",
                variables: {
                  showSidebar: true,
                  sidebarTitle: "sidebar title from variation",
                },
                variableOverrides: {
                  showSidebar: [
                    {
                      segments: ["netherlands"],
                      value: false,
                    },
                    {
                      conditions: [
                        {
                          attribute: "country",
                          operator: "equals",
                          value: "de",
                        },
                      ],
                      value: false,
                    },
                  ],
                  sidebarTitle: [
                    {
                      segments: ["netherlands"],
                      value: "Dutch title",
                    },
                    {
                      conditions: [
                        {
                          attribute: "country",
                          operator: "equals",
                          value: "de",
                        },
                      ],
                      value: "German title",
                    },
                  ],
                },
              },
            ],
            force: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "user-ch" }],
                enabled: true,
                variation: "control",
                variables: {
                  color: "red and white",
                },
              },
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "user-gb" }],
                enabled: false,
              },
              {
                conditions: [
                  { attribute: "userId", operator: "equals", value: "user-forced-variation" },
                ],
                enabled: true,
                variation: "treatment",
              },
            ],
            traffic: [
              // belgium
              {
                key: "2",
                segments: ["belgium"],
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 0] },
                  {
                    variation: "treatment",
                    range: [0, 100000],
                  },
                ],
                variation: "control",
                variables: {
                  color: "black",
                },
              },

              // everyone
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 0] },
                  {
                    variation: "treatment",
                    range: [0, 100000],
                  },
                ],
              },
            ],
          },
          anotherTest: {
            key: "test",
            bucketBy: "userId",
            traffic: [
              // everyone
              {
                key: "1",
                segments: "*",
                percentage: 100000,
              },
            ],
          },
        },
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "nl",
              },
            ]),
          },
          belgium: {
            key: "belgium",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "be",
              },
            ]),
          },
        },
      },
      context: {
        appVersion: "1.0.0",
      },
    });

    expect(f).toBeDefined();
    expect(f.getContext()).toEqual({ appVersion: "1.0.0" });

    const childF = f.spawn({
      userId: "123",
      country: "nl",
    });

    expect(childF).toBeDefined();
    expect(childF.getContext()).toEqual({ appVersion: "1.0.0", userId: "123", country: "nl" });

    let contextUpdated = false;
    const unsubscribeContext = childF.on("context_set", () => {
      contextUpdated = true;
    });

    childF.setContext({ country: "be" });
    expect(childF.getContext()).toEqual({ appVersion: "1.0.0", userId: "123", country: "be" });

    expect(childF.isEnabled("test")).toBe(true);
    expect(childF.getVariation("test")).toEqual("control");

    expect(childF.getVariable("test", "color")).toEqual("black");
    expect(childF.getVariableString("test", "color")).toEqual("black");

    expect(childF.getVariable("test", "showSidebar")).toEqual(false);
    expect(childF.getVariableBoolean("test", "showSidebar")).toEqual(false);

    expect(childF.getVariable("test", "sidebarTitle")).toEqual("sidebar title");
    expect(childF.getVariableString("test", "sidebarTitle")).toEqual("sidebar title");

    expect(childF.getVariable("test", "count")).toEqual(0);
    expect(childF.getVariableInteger("test", "count")).toEqual(0);

    expect(childF.getVariable("test", "price")).toEqual(9.99);
    expect(childF.getVariableDouble("test", "price")).toEqual(9.99);

    expect(childF.getVariable("test", "paymentMethods")).toEqual(["paypal", "creditcard"]);
    expect(childF.getVariableArray("test", "paymentMethods")).toEqual(["paypal", "creditcard"]);

    expect(childF.getVariable("test", "flatConfig")).toEqual({ key: "value" });
    expect(childF.getVariableObject("test", "flatConfig")).toEqual({ key: "value" });

    expect(childF.getVariable("test", "nestedConfig")).toEqual({
      key: { nested: "value" },
    });
    expect(childF.getVariableJSON("test", "nestedConfig")).toEqual({
      key: { nested: "value" },
    });

    expect(contextUpdated).toBe(true);
    unsubscribeContext();

    expect(childF.isEnabled("newFeature")).toEqual(false);
    childF.setSticky({
      newFeature: {
        enabled: true,
      },
    });
    expect(childF.isEnabled("newFeature")).toEqual(true);

    const allEvaluations = childF.getAllEvaluations();
    expect(Object.keys(allEvaluations)).toEqual(["test", "anotherTest"]);

    childF.close();
  });
});
