import * as React from "react";

const navItems = [
  {
    title: "Features",
    href: "#",
    active: true,
  },
  {
    title: "Segments",
    href: "#",
  },
  {
    title: "Attributes",
    href: "#",
  },
];

export function Header() {
  return (
    <div className="bg-gray-800">
      <nav className="mx-auto flex max-w-4xl items-center justify-between px-8 pb-4 pt-3">
        <a href="/" className="text-gray-50">
          <img
            alt="Featurevisor"
            src="/favicon-128.png"
            className="absolute top-4 -ml-2 w-[36px]"
          />
        </a>

        <div className="relative flex gap-x-4">
          {navItems.map((item) => (
            <a
              key={item.title}
              href={item.href}
              className={[
                "relative",
                "rounded-lg",
                item.active ? "bg-gray-700" : "",
                "px-3",
                "py-2",
                "text-sm",
                "font-semibold",
                "leading-6",
                "text-gray-50",
              ].join(" ")}
            >
              {item.title}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
