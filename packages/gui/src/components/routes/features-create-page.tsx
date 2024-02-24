import * as React from "react";

import { H2 } from "../ui/typography";
import { Separator } from "../ui/separator";

import { FeatureForm } from "./feature-page-edit";

export function FeaturesCreate() {
  return (
    <>
      <div className="space-y-0.5 relative">
        <H2 className="border-none">Create feature</H2>

        <p className="text-muted-foreground">Use the form to create a new feature</p>
      </div>

      <Separator className="my-6" />

      <FeatureForm />
    </>
  );
}
