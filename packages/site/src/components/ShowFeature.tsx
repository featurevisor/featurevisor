import * as React from "react";
import { useParams, useOutletContext, Outlet, NavLink } from "react-router-dom";

import { PageContent } from "./PageContent";
import { PageTitle } from "./PageTitle";
import { Tabs } from "./Tabs";
import { HistoryTimeline } from "./HistoryTimeline";
import { Tag } from "./Tag";
import { useSearchIndex } from "../hooks/useSearchIndex";
import { isEnabledInEnvironment } from "../utils";
import { ExpandRuleSegments } from "./ExpandRuleSegments";
import { ExpandConditions } from "./ExpandConditions";
import { EditLink } from "./EditLink";
import { Markdown } from "./Markdown";

export function DisplayFeatureOverview() {
  const { feature } = useOutletContext() as any;

  const environmentKeys = Object.keys(feature.environments).sort();

  return (
    <div className="border-gray-200">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Key</dt>
          <dd className="mt-1 text-sm text-gray-900">{feature.key}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Archived</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {feature.archived === true ? <span>Yes</span> : <span>No</span>}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Bucket by</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {typeof feature.bucketBy === "string" ? (
              <span>{feature.bucketBy}</span>
            ) : (
              <ul>
                {feature.bucketBy.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Status</dt>
          <dd className="mt-1 text-sm text-gray-900">
            <ul className="">
              {environmentKeys.map((environmentKey) => (
                <li key={environmentKey}>
                  <span className="relative top-0.5 inline-block h-3 w-3">
                    {isEnabledInEnvironment(feature, environmentKey) ? (
                      <span className="relative inline-block h-3 w-3 rounded-full bg-green-500"></span>
                    ) : (
                      <span className="relative inline-block h-3 w-3 rounded-full bg-slate-300"></span>
                    )}
                  </span>{" "}
                  {environmentKey}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Tags</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {feature.tags.map((tag: string) => (
              <Tag tag={tag} key={tag} />
            ))}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-sm font-medium text-gray-500">Description</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {feature.description && feature.description.trim().length > 0 ? (
              <Markdown children={feature.description} />
            ) : (
              "n/a"
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DisplayFeatureForceTable() {
  const { feature } = useOutletContext() as any;
  const { environmentKey } = useParams();

  if (
    !environmentKey ||
    !feature.environments[environmentKey] ||
    !feature.environments[environmentKey].force
  ) {
    return <p>n/a</p>;
  }

  return (
    <table className="mt-3 min-w-full divide-y divide-gray-300 border border-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Conditions / Segments
          </th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Variation
          </th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Variables
          </th>
        </tr>
      </thead>

      <tbody>
        {feature.environments[environmentKey].force.map((force, index) => {
          return (
            <tr key={index} className={index % 2 === 0 ? undefined : "bg-gray-50"}>
              <td className="py-4 pl-4 pr-3 text-sm text-gray-900">
                {force.conditions ? (
                  <ExpandConditions conditions={force.conditions} />
                ) : (
                  <ExpandRuleSegments segments={force.segments} />
                )}
              </td>
              <td className="py-4 pl-4 pr-3 text-sm text-gray-900">
                {force.variation && typeof force.variation === "string" && (
                  <span>{force.variation}</span>
                )}

                {force.variation && typeof force.variation != "string" && (
                  <code className="rounded bg-gray-100 px-2 py-1 text-red-400">
                    {JSON.stringify(force.variation)}
                  </code>
                )}
              </td>
              <td className="py-4 pl-4 pr-3 text-sm text-gray-900">
                {force.variables && (
                  <ul className="list-inside list-disc">
                    {Object.keys(force.variables).map((k) => {
                      return (
                        <li key={k}>
                          <span className="font-semibold">{k}</span>:{" "}
                          {typeof force.variables[k] === "string" && force.variables[k]}
                          {typeof force.variables[k] !== "string" && (
                            <code className="rounded bg-gray-100 px-2 py-1 text-red-400">
                              {force.variables[k]}
                            </code>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DisplayFeatureForce() {
  const { feature } = useOutletContext() as any;
  const environmentKeys = Object.keys(feature.environments).sort();

  const environmentTabs = environmentKeys.map((environmentKey) => {
    return {
      title: environmentKey,
      to: `/features/${feature.key}/force/${environmentKey}`,
    };
  });

  return (
    <>
      <nav className="flex space-x-4" aria-label="Tabs">
        {environmentTabs.map((tab) => (
          <NavLink
            key={tab.title}
            to={tab.to}
            className={({ isActive }) =>
              [
                isActive ? "bg-gray-200 text-gray-800" : "text-gray-600 hover:text-gray-800",
                "rounded-md px-3 py-2 text-sm font-medium",
              ].join(" ")
            }
          >
            {tab.title}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ feature }} />
    </>
  );
}

export function DisplayFeatureRulesTable() {
  const { feature } = useOutletContext() as any;
  const { environmentKey } = useParams();

  if (!environmentKey || !feature.environments[environmentKey]) {
    return <p>n/a</p>;
  }

  return (
    <table className="mt-3 min-w-full divide-y divide-gray-300 border border-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Percentage
          </th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">Segments</th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Variables
          </th>
        </tr>
      </thead>

      <tbody>
        {feature.environments[environmentKey].rules.map((rule, index) => {
          return (
            <tr key={index} className={index % 2 === 0 ? undefined : "bg-gray-50"}>
              <td className="py-4 pl-4 pr-3 text-sm text-gray-900">{rule.percentage}%</td>
              <td className="py-4 pl-4 pr-3 text-sm text-gray-900">
                <ExpandRuleSegments segments={rule.segments} />
              </td>
              <td className="py-4 pl-4 pr-3 text-sm text-gray-900">
                {rule.variables && (
                  <ul className="list-inside list-disc">
                    {Object.keys(rule.variables).map((k) => {
                      return (
                        <li key={k}>
                          <span className="font-semibold">{k}</span>:{" "}
                          {typeof rule.variables[k] === "string" && rule.variables[k]}
                          {typeof rule.variables[k] !== "string" && (
                            <code className="rounded bg-gray-100 px-2 py-1 text-red-400">
                              {rule.variables[k]}
                            </code>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DisplayFeatureRules() {
  const { feature } = useOutletContext() as any;
  const environmentKeys = Object.keys(feature.environments).sort();

  const environmentTabs = environmentKeys.map((environmentKey) => {
    return {
      title: environmentKey,
      to: `/features/${feature.key}/rules/${environmentKey}`,
    };
  });

  return (
    <>
      <nav className="flex space-x-4" aria-label="Tabs">
        {environmentTabs.map((tab) => (
          <NavLink
            key={tab.title}
            to={tab.to}
            className={({ isActive }) =>
              [
                isActive ? "bg-gray-200 text-gray-800" : "text-gray-600 hover:text-gray-800",
                "rounded-md px-3 py-2 text-sm font-medium",
              ].join(" ")
            }
          >
            {tab.title}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ feature }} />
    </>
  );
}

export function DisplayFeatureVariations() {
  const { feature } = useOutletContext() as any;

  if (!feature.variations || feature.variations.length === 0) {
    return <p>n/a</p>;
  }

  return (
    <table className="min-w-full divide-y divide-gray-300 border border-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">Value</th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">Weight</th>
          {feature.variablesSchema && (
            <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
              Variables
            </th>
          )}
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Description
          </th>
        </tr>
      </thead>

      <tbody>
        {feature.variations.map((variation, index) => {
          return (
            <tr key={variation.value} className={index % 2 === 0 ? undefined : "bg-gray-50"}>
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700 ">
                {variation.type === "string" ? (
                  variation.value
                ) : (
                  <pre>
                    <code className="rounded bg-gray-100 px-2 py-1 text-red-400">
                      {JSON.stringify(variation.value)}
                    </code>
                  </pre>
                )}
              </td>
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                {variation.weight}%
              </td>

              {feature.variablesSchema && (
                <th className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                  {variation.variables && (
                    <ul className="list-inside list-disc text-left">
                      {variation.variables.map((v) => {
                        return (
                          <li key={v.key}>
                            <span className="font-semibold">{v.key}</span>:{" "}
                            {typeof v.value === "string" ? (
                              v.value
                            ) : (
                              <pre className="rounded bg-gray-100 px-2 py-1 text-red-400">
                                <code>{JSON.stringify(v.value, null, 2)}</code>
                              </pre>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </th>
              )}
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                {variation.description || <span>n/a</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DisplayFeatureVariablesSchema() {
  const { feature } = useOutletContext() as any;

  if (!feature.variablesSchema || feature.variablesSchema.length === 0) {
    return <p>n/a</p>;
  }

  return (
    <table className="min-w-full divide-y divide-gray-300 border border-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">Key</th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">Type</th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">Default</th>
          <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-500">
            Description
          </th>
        </tr>
      </thead>

      <tbody>
        {feature.variablesSchema.map((variableSchema, index) => {
          return (
            <tr key={variableSchema.key} className={index % 2 === 0 ? undefined : "bg-gray-50"}>
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                {variableSchema.key}
              </td>
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                {variableSchema.type}
              </td>
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                {variableSchema.type === "string" ? (
                  variableSchema.defaultValue
                ) : (
                  <pre>
                    <code className="rounded bg-gray-100 px-2 py-1 text-red-400">
                      {JSON.stringify(variableSchema.defaultValue, null, 2)}
                    </code>
                  </pre>
                )}
              </td>
              <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-700">
                {variableSchema.description || <span>n/a</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DisplayFeatureHistory() {
  const { feature } = useOutletContext() as any;

  return <HistoryTimeline entityType="feature" entityKey={feature.key} />;
}

export function ShowFeature() {
  const { featureKey } = useParams();
  const { data } = useSearchIndex();
  const feature = data?.entities.features.find((f) => f.key === featureKey);
  const links = data?.links;

  if (!feature) {
    return <p>Feature not found</p>;
  }

  const tabs = [
    {
      title: "Overview",
      to: `/features/${featureKey}`,
      end: true,
    },
    {
      title: "Variations",
      to: `/features/${featureKey}/variations`,
    },
    {
      title: "Variables",
      to: `/features/${featureKey}/variables`,
    },
    {
      title: "Rules",
      to: `/features/${featureKey}/rules`,
    },
    {
      title: "Force",
      to: `/features/${featureKey}/force`,
    },
    {
      title: "History",
      to: `/features/${featureKey}/history`,
    },
  ];

  return (
    <PageContent>
      <PageTitle className="relative border-none">
        Feature: {featureKey}{" "}
        {links && <EditLink url={links.feature.replace("{{key}}", feature.key)} />}
      </PageTitle>

      <Tabs tabs={tabs} />

      <div className="p-8">
        <Outlet context={{ feature }} />
      </div>
    </PageContent>
  );
}
