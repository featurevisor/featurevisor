const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const vue = require("vue");
const { createFeaturevisor } = require("@featurevisor/sdk");
const {
  setupApp,
  FeaturevisorScope,
  provideFeaturevisorScope,
  useFlag,
  useVariable,
} = require("@featurevisor/vue");

const { createRenderer, defineComponent, h, nextTick, reactive, ref } = vue;

assert.equal(vue.version, "3.0.0");
assert.equal(createRequire(require.resolve("@featurevisor/vue"))("vue"), vue);

// A renderer into plain objects, so the oldest supported Vue runs without a DOM.
function node(tag, text = "") {
  return { tag, text, children: [], parent: null };
}
function detach(child) {
  if (!child.parent) return;
  child.parent.children.splice(child.parent.children.indexOf(child), 1);
  child.parent = null;
}
const { createApp } = createRenderer({
  createElement: (tag) => node(tag),
  createText: (text) => node("#text", text),
  createComment: (text) => node("#comment", text),
  setText: (target, text) => {
    target.text = text;
  },
  setElementText: (target, text) => {
    target.children.forEach((child) => (child.parent = null));
    target.children = [];
    target.text = text;
  },
  insert: (child, parent, anchor) => {
    detach(child);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index > -1) parent.children.splice(index, 0, child);
    else parent.children.push(child);
    child.parent = parent;
  },
  remove: detach,
  parentNode: (target) => target.parent,
  nextSibling: (target) => {
    const siblings = target.parent ? target.parent.children : [];
    return siblings[siblings.indexOf(target) + 1] || null;
  },
  patchProp: () => {},
});
function text(target) {
  if (target.tag === "#comment") return "";
  return target.text + target.children.map(text).join("");
}

// productReviews is on for product 1 only, and sizeGuide for shoes.
const datafile = {
  schemaVersion: "4",
  revision: "minimum",
  segments: {},
  features: {
    productReviews: {
      hash: "productReviews",
      bucketBy: "userId",
      traffic: [
        {
          key: "pilot",
          conditions: [{ attribute: "productId", operator: "in", value: ["1"] }],
          percentage: 100000,
        },
        { key: "everyone", conditions: "*", percentage: 0 },
      ],
    },
    sizeGuide: {
      hash: "sizeGuide",
      bucketBy: "userId",
      variablesSchema: { label: { type: "string", defaultValue: "Size guide" } },
      traffic: [
        {
          key: "shoes",
          conditions: [{ attribute: "category", operator: "equals", value: "shoes" }],
          percentage: 100000,
          variableOverrides: {
            label: [
              {
                conditions: [{ attribute: "productId", operator: "equals", value: "2" }],
                value: "Sizes for 2",
              },
            ],
          },
        },
        { key: "everyone", conditions: "*", percentage: 0 },
      ],
    },
  },
};

const evaluations = { productReviews: 0, sizeGuide: 0 };
const sdk = createFeaturevisor({
  logLevel: "fatal",
  datafile,
  context: { userId: "user-4", country: "nl" },
  modules: [
    {
      afterEvaluation(evaluation) {
        if (evaluation.type === "flag") evaluations[evaluation.featureKey]++;
        return evaluation;
      },
    },
  ],
});

const ProductCard = defineComponent({
  setup() {
    const productReviews = useFlag("productReviews");
    const sizeGuide = useFlag("sizeGuide");
    const label = useVariable("sizeGuide", "label");
    return () => h("li", `reviews:${productReviews.value} size:${sizeGuide.value} ${label.value}`);
  },
});

// The category page provides its category, and each card's scope comes from an inline object.
const page = reactive({ renders: 0, productIds: ["1", "2"] });
const category = ref("shoes");
const CategoryPage = defineComponent({
  setup() {
    provideFeaturevisorScope(() => ({ category: category.value }));
    return () =>
      h(
        "ul",
        { renders: page.renders },
        page.productIds.map((productId) =>
          h(FeaturevisorScope, { key: productId, context: { productId } }, () => h(ProductCard)),
        ),
      );
  },
});

async function main() {
  const root = node("root");
  const app = createApp(CategoryPage);
  setupApp(app, sdk);
  app.mount(root);

  // Each scope renders a fragment, whose empty text anchors sit between the cards.
  const cards = () => root.children[0].children.filter((child) => child.tag === "li").map(text);
  const counted = () => ({ ...evaluations });
  const shown = ["reviews:true size:true Size guide", "reviews:false size:true Sizes for 2"];
  assert.deepEqual(cards(), shown);

  // An equal inline context evaluates nothing again.
  const before = counted();
  page.renders++;
  await nextTick();
  assert.deepEqual(cards(), shown);
  assert.deepEqual(counted(), before);

  // A changed scope updates the cards, and the outer scope reaches the inner ones.
  page.productIds = ["2", "1"];
  await nextTick();
  assert.deepEqual(cards(), [shown[1], shown[0]]);
  category.value = "bags";
  await nextTick();
  assert.deepEqual(cards(), ["reviews:false size:false null", "reviews:true size:false null"]);
  category.value = "shoes";
  await nextTick();

  // A scope keeps its keys over setContext, and a sticky value wins over the merged context.
  sdk.setContext({ productId: "2", category: "bags" });
  await nextTick();
  assert.deepEqual(cards(), [shown[1], shown[0]]);
  sdk.setStickyFeatures({ productReviews: { enabled: false } });
  await nextTick();
  assert.deepEqual(cards(), [
    "reviews:false size:true Sizes for 2",
    "reviews:false size:true Size guide",
  ]);

  app.unmount();
  console.log(`FeaturevisorScope behaves on Vue ${vue.version}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
