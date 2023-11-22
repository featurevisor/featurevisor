import * as React from "react";
import { Routes, Route } from "react-router-dom";

import { Toaster } from "../ui/toaster";

import { Loading } from "../blocks/loading";
import { Header } from "../blocks/header";

import { DashboardPage } from "./dashboard-page";

import { SettingsPage } from "./settings-page";
import { SettingsPageProfile } from "./settings-page-profile";

import { AttributesListPage } from "./attributes-list-page";
import { AttributePage } from "./attribute-page";
import { AttributePageView } from "./attribute-page-view";
import { AttributePageHistory } from "./attribute-page-history";

import { HistoryPage } from "./history-page";

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
        <div className="m-8 mx-auto max-w-4xl rounded-lg bg-white shadow">
          <div className="space-y-6 px-6 py-6 pb-12">
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

                <Route path=":key" element={<AttributePage />}>
                  <Route index element={<AttributePageView />} />
                  <Route path="history" element={<AttributePageHistory />} />
                </Route>
              </Route>

              {/* History */}
              <Route path="history">
                <Route index element={<HistoryPage />} />
              </Route>
            </Routes>
          </div>
        </div>
      </div>

      <div className="text-center text-xs pb-8 text-gray-500">
        <p>
          Built with{" "}
          <a href="https://featurevisor.com" className="underline" target="_blank">
            Featurevisor
          </a>
        </p>
      </div>

      <Toaster />
    </div>
  );
}
