import * as React from "react";

export function Header() {
  return (
    <header className="bg-gray-900">
      <nav className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8">
        <a href="#" className="text-gray-50">
          <span className="">Featurevisor</span>
        </a>
        <div className="flex gap-x-12">
          <a key="features" href="#" className="text-sm font-semibold leading-6 text-gray-50">
            Features
          </a>

          <a key="segments" href="#" className="text-sm font-semibold leading-6 text-gray-50">
            Segments
          </a>

          <a key="attributes" href="#" className="text-sm font-semibold leading-6 text-gray-50">
            Attributes
          </a>
        </div>
      </nav>
    </header>
  );
}
