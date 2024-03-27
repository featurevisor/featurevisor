import * as React from "react";

export function Truncate({ text, length = 100, className = "", suffix = "..." }) {
  const shortedText = text.substring(0, length);

  return (
    <div className={className}>
      {shortedText}
      {shortedText.length < text.length ? suffix : ""}
    </div>
  );
}
