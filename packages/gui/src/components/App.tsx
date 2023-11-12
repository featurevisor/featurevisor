import * as React from "react";
import { Routes, Route } from "react-router-dom";

import { Loading } from "./blocks/loading";
import { Header } from "./blocks/header";

import { DashboardPage } from "./routes/dashboard-page";
import { ProfilePage } from "./routes/profile-page";

const { useState, useEffect } = React;

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
    <div>
      <Header user={user} />

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
