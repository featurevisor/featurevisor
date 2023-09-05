import * as React from "react";

import { PrettyDate } from "./PrettyDate";

export function LastModified(props: any) {
  const { lastModified } = props;

  if (!lastModified) {
    return (
      <p className="inline-flex rounded-full px-2 text-xs leading-5 text-gray-500">
        Last modified
        <span className="pl-1 font-semibold text-gray-600">n/a</span>
      </p>
    );
  }

  return (
    <p className="inline-flex rounded-full px-2 text-xs leading-5 text-gray-500">
      Last modified by
      <span className="pl-1 pr-1 font-semibold text-gray-600">{lastModified.author}</span> on
      <span className="pl-1 font-semibold text-gray-600">
        <PrettyDate date={lastModified.timestamp} />
      </span>
    </p>
  );
}
