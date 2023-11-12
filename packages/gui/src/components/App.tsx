import * as React from "react";
import { Routes, Route } from "react-router-dom";

import { Loading } from "./blocks/loading";
import { Header } from "./blocks/header";

import { DashboardPage } from "./routes/dashboard-page";
import { SettingsPage } from "./routes/settings-page";
import { SettingsPageProfile } from "./routes/settings-page-profile";

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

            <Route path="settings" element={<SettingsPage />}>
              <Route path="profile" element={<SettingsPageProfile />} />
            </Route>
          </Routes>
        </div>
      </div>
    </div>
  );
}
