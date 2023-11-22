import * as React from "react";

import { Separator } from "../ui/separator";
import { H2 } from "../ui/typography";

export function DashboardPage() {
  return (
    <>
      <div className="space-y-0.5">
        <H2 className="border-none">Dashboard</H2>

        <p className="text-muted-foreground">
          Some line of text here to describe what is going on in this page.
        </p>
      </div>

      <Separator className="my-6" />

      <div className="">
        <p>Children here...</p>
      </div>
    </>
  );
}
