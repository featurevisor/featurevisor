import * as React from "react";
import { Link, NavLink } from "react-router-dom";

export function Header() {
  const navItems = [
    {
      title: "Features",
      to: "features",
      active: true,
    },
    {
      title: "Segments",
      to: "segments",
    },
    {
      title: "Attributes",
      to: "attributes",
    },
    {
      title: "History",
      to: "history",
    },
  ];

  return (
    <div className="bg-gray-800">
      <nav className="mx-auto flex max-w-4xl items-center justify-between px-8 pb-4 pt-3">
        <Link to="/" className="text-gray-50">
          <img
            alt="Featurevisor"
            src="/favicon-128.png"
            className="absolute top-4 -ml-2 w-[36px]"
          />
        </Link>

        <div className="relative flex gap-x-4">
          {navItems.map((item) => (
            <NavLink
              key={item.title}
              to={item.to}
              className={({ isActive }) => {
                return [
                  "relative",
                  "rounded-lg",
                  isActive ? "bg-gray-700" : "",
                  "px-3",
                  "py-2",
                  "text-sm",
                  "font-semibold",
                  "leading-6",
                  "text-gray-50",
                ].join(" ");
              }}
            >
              {item.title}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
