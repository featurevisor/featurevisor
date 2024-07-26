import * as React from "react";
import { useParams } from "react-router-dom";

import { Separator } from "../ui/separator";
import { HistoryTimeline } from "../blocks/history-timeline";

export function FeaturePageHistory() {
  const { key } = useParams();
  const [entries, setEntries] = React.useState(null);

  React.useEffect(() => {
    fetch(`/api/features/${key}/history`)
      .then((res) => res.json())
      .then((data) => setEntries(data.data));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">History</h3>
        <p className="text-sm text-muted-foreground">
          See the changes done to this feature over time
        </p>
      </div>

      <Separator />

      {Array.isArray(entries) ? <HistoryTimeline entries={entries} /> : <p>Loading...</p>}
    </div>
  );
}
