import * as React from "react";

import { Separator } from "../ui/separator";
import { HistoryTimeline } from "../blocks/history-timeline";

export function HistoryPage() {
  const [entries, setEntries] = React.useState(null);

  React.useEffect(() => {
    fetch("/api/history")
      .then((res) => res.json())
      .then((data) => setEntries(data.data));
  }, []);

  return (
    <>
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">History</h2>

        <p className="text-muted-foreground">Timeline of all changes in the project.</p>
      </div>

      <Separator className="my-6" />

      <div className="">
        {Array.isArray(entries) ? <HistoryTimeline entries={entries} /> : <p>Loading...</p>}
      </div>
    </>
  );
}
