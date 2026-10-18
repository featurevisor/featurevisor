import { Navigate } from "react-router-dom";

import { useCatalog } from "../../context/CatalogContext";
import { EmptyState } from "../../components/ui";
import { EntityTests } from "../../components/tests";
import { RelatedScenarios } from "../../components/testNavigation";
import { groupEntityTests } from "../../testReferences";
import { useEntityDetail } from "./shared";

export function TestsTab() {
  const { detail, setKey } = useEntityDetail();
  const { manifest } = useCatalog();

  if (detail.type !== "feature" && detail.type !== "segment" && detail.type !== "variable") {
    return <Navigate to=".." replace />;
  }

  const groups = groupEntityTests(detail.tests || [], detail);
  return (
    <div className="space-y-10">
      {!groups.length && <EmptyState title="No test specs found" />}
      {groups.map((group) => (
        <section key={group.title} className="space-y-5">
          <h2 className="text-base font-semibold">
            {group.title} <span className="text-muted">({group.tests.length})</span>
          </h2>
          <EntityTests
            tests={group.tests}
            allTests={detail.tests}
            reportSupplied={!!manifest.testReport}
            entity={detail}
            setKey={setKey}
          />
        </section>
      ))}
      <RelatedScenarios scenarios={detail.relatedScenarios || []} setKey={setKey} />
    </div>
  );
}
