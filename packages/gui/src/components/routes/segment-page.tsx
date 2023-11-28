import * as React from "react";
import { Outlet, useParams, useLocation } from "react-router-dom";

import { Separator } from "../ui/separator";
import { H2, InlineCode } from "../ui/typography";

import { SidebarNav } from "../blocks/sidebar-nav";

export function SegmentPage() {
  const { key } = useParams();
  const location = useLocation();

  const isEdit = location.pathname.endsWith("/edit");

  const sidebarNavItems = [
    {
      href: `/segments/${key}`,
      title: "Overview",
    },
    {
      href: `/segments/${key}/history`,
      title: "History",
    },
  ];

  return (
    <>
      <div className="space-y-0.5">
        <H2 className="border-none">
          Segment: <InlineCode>{key}</InlineCode>
        </H2>

        <p className="text-muted-foreground">Manage your segment information.</p>
      </div>

      <Separator className="my-6" />

      <div className="flex flex-row space-x-12 space-y-0">
        {!isEdit && (
          <aside className="w-1/6">
            <SidebarNav items={sidebarNavItems} />
          </aside>
        )}

        <div className="flex-1 lg:max-w-5xl">
          <Outlet />
        </div>
      </div>
    </>
  );
}
