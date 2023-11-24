import * as React from "react";

import { H2 } from "../ui/typography";
import { Separator } from "../ui/separator";

import { AttributeForm } from "./attribute-page-edit";

export function AttributesCreate() {
  return (
    <>
      <div className="space-y-0.5 relative">
        <H2 className="border-none">Create attribute</H2>

        <p className="text-muted-foreground">Use the form to create a new attribute</p>
      </div>

      <Separator className="my-6" />

      <AttributeForm />
    </>
  );
}
