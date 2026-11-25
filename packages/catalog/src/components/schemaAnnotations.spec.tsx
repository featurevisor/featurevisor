import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { SchemaAnnotationsOverview, SchemaPropertiesOverview, SchemaTable } from "./variables";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

/** The text of an element, with tags and runs of space collapsed, for reading a table as a person would. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const profileForm = {
  type: "object",
  properties: {
    displayName: {
      type: "string",
      maxLength: 40,
      annotations: {
        placeholder: "Ada Lovelace",
        title: "Display name",
        examples: ["Ada", "Grace"],
      },
    },
    country: {
      type: "string",
      enum: ["GB", "BE"],
      annotations: {
        title: "Country",
        options: {
          GB: { title: "United Kingdom", flag: "gb" },
          BE: { title: "Belgium", hidden: true },
        },
      },
    },
    address: {
      type: "object",
      annotations: { title: "Billing address", order: ["city", "street"] },
      properties: { street: { type: "string" }, city: { type: "string" } },
    },
    plan: { schema: "plan", annotations: { title: "Plan" } },
    tags: {
      type: "array",
      items: {
        type: "string",
        enum: ["new", "vip"],
        annotations: { options: { vip: { title: "VIP" } } },
      },
      annotations: { title: "Tags" },
    },
  },
  required: ["displayName", "country"],
  annotations: { title: "Your profile", submitLabel: "Save", order: ["displayName", "country"] },
};

describe("annotations on a schema's Overview", () => {
  test("the structure table gains an Annotations column, a field's title first", () => {
    const table = text(render(<SchemaTable schema={profileForm} />));

    expect(table).toContain("Path Type Constraints Annotations Description");
    expect(table).toContain(
      "displayName required string maxLength: 40 title Display name placeholder Ada Lovelace examples Ada, Grace",
    );
    // Choices list one a line, by value, with their title and what else they carry.
    expect(table).toContain(
      "title Country options GB United Kingdom · flag gb BE Belgium · hidden true",
    );
    // A referenced schema's use carries its own annotations.
    expect(table).toContain("plan plan — title Plan");
    // Choices on a list's items sit beside the list's own annotations.
    expect(table).toContain("title Tags options vip VIP");
  });

  test("a field holding an object gets a row of its own once it carries annotations", () => {
    const table = text(render(<SchemaTable schema={profileForm} />));

    expect(table).toContain("address object — title Billing address order city, street");
    expect(table).toContain("address.street string");
  });

  test("a schema without annotations, such as a variable's, keeps four columns", () => {
    const html = render(
      <SchemaTable
        schema={{ type: "object", properties: { name: { type: "string" } }, required: ["name"] }}
      />,
    );

    expect(text(html)).toContain("Path Type Constraints Description");
    expect(html).not.toContain("Annotations");
    expect(html).not.toContain("variable-schema-table-annotated");
  });

  test("the root's annotations get a section of their own, and a schema without any none", () => {
    const section = text(render(<SchemaAnnotationsOverview schema={profileForm} />));

    expect(section).toContain(
      "Annotations title Your profile submitLabel Save order displayName, country",
    );
    expect(render(<SchemaAnnotationsOverview schema={{ type: "string" }} />)).toBe("");
  });

  test("each choice of a oneOf of consts shows its annotations", () => {
    const plan = {
      oneOf: [
        { const: "free", annotations: { title: "Free", price: 0 } },
        { const: "pro", annotations: { title: "Pro", price: 12 } },
      ],
    };
    const options = text(render(<SchemaPropertiesOverview schema={plan} />));

    expect(options).toContain('Option 1 Const "free" Annotations title Free price 0');
    expect(options).toContain('Option 2 Const "pro" Annotations title Pro price 12');
  });
});
