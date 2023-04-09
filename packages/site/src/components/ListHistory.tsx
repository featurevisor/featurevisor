import * as React from "react";

import { PageContent } from "./PageContent";
import { PageTitle } from "./PageTitle";
import { HistoryTimeline } from "./HistoryTimeline";

export function ListHistory() {
  return (
    <PageContent>
      <PageTitle>History</PageTitle>

      <div className="px-8">
        <HistoryTimeline showTime />
      </div>
    </PageContent>
  );
}
