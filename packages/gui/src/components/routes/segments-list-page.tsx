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

function getEntitiesByQuery(query: Query, entities) {
  const segments = entities
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

      return matched;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return segments;
}

function EntitiesTable() {
  const [entities, setEntities] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    fetch("/api/segments")
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
        placeholder="Search segments..."
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
                <Link className="hover:underline" to={`/segments/${entity.key}`}>
                  <InlineCode>{entity.key}</InlineCode>
                </Link>{" "}
                {entity.archived && <Badge variant="secondary">archived</Badge>}
              </TableCell>
              <TableCell className="text-gray-600">
                <Truncate text={entity.description} length={180} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SegmentsListPage() {
  return (
    <>
      <div className="space-y-0.5 relative">
        <H2 className="border-none">Segments</H2>

        <p className="text-muted-foreground">List of all segments in the project.</p>

        <div className="absolute right-0 top-0">
          <Link to="/create/segment">
            <Button size="sm">Create</Button>
          </Link>
        </div>
      </div>

      <Separator className="my-6" />

      <EntitiesTable />
    </>
  );
}
