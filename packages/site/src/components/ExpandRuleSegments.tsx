import * as React from "react";

interface ExpandRuleSegmentsProps {
  segments: any;
}

export function ExpandRuleSegments(props: ExpandRuleSegmentsProps) {
  const { segments } = props;

  if (segments === "*") {
    return (
      <pre>
        <code className="rounded bg-gray-100 px-2 py-1 text-red-400">*</code>{" "}
        (everyone)
      </pre>
    );
  }

  if (Array.isArray(segments)) {
    return (
      <ul className="relative list-inside list-disc pl-5">
        {segments.map((segment: any, index: number) => {
          return (
            <li key={index} className="py-1">
              {typeof segment === "string" ? (
                segment
              ) : (
                <ExpandRuleSegments segments={segment} />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (typeof segments === "object") {
    const type = Object.keys(segments)[0];

    let classes = "bg-green-300 text-green-700";

    if (type === "or") {
      classes = "bg-yellow-300 text-yellow-700";
    } else if (type === "not") {
      classes = "bg-red-300 text-red-700";
    }

    return (
      <>
        <span className={`rounded-full px-2 py-1 text-sm font-bold ${classes}`}>
          {type}:
        </span>
        <ExpandRuleSegments segments={segments[type]} />
      </>
    );
  }

  return <span>n/a</span>; // should never happen
}
