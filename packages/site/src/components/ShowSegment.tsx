import * as React from "react";
import { useParams, useOutletContext, Outlet, Link } from "react-router-dom";

import { PageContent } from "./PageContent";
import { PageTitle } from "./PageTitle";
import { Tabs } from "./Tabs";
import { HistoryTimeline } from "./HistoryTimeline";
import { ExpandConditions } from "./ExpandConditions";
import { EditLink } from "./EditLink";
import { useSearchIndex } from "../hooks/useSearchIndex";
import { Markdown } from "./Markdown";

export function DisplaySegmentOverview() {
  const { segment } = useOutletContext() as any;

  return (
    <div className="border-gray-200">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Key</dt>
          <dd className="mt-1 text-sm text-gray-900">{segment.key}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Archived</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {segment.archived === true ? <span>Yes</span> : <span>No</span>}
          </dd>
        </div>

        <div className="col-span-2">
          <dt className="text-sm font-medium text-gray-500">Description</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {segment.description.trim().length > 0 ? (
              <Markdown children={segment.description} />
            ) : (
              "n/a"
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-sm font-medium text-gray-500">Conditions</dt>
          <dd className="mt-1 text-sm text-gray-900">
            <ExpandConditions conditions={segment.conditions} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DisplaySegmentUsage() {
  const { segment } = useOutletContext() as any;

  return (
    <div className="border-gray-200">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Features</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {segment.usedInFeatures.length === 0 && "none"}

            {segment.usedInFeatures.length > 0 && (
              <ul className="list-inside list-disc">
                {segment.usedInFeatures.map((feature) => {
                  return (
                    <li key={feature}>
                      <Link to={`/features/${feature}`}>{feature}</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DisplaySegmentHistory() {
  const { segment } = useOutletContext() as any;

  return <HistoryTimeline entityType="segment" entityKey={segment.key} />;
}

export function ShowSegment() {
  const { segmentKey } = useParams();
  const { data } = useSearchIndex();
  const links = data?.links;
  const segment = data?.entities.segments.find((s) => s.key === segmentKey);

  if (!segment) {
    return <div>Segment not found</div>;
  }

  const tabs = [
    {
      title: "Overview",
      to: `/segments/${segmentKey}`,
      end: true,
    },
    {
      title: "Usage",
      to: `/segments/${segmentKey}/usage`,
    },
    {
      title: "History",
      to: `/segments/${segmentKey}/history`,
    },
  ];

  return (
    <PageContent>
      <PageTitle className="border-none">
        Segment: {segmentKey}{" "}
        {links && <EditLink url={links.segment.replace("{{key}}", segment.key)} />}
      </PageTitle>

      <Tabs tabs={tabs} />

      <div className="p-8">
        <Outlet context={{ segment }} />
      </div>
    </PageContent>
  );
}
