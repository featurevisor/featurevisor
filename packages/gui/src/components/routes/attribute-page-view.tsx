import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";

import { Separator } from "../ui/separator";
import { InlineCode } from "../ui/typography";
import { useToast } from "../ui/use-toast";

import { Markdown } from "../blocks/markdown";

export function AttributePageView() {
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [attribute, setAttribute] = React.useState(null);

  React.useEffect(() => {
    fetch(`/api/attributes/${key}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          toast({
            title: `Error`,
            description: data.error.message,
          });

          navigate("/attributes");

          return;
        }

        setAttribute(data.data);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Overview</h3>
        <p className="text-sm text-muted-foreground">Overview of your attribute</p>
      </div>

      <Separator />

      {attribute ? (
        <div className="border-gray-200">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-500">Key</dt>
              <dd className="mt-1 text-sm text-gray-900">
                <InlineCode>{attribute.key}</InlineCode>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Type</dt>
              <dd className="mt-1 text-sm text-gray-900">{attribute.type}</dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Capture</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {attribute.capture === true ? <span>Yes</span> : <span>No</span>}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-500">Archived</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {attribute.archived === true ? <span>Yes</span> : <span>No</span>}
              </dd>
            </div>

            <div className="col-span-2">
              <dt className="text-sm font-medium text-gray-500">Description</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {attribute.description.trim().length > 0 ? (
                  <Markdown children={attribute.description} />
                ) : (
                  "n/a"
                )}
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
