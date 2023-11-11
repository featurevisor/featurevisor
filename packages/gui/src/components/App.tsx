import * as React from "react";

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
    title: "Seconday",
    href: "/secondary",
  },
];

export function App() {
  return (
    <>
      <div className="border-b">
        <div className="flex h-16 items-center px-4">
          <MainNav className="mx-6" />
          <div className="ml-auto flex items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>

      <div className="hidden space-y-6 p-10 pb-16 md:block">
        <div className="space-y-0.5">
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Some line of text here to describe what is going on in this page.
          </p>
        </div>
        <Separator className="my-6" />
        <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
          <aside className="-mx-4 lg:w-1/5">
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className="flex-1 lg:max-w-2xl">
            <p>Children here...</p>
          </div>
        </div>
      </div>
    </>
  );
}
