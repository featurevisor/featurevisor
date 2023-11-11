import * as React from "react";
import { Link } from "react-router-dom";

import { cn } from "../../utils";

const items = [
  {
    title: "Overview",
    href: "/",
  },
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
];

export function MainNav({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav className={cn("flex items-center space-x-4 lg:space-x-6", className)} {...props}>
      {items.map((item) => (
        <Link
          key={item.title}
          to={item.href}
          className="text-sm font-medium transition-colors hover:text-primary"
        >
          {item.title}
        </Link>
      ))}
    </nav>
  );
}
