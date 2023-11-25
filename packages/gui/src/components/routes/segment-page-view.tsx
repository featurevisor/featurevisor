import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Pencil1Icon } from "@radix-ui/react-icons";

import { Separator } from "../ui/separator";
import { InlineCode } from "../ui/typography";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";

import { Markdown } from "../blocks/markdown";

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
                <pre>
                  <code>{JSON.stringify(segment.conditions, null, 2)}</code>
                </pre>
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
