import * as React from "react";
import { useParams } from "react-router-dom";

import { PageContent } from "./PageContent";
import { PageTitle } from "./PageTitle";
import { Tabs } from "./Tabs";
import { HistoryTimeline } from "./HistoryTimeline";
import { EditLink } from "./EditLink";
import { useSearchIndex } from "../hooks/searchIndexHook";
import { Markdown } from "./Markdown";

const tabs = [
  {
    title: "Overview",
    href: "#",
    active: true,
  },
  {
    title: "Usage",
    href: "#",
  },
  {
    title: "History",
    href: "#",
  },
];

function DisplayAttributeOverview({ attribute }) {
  return (
    <div className="border-t border-gray-200 py-6">
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
        <div>
          <dt className="text-sm font-medium text-gray-500">Capture</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {attribute.capture === true ? <span>Yes</span> : <span>No</span>}
          </dd>
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

function DisplayAttributeUsage({ attribute }) {
  return (
    <div className="border-t border-gray-200 py-6">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Segments</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {attribute.usedInSegments.length === 0 && "none"}

            {attribute.usedInSegments.length > 0 && (
              <ul className="list-inside list-disc">
                {attribute.usedInSegments.map((segment) => {
                  return <li key={segment}>{segment}</li>;
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
                  return <li key={feature}>{feature}</li>;
                })}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ShowAttribute(props) {
  const { attributeKey } = useParams();
  const { data } = useSearchIndex();
  const links = data?.links;
  const attribute = data?.entities.attributes.find((a) => a.key === attributeKey);

  if (!attribute) {
    return <p>Attribute not found.</p>;
  }

  return (
    <PageContent>
      <PageTitle className="border-none">
        Attribute: {attributeKey}{" "}
        {links && <EditLink url={links.attribute.replace("{{key}}", attribute.key)} />}
      </PageTitle>

      <Tabs tabs={tabs} />

      <div className="px-8">
        <h2 className="text-2xl font-bold">History</h2>
        <HistoryTimeline entityType="attribute" entityKey={attributeKey} />
      </div>

      <hr />

      <div className="px-8">
        <h2 className="text-2xl font-bold">Overview</h2>

        <DisplayAttributeOverview attribute={attribute} />
      </div>

      <div className="px-8">
        <h2 className="text-2xl font-bold">Usage</h2>

        <DisplayAttributeUsage attribute={attribute} />
      </div>
    </PageContent>
  );
}
