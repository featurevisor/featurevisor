import * as React from "react";
import ReactMarkdown from "react-markdown";

export function Markdown(props) {
  return (
    <ReactMarkdown
      className={`prose prose-sm text-gray-700 ${props.className || ""}`}
      children={props.children}
    />
  );
}
