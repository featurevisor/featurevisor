import * as React from "react";

interface AlertProps {
  type: "success" | "warning";
  children: React.ReactNode;
}

export function Alert(props: AlertProps) {
  if (props.type === "success") {
    return (
      <p className="my-6 mx-6 block rounded border-2 border-green-300 bg-green-200 p-3 text-sm text-gray-600">
        {props.children}
      </p>
    );
  }

  return (
    <p className="my-6 mx-6 block rounded border-2 border-orange-300 bg-orange-200 p-3 text-sm text-gray-600">
      {props.children}
    </p>
  );
}
