import * as React from "react";

export function PageContent(props: { children: React.ReactNode }) {
  return (
    <div className="m-8 mx-auto max-w-4xl rounded-lg bg-white px-0 py-0 pb-8 shadow">
      {props.children}
    </div>
  );
}
