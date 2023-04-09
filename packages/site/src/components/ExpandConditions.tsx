import * as React from "react";

interface ConditionValueProps {
  value: any;
}

function ConditionValue(props: ConditionValueProps) {
  const { value } = props;

  if (typeof value === "string") {
    return <span className="text-sm">{value}</span>;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <code className="rounded bg-gray-100 px-2 py-1 text-sm text-red-400">
        {JSON.stringify(value)}
      </code>
    );
  }

  return (
    <pre className="rounded bg-gray-100 px-2 py-1 text-sm text-red-400">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

interface ExpandConditionsProps {
  conditions: any;
}

export function ExpandConditions(props: ExpandConditionsProps) {
  const { conditions } = props;

  if (Array.isArray(conditions)) {
    return (
      <ul className="relative list-inside list-disc pl-5">
        {conditions.map((condition: any, index: number) => {
          return (
            <li key={index} className="py-1">
              {typeof condition.attribute !== "undefined" ? (
                <>
                  <a href="#" className="text-sm">
                    {condition.attribute}
                  </a>{" "}
                  <span className="text-sm font-semibold">
                    {condition.operator}
                  </span>{" "}
                  <ConditionValue value={condition.value} />
                </>
              ) : (
                <ExpandConditions conditions={condition} />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (typeof conditions === "object") {
    const type = Object.keys(conditions)[0];

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
        <ExpandConditions conditions={conditions[type]} />
      </>
    );
  }

  return <span>n/a</span>; // should never happen
}
