import * as React from "react";
import { useParams } from "react-router-dom";

import { Separator } from "../ui/separator";

export function AttributePageView() {
  const { key } = useParams();
  const [attribute, setAttribute] = React.useState(null);

  React.useEffect(() => {
    fetch(`/api/attributes/${key}`)
      .then((res) => res.json())
      .then((data) => setAttribute(data.data));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Attribute: {key}</h3>
        <p className="text-sm text-muted-foreground">Overview of your attribute</p>
      </div>

      <Separator />

      {attribute ? (
        <ul>
          <li>Description: {attribute.description}</li>
          <li>Type: {attribute.type}</li>
          <li>Capture: {attribute.capture ? "Yes" : "No"}</li>
        </ul>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}
