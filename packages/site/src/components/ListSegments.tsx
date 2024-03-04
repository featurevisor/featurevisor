import * as React from "react";
import { Link } from "react-router-dom";

import { Tag } from "./Tag";
import { Alert } from "./Alert";
import { SearchInput } from "./SearchInput";
import { PageTitle } from "./PageTitle";
import { PageContent } from "./PageContent";
import { LastModified } from "./LastModified";
import { useSearch } from "../hooks/useSearch";

export function ListSegments() {
  const { segments } = useSearch();
  const [displayCount, setDisplayCount] = React.useState(10);

  const loadMore = () => {
    setDisplayCount(displayCount + 10);
  };

  return (
    <PageContent>
      <PageTitle>Segments</PageTitle>

      <SearchInput />

      {segments.length === 0 && <Alert type="warning">No results found</Alert>}

      {segments.length > 0 && (
        <div>
          <ul className="diving-gray-200 divide-y">
            {segments.slice(0, displayCount).map((segment: any) => (
              <li key={segment.key}>
                <Link to={`/segments/${segment.key}`} className="block hover:bg-gray-50">
                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-md relative font-bold text-slate-600">
                        {segment.key}{" "}
                        {segment.archived && (
                          <span className="ml-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                            archived
                          </span>
                        )}
                      </p>

                      <div className="ml-2 flex flex-shrink-0 text-xs text-gray-500">
                        <div>
                          Used in: <Tag tag={`${segment.usedInFeatures.length} features`} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex justify-between">
                      <div className="flex">
                        <p className="line-clamp-3 max-w-md items-center text-sm text-gray-500">
                          {segment.description && segment.description.trim().length > 0
                            ? segment.description
                            : "n/a"}
                        </p>
                      </div>

                      <div className="items-top mt-2 flex text-xs text-gray-500 sm:mt-0">
                        <LastModified lastModified={segment.lastModified} />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* <p className="mt-6 text-center text-sm text-gray-500">
            A total of <span className="font-bold">{segments.length}</span> results found.
          </p> */}

          {displayCount < segments.length && (
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
