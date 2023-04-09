import * as React from "react";

export function PageTitle(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={[
        "mx-6",
        "border-b",
        "pb-4",
        "pt-8",
        "text-3xl",
        "font-black",
        "text-gray-700",
        props.className ? props.className : "",
      ].join(" ")}
    >
      {props.children}
    </h1>
  );
}
