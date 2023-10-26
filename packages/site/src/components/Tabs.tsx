import * as React from "react";
import { NavLink } from "react-router-dom";

interface Tab {
  title: string;
  to: string;
  end?: boolean;
}

interface TabsProps {
  tabs: Tab[];
}

export function Tabs(props: TabsProps) {
  const { tabs } = props;

  return (
    <div className="border-b border-gray-200">
      <div className="flex">
        {tabs.map((tab) => (
          <NavLink
            key={tab.title}
            to={tab.to}
            end={Boolean(tab.end)}
            className={({ isActive }) =>
              [
                "w-1/4",
                "border-b-2",
                "pt-2",
                "pb-4",
                "px-1",
                "text-center",
                "text-sm",
                "font-medium",
                isActive
                  ? "border-slate-500 text-slate-600"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
              ].join(" ")
            }
          >
            {tab.title}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
