import * as React from "react";

import { Separator } from "../ui/separator";

export function DashboardPage() {
  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>

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
