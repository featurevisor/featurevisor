import * as React from "react";

import { Separator } from "../ui/separator";

export function ProfilePage() {
  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Profile</h2>

        <p className="text-muted-foreground">Update your profile and contact information.</p>
      </div>

      <Separator className="my-6" />

      <div className="">
        <p>Children here...</p>
      </div>
    </>
  );
}
