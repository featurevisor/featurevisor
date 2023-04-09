import * as React from "react";

import { ArrowTopRightOnSquareIcon } from "@heroicons/react/20/solid";

export function EditLink(props: any) {
  const { path } = props;

  return (
    <a
      href={props.url}
      target="_blank"
      className="w-18 h-18 relative top-0.5 float-right inline-block rounded-md bg-slate-100 px-2 py-1 text-lg text-gray-500 hover:bg-slate-200"
    >
      <span className="pr-1 text-sm font-normal">Edit</span>{" "}
      <ArrowTopRightOnSquareIcon className="inline-block h-5 w-5 text-sm text-gray-400" />
    </a>
  );
}
