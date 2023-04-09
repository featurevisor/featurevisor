import * as React from "react";

interface TagProps {
  tag: string;
}

export function Tag(props: TagProps) {
  return (
    <span className="mr-1 rounded-full border-slate-400 bg-slate-300 px-2 py-1 text-xs text-gray-600">
      {props.tag}
    </span>
  );
}
