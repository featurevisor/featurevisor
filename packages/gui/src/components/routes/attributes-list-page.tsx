import * as React from "react";
import { Link } from "react-router-dom";

import { Separator } from "../ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Badge } from "../ui/badge";
import { H2, InlineCode } from "../ui/typography";

function EntitiesTable() {
  const [entities, setEntities] = React.useState(null);

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

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entities.map((entity) => (
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
