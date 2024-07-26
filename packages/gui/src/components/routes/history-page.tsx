import * as React from "react";

import { Separator } from "../ui/separator";
import { H2 } from "../ui/typography";

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
        <H2 className="border-none">History</H2>

        <p className="text-muted-foreground">Timeline of all changes in the project.</p>
      </div>

      <Separator className="my-6" />

      <div className="">
        {Array.isArray(entries) ? <HistoryTimeline entries={entries} /> : <p>Loading...</p>}
      </div>
    </>
  );
}
