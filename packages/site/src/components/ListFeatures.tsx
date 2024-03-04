import * as React from "react";
import { Link } from "react-router-dom";

import { TagIcon } from "@heroicons/react/20/solid";

import { EnvironmentDot } from "./EnvironmentDot";
import { Tag } from "./Tag";
import { Alert } from "./Alert";
import { SearchInput } from "./SearchInput";
import { PageTitle } from "./PageTitle";
import { PageContent } from "./PageContent";
import { LastModified } from "./LastModified";
import { useSearch } from "../hooks/useSearch";


export function ListFeatures() {
  const { features } = useSearch();
  const [displayCount, setDisplayCount] = React.useState(10);

  const loadMore = () => {
    setDisplayCount(displayCount + 10);
  };

  return (
    <PageContent>
      <PageTitle>Features</PageTitle>

      <SearchInput />

      {features.length === 0 && <Alert type="warning">No results found</Alert>}

      {features.length > 0 && (
        <div>
          <ul className="diving-gray-200 divide-y">
            {features.slice(0, displayCount).map((feature: any) => (
              <li key={feature.key}>
                <Link to={`/features/${feature.key}`}>
                  <div className="block hover:bg-gray-50">
                    <div className="px-6 py-4">
                      <div className="flex items-center justify-between">
                        <span className="text-md relative font-bold text-slate-600">
                          <EnvironmentDot
                            feature={feature}
                            className="relative top-[0.5px] inline-block pr-2"
                          />{" "}
                          {/* <a href="#" className="font-bold"> */}
                            {feature.key}
                          {/* </a>{" "} */}
                          {feature.archived && (
                            <span className="ml-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium
                             text-red-800">
                              archived
                            </span>
                          )}
                        </span>

                        <div className="ml-2 flex flex-shrink-0">
                          <div>
                            <TagIcon className="inline-block h-6 w-6 pr-1 text-xs text-gray-400" />
                            {feature.tags.map((tag: string) => (
                              <Tag tag={tag} key={tag} />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex justify-between">
                        <div className="flex">
                          <p className="line-clamp-3 max-w-md items-center pl-6 text-sm text-gray-500">
                            {feature.description && feature.description.trim().length > 0
                              ? feature.description
                              : "n/a"}
                          </p>
                        </div>

                        <div className="items-top mt-2 flex text-xs text-gray-500 sm:mt-0">
                          <LastModified lastModified={feature.lastModified} />
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* <p className="mt-6 text-center text-sm text-gray-500">
            A total of <span className="font-bold">{features.length}</span> results found.
          </p> */}
          {displayCount < features.length && (
            <button
            className="w-full text-md block rounded-md border border-gray-300 bg-gray-50 py-2 pl-6 text-center font-bold text-gray-500 shadow-sm hover:bg-gray-100"
            onClick={() => {
              loadMore();
            }}
          >
            Load more
          </button>
          )}

        </div>
      )}
    </PageContent>
  );
}
