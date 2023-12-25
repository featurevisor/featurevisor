import * as React from "react";

import { H2 } from "../ui/typography";
import { Separator } from "../ui/separator";

import { SegmentForm } from "./segment-page-edit";

export function SegmentsCreate() {
  return (
    <>
      <div className="space-y-0.5 relative">
        <H2 className="border-none">Create segment</H2>

        <p className="text-muted-foreground">Use the form to create a new segment</p>
      </div>

      <Separator className="my-6" />

      <SegmentForm />
    </>
  );
}
