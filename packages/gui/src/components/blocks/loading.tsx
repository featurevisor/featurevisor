import * as React from "react";

export function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <img
        src="/favicon-128.png"
        alt="Featurevisor"
        className="h-16 transform transition-transform duration-500 animate-pulse"
      />
    </div>
  );
}
