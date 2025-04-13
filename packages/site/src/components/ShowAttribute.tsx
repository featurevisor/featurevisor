import * as React from "react";
import { useParams, Outlet, useOutletContext, Link } from "react-router-dom";

import { PageContent } from "./PageContent";
import { PageTitle } from "./PageTitle";
import { Tabs } from "./Tabs";
import { EditLink } from "./EditLink";
import { useSearchIndex } from "../hooks/useSearchIndex";
import { Markdown } from "./Markdown";
import { HistoryTimeline } from "./HistoryTimeline";

export function DisplayAttributeOverview() {
  const { attribute } = useOutletContext() as any;

  return (
    <div className="border-gray-200 py-6">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Key</dt>
          <dd className="mt-1 text-sm text-gray-900">{attribute.key}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Archived</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {attribute.archived === true ? <span>Yes</span> : <span>No</span>}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Type</dt>
          <dd className="mt-1 text-sm text-gray-900">{attribute.type}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-sm font-medium text-gray-500">Description</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {attribute.description.trim().length > 0 ? (
              <Markdown children={attribute.description} />
            ) : (
              "n/a"
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DisplayAttributeUsage() {
  const { attribute } = useOutletContext() as any;

  return (
    <div className="border-gray-200 py-6">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Segments</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {attribute.usedInSegments.length === 0 && "none"}

            {attribute.usedInSegments.length > 0 && (
              <ul className="list-inside list-disc">
                {attribute.usedInSegments.map((segment) => {
                  return (
                    <li key={segment}>
                      <Link to={`/segments/${segment}`}>{segment}</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Features</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {attribute.usedInFeatures.length === 0 && "none"}

            {attribute.usedInFeatures.length > 0 && (
              <ul className="list-inside list-disc">
                {attribute.usedInFeatures.map((feature) => {
                  return (
                    <li key={feature}>
                      <Link to={`/features/${encodeURIComponent(feature)}`}>{feature}</Link>
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

export function DisplayAttributeHistory() {
  const { attribute } = useOutletContext() as any;

  return <HistoryTimeline entityType="attribute" entityKey={attribute.key} />;
}

export function ShowAttribute() {
  const { attributeKey } = useParams();
  const { data } = useSearchIndex();
  const links = data?.links;
  const attribute = data?.entities.attributes.find((a) => a.key === attributeKey);

  if (!attribute) {
    return <p>Attribute not found.</p>;
  }

  const tabs = [
    {
      title: "Overview",
      to: `/attributes/${encodeURIComponent(attributeKey)}`,
    },
    {
      title: "Usage",
      to: `/attributes/${encodeURIComponent(attributeKey)}/usage`,
    },
    {
      title: "History",
      to: `/attributes/${encodeURIComponent(attributeKey)}/history`,
    },
  ];

  return (
    <PageContent>
      <PageTitle className="border-none">
        Attribute: {attributeKey}{" "}
        {links && <EditLink url={links.attribute.replace("{{key}}", attribute.key)} />}
      </PageTitle>

      <Tabs tabs={tabs} />

      <div className="p-8">
        <Outlet context={{ attribute }} />
      </div>
    </PageContent>
  );
}
