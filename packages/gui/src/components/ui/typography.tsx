import * as React from "react";

import { cn } from "../../utils";

export function H2({ className = "", children }) {
  return (
    <h2
      className={cn(
        "scroll-m-20 border-b pb-2 text-2xl font-bold tracking-tight first:mt-0",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function InlineCode(props) {
  return (
    <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono font-semibold">
      {props.children}
    </code>
  );
}
