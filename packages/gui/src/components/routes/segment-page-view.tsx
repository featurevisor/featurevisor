import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Pencil1Icon } from "@radix-ui/react-icons";

import { Separator } from "../ui/separator";
import { InlineCode } from "../ui/typography";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";

import { Markdown } from "../blocks/markdown";
import { cn } from "../../utils";

function getAndOrNotColor(andOrNot) {
  switch (andOrNot) {
    case "and":
      return { background: "bg-emerald-700", border: "border-emerald-700" };
    case "or":
      return { background: "bg-amber-500", border: "border-amber-500" };
    case "not":
      return { background: "bg-rose-900", border: "border-rose-900" };
  }
}

function SegmentConditions({ conditions = undefined, depth = 0 }) {
  if (typeof conditions === "object" && typeof conditions.attribute === "string") {
    // plain
    return (
      <div className="ml-2">
        <span className="font-bold">•</span> <InlineCode>{conditions.attribute}</InlineCode>{" "}
        <span>{conditions.operator}</span>{" "}
        {Array.isArray(conditions.value) && (
          <ul className="list-disc list-inside mt-2">
            {conditions.value.map((v) => (
              <li key={v} className="ml-8 my-1">
                <InlineCode>{v}</InlineCode>
              </li>
            ))}
          </ul>
        )}
        {!Array.isArray(conditions.value) && <InlineCode>{conditions.value}</InlineCode>}
      </div>
    );
  }

  if (Array.isArray(conditions)) {
    // array
    return (
      <ul className="">
        {conditions.map((condition, index) => {
          return (
            <li key={index} className="px-1 py-2">
              <SegmentConditions conditions={condition} depth={depth + 1} />
            </li>
          );
        })}
      </ul>
    );
  }

  // object
  const andOrNot = Object.keys(conditions)[0];

  return (
    <div
      className={cn(
        "rounded p-2 m-2 relative",
        depth > 0 ? "border" : "",
        `${getAndOrNotColor(andOrNot).border}`,
      )}
    >
      <div
        className={cn(
          "relative top-[-8px] left-[-8px] px-2 py-1 text-white rounded-br-sm rounded-tl-sm inline-block font-bold text-md",
          `${getAndOrNotColor(andOrNot).background}`,
        )}
      >
        {andOrNot}
      </div>
      <SegmentConditions conditions={conditions[andOrNot]} depth={depth + 1} />
    </div>
  );
}

export function SegmentPageView() {
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [segment, setSegment] = React.useState(null);

  React.useEffect(() => {
    fetch(`/api/segments/${key}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          toast({
            title: `Error`,
            description: data.error.message,
          });

          navigate("/segments");

          return;
        }

        setSegment(data.data);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="relative">
        <h3 className="text-lg font-medium">Overview</h3>
        <p className="text-sm text-muted-foreground">Overview of your segment</p>

        <div className="absolute right-0 top-0">
          <Link to={`/segments/${key}/edit`}>
            <Button size="sm">
              <Pencil1Icon className="inline w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      <Separator />

      {segment ? (
        <div className="border-gray-200">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-800">Key</dt>
              <dd className="mt-1 text-sm text-gray-500">
                <InlineCode>{segment.key}</InlineCode>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-800">Archived</dt>
              <dd className="mt-1 text-sm text-gray-500">
                {segment.archived === true ? <span>Yes</span> : <span>No</span>}
              </dd>
            </div>

            <div className="col-span-2">
              <dt className="text-sm font-medium text-gray-800">Description</dt>
              <dd className="mt-1 text-sm text-gray-500">
                {segment.description.trim().length > 0 ? (
                  <Markdown children={segment.description} />
                ) : (
                  "n/a"
                )}
              </dd>
            </div>

            <div className="col-span-2">
              <dt className="text-sm font-medium text-gray-800">Conditions</dt>
              <dd className="mt-1 text-sm text-gray-500">
                <SegmentConditions conditions={segment.conditions} />
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}
