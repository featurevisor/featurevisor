import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import { H2 } from "../ui/typography";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

import { parseSearchQuery, Query, isEnabledInEnvironment } from "../../utils";
import { EnvironmentDot } from "../blocks/environment-dot";

function getEntitiesByQuery(query: Query, entities) {
  const features = entities
    .filter((feature) => {
      let matched = true;

      if (query.keyword.length > 0 && feature.key.indexOf(query.keyword.toLowerCase()) === -1) {
        matched = false;
      }

      if (query.tags.length > 0) {
        for (const tag of query.tags) {
          if (feature.tags.every((t: string) => t.toLowerCase() !== tag.toLowerCase())) {
            matched = false;
          }
        }
      }

      if (query.environments.length > 0 && feature.archived !== false) {
        for (const environment of query.environments) {
          if (isEnabledInEnvironment(feature, environment) === false) {
            matched = false;
          }
        }
      }

      if (typeof query.archived === "boolean") {
        if (query.archived && feature.archived !== query.archived) {
          matched = false;
        }

        if (!query.archived && feature.archived === true) {
          matched = false;
        }
      }

      if (typeof query.hasVariations !== "undefined") {
        if (query.hasVariations && !feature.variations) {
          matched = false;
        }

        if (!query.hasVariations && feature.variations) {
          matched = false;
        }
      }

      if (typeof query.variationValues !== "undefined") {
        if (!feature.variations) {
          matched = false;
        } else {
          const valuesFromFeature = feature.variations.map((v: any) => v.value);

          if (query.variationValues.some((v) => valuesFromFeature.indexOf(v) === -1)) {
            matched = false;
          }
        }
      }

      if (typeof query.variableKeys !== "undefined") {
        if (!feature.variablesSchema) {
          matched = false;
        } else {
          const keysFromFeature = feature.variablesSchema.map((v: any) => v.key);

          if (query.variableKeys.some((k) => keysFromFeature.indexOf(k) === -1)) {
            matched = false;
          }
        }
      }

      if (typeof query.hasVariables !== "undefined") {
        if (query.hasVariables && !feature.variablesSchema) {
          matched = false;
        }

        if (!query.hasVariables && feature.variablesSchema) {
          matched = false;
        }
      }

      return matched;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return features;
}

function EntitiesTable() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [entities, setEntities] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState(initialQuery);

  React.useEffect(() => {
    setSearchParams({ q: searchQuery });
  }, [searchQuery, setSearchParams]);

  React.useEffect(() => {
    fetch("/api/features")
      .then((res) => res.json())
      .then((data) => setEntities(data.data));
  }, []);

  if (!Array.isArray(entities)) {
    return <p>Loading...</p>;
  }

  if (entities.length === 0) {
    return <p>No entities found.</p>;
  }

  const parsedSearchQuery = parseSearchQuery(searchQuery);
  const filteredEntities = getEntitiesByQuery(parsedSearchQuery, entities);

  return (
    <div>
      <Input
        type="search"
        autoComplete="off"
        placeholder="Search features..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {filteredEntities.length > 0 && (
        <div>
          <ul className="diving-gray-200 divide-y">
            {filteredEntities.map((feature: any) => (
              <li key={feature.key}>
                <Link to={`/features/${feature.key}`}>
                  <div className="block hover:bg-gray-50">
                    <div className="px-1 py-4">
                      <div className="flex items-center justify-between">
                        <p className="text-md relative font-bold text-slate-600">
                          <EnvironmentDot
                            feature={feature}
                            className="relative top-[0.5px] inline-block pr-2"
                          />{" "}
                          <span className="font-bold">{feature.key}</span>{" "}
                          {feature.archived && (
                            <span className="ml-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                              archived
                            </span>
                          )}
                        </p>

                        <div className="ml-2 flex flex-shrink-0">
                          <div>
                            {feature.tags.sort().map((tag: string) => (
                              <Badge key={tag} variant="secondary">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex justify-between">
                        <div className="flex">
                          <p className="line-clamp-3 max-w-md items-center pl-6 text-sm text-gray-500">
                            {feature.description && feature.description.trim().length > 0
                              ? feature.description
                              : "n/a"}
                          </p>
                        </div>

                        <div className="items-top mt-2 flex text-xs text-gray-500 sm:mt-0"></div>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-center text-sm text-gray-500">
            A total of <span className="font-bold">{filteredEntities.length}</span> results found.
          </p>
        </div>
      )}
    </div>
  );
}

export function FeaturesListPage() {
  return (
    <>
      <div className="space-y-0.5 relative">
        <H2 className="border-none">Features</H2>

        <p className="text-muted-foreground">List of all features in the project.</p>

        <div className="absolute right-0 top-0">
          <Link to="/create/attribute">
            <Button size="sm">Create</Button>
          </Link>
        </div>
      </div>

      <Separator className="my-6" />

      <EntitiesTable />
    </>
  );
}
