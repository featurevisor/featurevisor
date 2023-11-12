import * as React from "react";
import { Routes, Route } from "react-router-dom";

import { Toaster } from "../ui/toaster";

import { Loading } from "../blocks/loading";
import { Header } from "../blocks/header";

import { DashboardPage } from "./dashboard-page";
import { SettingsPage } from "./settings-page";
import { SettingsPageProfile } from "./settings-page-profile";
import { AttributesListPage } from "./attributes-list-page";

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

      <div className="max-w-4xl mx-auto">
        <div className="space-y-6 px-4 py-10 pb-16">
          <Routes>
            {/* Dashboard */}
            <Route index element={<DashboardPage />} />

            {/* Settings */}
            <Route path="settings" element={<SettingsPage />}>
              <Route path="profile" element={<SettingsPageProfile />} />
            </Route>

            {/* Attributes */}
            <Route path="attributes">
              <Route index element={<AttributesListPage />} />
            </Route>
          </Routes>
        </div>
      </div>

      <Toaster />
    </div>
  );
}
