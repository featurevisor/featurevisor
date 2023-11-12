import * as React from "react";
import { Link, Routes, Route } from "react-router-dom";

import { MainNav } from "./blocks/main-nav";
import { UserNav } from "./blocks/user-nav";

import { DashboardPage } from "./routes/dashboard-page";
import { ProfilePage } from "./routes/profile-page";

const { useState, useEffect } = React;

function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <img
        src="/favicon-128.png"
        alt="Featurevisor"
        className="h-16 transform transition-transform duration-500 animate-pulse"
      />
    </div>
  );
}

export function App() {
  const [user, setUser] = useState(null);

  // fetch user
  useEffect(() => {
    fetch("/api/user")
      .then((res) => res.json())
      .then((data) => setUser(data.data));
  }, []);

  if (!user) {
    return <Loading />;
  }

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
              <UserNav user={user} />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto">
        <div className="space-y-6 px-4 py-10 pb-16">
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Routes>

          {/* <div className="space-y-0.5">
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
          </div> */}
        </div>
      </div>
    </div>
  );
}
