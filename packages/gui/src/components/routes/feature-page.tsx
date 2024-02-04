import * as React from "react";
import { Outlet, useParams } from "react-router-dom";

import { Separator } from "../ui/separator";
import { H2, InlineCode } from "../ui/typography";

import { SidebarNav } from "../blocks/sidebar-nav";

export function FeaturePage() {
  const { key } = useParams();

  const sidebarNavItems = [
    {
      href: `/features/${key}`,
      title: "Overview",
    },
    {
      href: `/features/${key}/history`,
      title: "History",
    },
  ];

  return (
    <>
      <div className="space-y-0.5">
        <H2 className="border-none">
          Feature: <InlineCode>{key}</InlineCode>
        </H2>

        <p className="text-muted-foreground">Manage your feature information.</p>
      </div>

      <Separator className="my-6" />

      <div className="flex flex-row space-x-12 space-y-0">
        <aside className="w-1/6">
          <SidebarNav items={sidebarNavItems} />
        </aside>

        <div className="flex-1 lg:max-w-2xl">
          <Outlet />
        </div>
      </div>
    </>
  );
}
