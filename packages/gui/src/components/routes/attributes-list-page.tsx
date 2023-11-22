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

import { parseSearchQuery, Query } from "../../utils";

function getAttributesByQuery(query: Query, entities) {
  const attributes = entities
    .filter((a) => {
      let matched = true;

      if (
        query.keyword.length > 0 &&
        a.key.toLowerCase().indexOf(query.keyword.toLowerCase()) === -1
      ) {
        matched = false;
      }

      if (typeof query.archived === "boolean") {
        if (query.archived && a.archived !== query.archived) {
          matched = false;
        }

        if (!query.archived && a.archived === true) {
          matched = false;
        }
      }

      if (typeof query.capture === "boolean") {
        if (query.capture && a.capture !== query.capture) {
          matched = false;
        }

        if (!query.capture && a.capture === true) {
          matched = false;
        }
      }

      return matched;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return attributes;
}

function EntitiesTable() {
  const [entities, setEntities] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    fetch("/api/attributes")
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
  const filteredEntities = getAttributesByQuery(parsedSearchQuery, entities);

  return (
    <div>
      <Input
        type="search"
        autoComplete="off"
        placeholder="search..."
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <Table>
        <TableCaption className="pt-4">{filteredEntities.length} records found.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
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
              <TableCell>{entity.type}</TableCell>
              <TableCell>{entity.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AttributesListPage() {
  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight hidden">Attributes</h2>

        <H2 className="border-none">Attributes</H2>

        <p className="text-muted-foreground">List of all attributes in the project.</p>
      </div>

      <Separator className="my-6" />

      <EntitiesTable />
    </>
  );
}
