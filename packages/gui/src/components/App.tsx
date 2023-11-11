import * as React from "react";

import { MainNav } from "./blocks/main-nav";
import { UserNav } from "./blocks/user-nav";

export function App() {
  return (
    <div>
      <div className="border-b">
        <div className="flex h-16 items-center px-4">
          <MainNav className="mx-6" />
          <div className="ml-auto flex items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>
    </div>
  );
}
