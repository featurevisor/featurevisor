import * as React from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { Separator } from "../ui/separator";
import { SidebarNav } from "../blocks/sidebar-nav";

const { useEffect } = React;

const sidebarNavItems = [
  {
    href: "/settings",
    title: "Profile",
  },
];

export function SettingsPage() {
  const navigate = useNavigate();

  // keep it as long as there's only one route under /settings
  useEffect(() => {
    navigate("profile");
  }, [navigate]);

  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>

        <p className="text-muted-foreground">Update your profile and contact information.</p>
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
