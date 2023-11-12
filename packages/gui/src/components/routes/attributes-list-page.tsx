import * as React from "react";

import { Separator } from "../ui/separator";

export function AttributesListPage() {
  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Attributes</h2>

        <p className="text-muted-foreground">List of all attributes in the project.</p>
      </div>

      <Separator className="my-6" />

      <div className="">
        <p>Children here...</p>
      </div>
    </>
  );
}
