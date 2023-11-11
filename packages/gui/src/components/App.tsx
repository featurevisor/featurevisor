import * as React from "react";
import { Link } from "react-router-dom";

import { Separator } from "./ui/separator";

import { MainNav } from "./blocks/main-nav";
import { UserNav } from "./blocks/user-nav";
import { SidebarNav } from "./blocks/sidebar-nav";

const sidebarNavItems = [
  {
    title: "Primary",
    href: "/",
  },
  {
    title: "Secondary",
    href: "/secondary",
  },
];

export function App() {
  return (
    <div className="">
      <div className="border-b">
        <div className="max-w-5xl mx-auto">
          <div className="flex h-16 items-center px-4">
            <Link to="/">
              <img src="/favicon-128.png" alt="Featurevisor" className="h-8" />
            </Link>

            <MainNav className="mx-6" />

            <div className="ml-auto flex items-center space-x-4">
              <UserNav />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto">
        <div className="space-y-6 px-4 py-10 pb-16">
          <div className="space-y-0.5">
            <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>

            <p className="text-muted-foreground">
              Some line of text here to describe what is going on in this page.
            </p>
          </div>

          <Separator className="my-6" />

          <div className="flex flex-row space-x-12 space-y-0">
            <aside className="w-1/4">
              <SidebarNav items={sidebarNavItems} />
            </aside>

            <div className="flex-1 lg:max-w-2xl">
              <p>Children here...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
