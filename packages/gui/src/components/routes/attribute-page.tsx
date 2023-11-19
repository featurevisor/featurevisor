import * as React from "react";
import { Outlet, useParams } from "react-router-dom";

import { Separator } from "../ui/separator";
import { SidebarNav } from "../blocks/sidebar-nav";

export function AttributePage() {
  const { key } = useParams();

  const sidebarNavItems = [
    {
      href: `/attributes/${key}`,
      title: "Overview",
    },
    {
      href: `/attributes/${key}/history`,
      title: "History",
    },
  ];

  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Attribute: {key}</h2>

        <p className="text-muted-foreground">Manage your attribute information.</p>
      </div>

      <Separator className="my-6" />

      <div className="flex flex-row space-x-12 space-y-0">
        <aside className="w-1/4">
          <SidebarNav items={sidebarNavItems} />
        </aside>

        <div className="flex-1 lg:max-w-2xl">
          <Outlet />
        </div>
      </div>
    </>
  );
}
