import * as React from "react";

import { Separator } from "../ui/separator";

export function SettingsPageProfile() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Profile</h3>
        <p className="text-sm text-muted-foreground">
          This information will be used in your Git commits.
        </p>
      </div>

      <Separator />

      <p>...</p>
    </div>
  );
}
