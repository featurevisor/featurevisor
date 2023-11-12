import * as React from "react";
import { Link } from "react-router-dom";

import { MainNav } from "./main-nav";
import { UserNav } from "./user-nav";

export function Header({ user }) {
  return (
    <div className="border-b">
      <div className="max-w-4xl mx-auto">
        <div className="flex h-16 items-center px-4">
          <Link to="/">
            <img src="/favicon-128.png" alt="Featurevisor" className="h-8" />
          </Link>

          <MainNav className="mx-6" />

          <div className="ml-auto flex items-center space-x-4">
            <UserNav user={user} />
          </div>
        </div>
      </div>
    </div>
  );
}
