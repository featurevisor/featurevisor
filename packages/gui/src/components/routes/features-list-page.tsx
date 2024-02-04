import * as React from "react";
import { Link } from "react-router-dom";

import { Separator } from "../ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableCaption,
} from "../ui/table";
import { Badge } from "../ui/badge";
import { H2, InlineCode } from "../ui/typography";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

import { Truncate } from "../blocks/truncate";

import { parseSearchQuery, Query } from "../../utils";

export function isEnabledInEnvironment(feature: any, environment: string) {
  if (feature.archived === true) {
    return false;
  }

  if (!feature.environments[environment]) {
    return false;
  }

  if (feature.environments[environment].expose === false) {
    return false;
  }

  if (feature.environments[environment].rules.some((rule: any) => rule.percentage > 0)) {
    return true;
  }

  return false;
}

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
  const [entities, setEntities] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState("");

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
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <Table>
        <TableCaption className="pt-4">{filteredEntities.length} records found.</TableCaption>
        {filteredEntities.length > 0 && (
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {filteredEntities.map((entity) => (
            <TableRow key={entity.key}>
              <TableCell className="font-medium">
                <Link className="hover:underline" to={`/attributes/${entity.key}`}>
                  <InlineCode>{entity.key}</InlineCode>
                </Link>{" "}
                {entity.capture && <Badge variant="default">capture</Badge>}{" "}
                {entity.archived && <Badge variant="secondary">archived</Badge>}
              </TableCell>
              <TableCell className="text-gray-600">
                <Truncate text={entity.description} length={160} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
