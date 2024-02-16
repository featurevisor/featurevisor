import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Pencil1Icon } from "@radix-ui/react-icons";

import { Separator } from "../ui/separator";
import { InlineCode } from "../ui/typography";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { Badge } from "../ui/badge";

import { Markdown } from "../blocks/markdown";

import { isEnabledInEnvironment, sortEnvironmentNames } from "../../utils";

function BucketBy({ bucketBy }) {
  if (typeof bucketBy === "string") {
    return <Link to={`/attributes/${bucketBy}`}>{bucketBy}</Link>;
  }

  if (bucketBy.or) {
    return (
      <ul>
        <li>
          <span className="rounded-full px-2 py-1 text-sm font-bold bg-yellow-300 text-yellow-700">
            or:
          </span>
          <BucketBy bucketBy={bucketBy.or} />
        </li>
      </ul>
    );
  }

  return (
    <ul className="list-inside list-disc pl-5">
      {bucketBy.map((b) => (
        <li key={b} className="py-1">
          <BucketBy bucketBy={b} />
        </li>
      ))}
    </ul>
  );
}

export function FeaturePageView() {
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [feature, setFeature] = React.useState(null);
  const [environmentKeys, setEnvironmentKeys] = React.useState([]);

  React.useEffect(() => {
    fetch(`/api/features/${key}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          toast({
            title: `Error`,
            description: data.error.message,
          });

          navigate("/features");

          return;
        }

        const environmentKeys = sortEnvironmentNames(Object.keys(data.data.environments));
        setEnvironmentKeys(environmentKeys);
        setFeature(data.data);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="relative">
        <h3 className="text-lg font-medium">Overview</h3>
        <p className="text-sm text-muted-foreground">Overview of your feature</p>

        <div className="absolute right-0 top-0">
          <Link to={`/features/${key}/edit`}>
            <Button size="sm">
              <Pencil1Icon className="inline w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      <Separator />

      {feature ? (
        <div className="border-gray-200">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-800">Key</dt>
              <dd className="mt-1 text-sm text-gray-500">
                <InlineCode>{feature.key}</InlineCode>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-800">Archived</dt>
              <dd className="mt-1 text-sm text-gray-500">
                {feature.archived === true ? <span>Yes</span> : <span>No</span>}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-800">Bucket by</dt>
              <dd className="mt-1 text-sm text-gray-900">
                <BucketBy bucketBy={feature.bucketBy} />
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-800">Status</dt>
              <dd className="mt-1 text-sm text-gray-900">
                <ul className="">
                  {environmentKeys.map((environmentKey) => (
                    <li key={environmentKey}>
                      <span className="relative top-0.5 inline-block h-3 w-3">
                        {isEnabledInEnvironment(feature, environmentKey) ? (
                          <span className="relative inline-block h-3 w-3 rounded-full bg-green-500"></span>
                        ) : (
                          <span className="relative inline-block h-3 w-3 rounded-full bg-slate-300"></span>
                        )}
                      </span>{" "}
                      {environmentKey}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-gray-800">Tags</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {feature.tags.sort().map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </dd>
            </div>

            <div className="col-span-2">
              <dt className="text-sm font-medium text-gray-800">Description</dt>
              <dd className="mt-1 text-sm text-gray-500">
                {feature.description.trim().length > 0 ? (
                  <Markdown children={feature.description} />
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
