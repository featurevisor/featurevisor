import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { generateSchemaExample } from "./insights";
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

  test("messages show by issue code, the outermost wording winning, as validation chooses", () => {
    const fields = text(
      render(
        <SchemaFields
          schema={{
            type: "object",
            properties: {
              email: {
                type: "string",
                messages: { pattern: "Inner wording", required: "Own wording" },
              },
              address: {
                type: "object",
                properties: { city: { type: "string" } },
              },
              members: {
                type: "array",
                items: { type: "object", properties: { email: { type: "string" } } },
              },
            },
            messages: {
              additionalProperties: "{key} is not part of a sign up",
              email: { pattern: "Outer wording" },
              address: { city: { required: "Which city?" } },
              members: { "[]": { email: { pattern: "Each member's email" } } },
            },
          }}
        />,
      ),
    );

    expect(fields).toContain("When it fails additionalProperties {key} is not part of a sign up");
    expect(fields).toContain(
      "email string When it fails pattern Outer wording required Own wording",
    );
    expect(fields).toContain("city string When it fails required Which city?");
    expect(fields).toContain("email string When it fails pattern Each member's email");
  });

  test("mutations and issues link from the fields they change or report on to the Rules tab", () => {
    const html = render(
      <SchemaFields
        schema={{
          type: "object",
          properties: {
            taxId: { type: "string" },
            password: { type: "string" },
            confirmPassword: { type: "string" },
            members: {
              type: "array",
              items: {
                type: "object",
                properties: { role: { type: "string" }, email: { type: "string" } },
                required: ["role"],
                mutations: [
                  {
                    key: "adminEmail",
                    conditions: "*",
                    mutate: { "required:appendUnique": "email" },
                  },
                ],
              },
            },
          },
          mutations: {
            staging: [
              {
                key: "business",
                conditions: { input: "accountType", operator: "equals", value: "business" },
                mutate: {
                  "required:appendUnique": "taxId",
                  "properties.nickname": { type: "string" },
                },
                mutations: [
                  {
                    key: "germanBusiness",
                    conditions: "*",
                    mutate: { "properties.taxId.pattern": "^DE" },
                  },
                ],
              },
            ],
            production: [
              {
                key: "business",
                conditions: "*",
                mutate: { "required:appendUnique": "taxId" },
              },
            ],
          },
          issues: [
            {
              key: "group",
              conditions: "*",
              issues: [
                {
                  key: "passwordsDiffer",
                  conditions: "*",
                  path: "confirmPassword",
                  message: "The passwords do not match",
                },
              ],
            },
          ],
        }}
      />,
    );
    const fields = text(html);

    expect(fields).toContain("taxId string Changes under business germanBusiness");
    expect(fields).toContain("confirmPassword string Checked by passwordsDiffer");
    // A nested node's own mutation reaches the row inside it.
    expect(fields).toContain("email string Changes under adminEmail");
    // A field a mutation adds has no row, so the header names it.
    expect(fields).toContain("Adds nickname under business");
    expect(fields).not.toContain("Checked by group");
    // Each link opens the card on the Rules tab, in the first environment that lists it.
    expect(html).toContain('href="/rules/staging#mutation-business"');
    expect(html).toContain('href="/rules/staging#mutation-germanbusiness"');
    expect(html).toContain('href="/rules#mutation-members-adminemail"');
    expect(html).toContain('href="/rules#issue-passwordsdiffer"');
    expect(html).toContain('title="Mutation business in staging, production, on the Rules tab"');
  });

  test("the header names the vocabularies the annotations and choices follow", () => {
    const html = render(
      <SchemaFields
        schema={{
          type: "object",
          annotationsSchema: { schema: "formAnnotations" },
          optionSchema: { type: "object", properties: { flag: { type: "string" } } },
          properties: { name: { type: "string" } },
        }}
      />,
    );

    expect(text(html)).toContain(
      "Annotations follow formAnnotations Choices follow an inline vocabulary",
    );
    expect(html).toContain('href="/schemas/formAnnotations"');
  });

  test("a oneOf field lists its branches, and a flat object says what it holds", () => {
    const fields = text(
      render(
        <SchemaFields
          schema={{
            type: "object",
            properties: {
              reference: {
                oneOf: [
                  { type: "string", maxLength: 8 },
                  { type: "integer", minimum: 1 },
                ],
              },
              labels: { type: "object" },
            },
          }}
        />,
      ),
    );

    expect(fields).toContain("reference one of string up to 8 characters integer at least 1");
    expect(fields).toContain("labels object any keys, holding text, numbers, booleans or null");
  });

  test("the example value takes a field's own examples first", () => {
    expect(
      generateSchemaExample(
        {
          type: "object",
          properties: {
            name: { type: "string", annotations: { examples: ["Ada", "Grace"] } },
            email: { type: "string" },
          },
        },
        () => undefined,
      ),
    ).toEqual({ name: "Ada", email: "example" });
  });

  test("a variable's table keeps its four columns", () => {
    const html = render(
      <SchemaTable schema={{ type: "object", properties: { name: { type: "string" } } }} />,
    );

    expect(text(html)).toContain("Path Type Constraints Description");
    expect(html).not.toContain("Annotations");
  });
});
