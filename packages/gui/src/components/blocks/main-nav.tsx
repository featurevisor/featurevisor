import * as React from "react";
import { Link, useLocation } from "react-router-dom";

import { cn } from "../../utils";

// @TODO: make it a prop
const items = [
  {
    title: "Features",
    href: "/features",
  },
  {
    title: "Segments",
    href: "/segments",
  },
  {
    title: "Attributes",
    href: "/attributes",
  },
  {
    title: "History",
    href: "/history",
  },
];

export function MainNav({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  const location = useLocation();

  return (
    <nav className={cn("flex items-center space-x-4 lg:space-x-6", className)} {...props}>
      {items.map((item) => {
        const isActive = location.pathname.startsWith(item.href);

        return (
          <Link
            key={item.title}
            to={item.href}
            className={[
              "text-sm transition-colors py-2 font-bold px-2 rounded-md hover:bg-gray-600 text-white",
              isActive ? "bg-gray-600" : "",
            ].join(" ")}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
