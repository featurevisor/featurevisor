import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { SchemaChoices, SchemaFields, SchemaValue } from "./schemaFields";
import { SchemaTable } from "./variables";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

/** The text of an element, with tags and runs of space collapsed, as a person reads it. */
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
    bio: { type: "string", maxLength: 500, annotations: { title: "About you", input: "textarea" } },
    displayName: {
      type: "string",
      minLength: 2,
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
      properties: { street: { type: "string" }, city: { type: "string", minLength: 1 } },
      required: ["city"],
    },
    plan: { schema: "plan", annotations: { title: "Plan" } },
    members: {
      type: "array",
      maxItems: 10,
      items: { type: "object", properties: { email: { type: "string", format: "date-time" } } },
    },
    nickname: { oneOf: [{ type: "string", maxLength: 20 }, { const: null }] },
  },
  required: ["displayName", "country"],
  annotations: { title: "Your profile", submitLabel: "Save", order: ["displayName", "country"] },
};

describe("a schema's structure on its Overview", () => {
  test("each field reads its name, type and title, then its rules in words and its other annotations", () => {
    const fields = text(render(<SchemaFields schema={profileForm} />));

    expect(fields).toContain(
      "displayName required string Display name 2 to 40 characters placeholder Ada Lovelace examples Ada, Grace",
    );
    expect(fields).toContain("bio string About you up to 500 characters input textarea");
    expect(fields).not.toContain("—");
  });

  test("choices show their titles and what they carry, and fields follow the form's order", () => {
    const fields = text(render(<SchemaFields schema={profileForm} />));

    expect(fields).toContain(
      "country required string Country GB United Kingdom flag gb BE Belgium hidden",
    );
    // `order` lists displayName and country first, then the rest come as written.
    expect(fields.indexOf("displayName required")).toBeLessThan(fields.indexOf("country required"));
    expect(fields.indexOf("country required")).toBeLessThan(fields.indexOf("bio string"));
  });

  test("the root's annotations head the card, its title first", () => {
    const fields = text(render(<SchemaFields schema={profileForm} />));

    expect(
      fields.startsWith(
        "Your profile submitLabel Save Fields in the order its order annotation lists.",
      ),
    ).toBe(true);
  });

  test("nested objects and the items of a list show their fields inside, by their own names", () => {
    const fields = text(render(<SchemaFields schema={profileForm} />));

    // The address's own order puts city first.
    expect(fields).toContain(
      "address object Billing address city required string at least 1 character street string",
    );
    expect(fields).toContain("members object[] up to 10 items Each item email string a timestamp");
    expect(fields).not.toContain("address.city");
    // A reference links to its schema, and a nullable field says so.
    expect(fields).toContain("plan plan Plan");
    expect(fields).toContain("nickname string or null up to 20 characters");
  });

  test("a schema that is one value shows its type and rules, and a oneOf each branch", () => {
    expect(text(render(<SchemaValue schema={{ type: "string", pattern: "^[A-Z]{8}$" }} />))).toBe(
      "string matches ^[A-Z]{8}$",
    );
    expect(
      text(
        render(
          <SchemaValue schema={{ oneOf: [{ type: "string" }, { type: "integer", minimum: 1 }] }} />,
        ),
      ),
    ).toBe("one of string integer at least 1");
    expect(text(render(<SchemaValue schema={{ type: "string", enum: ["light", "dark"] }} />))).toBe(
      "string light dark",
    );
  });

  test("a schema that is a list of choices shows one row each", () => {
    const plan = {
      oneOf: [
        { const: "free", annotations: { title: "Free", price: 0 } },
        { const: "pro", annotations: { title: "Pro", price: 12, tone: "blue" } },
      ],
    };

    expect(text(render(<SchemaChoices schema={plan} />))).toBe(
      "free Free price 0 pro Pro price 12 tone blue",
    );
  });

  test("a variable's table keeps its four columns", () => {
    const html = render(
      <SchemaTable schema={{ type: "object", properties: { name: { type: "string" } } }} />,
    );

    expect(text(html)).toContain("Path Type Constraints Description");
    expect(html).not.toContain("Annotations");
  });
});
