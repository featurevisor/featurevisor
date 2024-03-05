import * as React from "react";
import { Link } from "react-router-dom";

import { Tag } from "./Tag";
import { Alert } from "./Alert";
import { SearchInput } from "./SearchInput";
import { PageTitle } from "./PageTitle";
import { PageContent } from "./PageContent";
import { LastModified } from "./LastModified";
import { useSearch } from "../hooks/useSearch";

export function ListAttributes() {
  const { attributes } = useSearch();
  const [displayCount, setDisplayCount] = React.useState(10);

  const loadMore = () => {
    setDisplayCount(displayCount + 10);
  };

  return (
    <PageContent>
      <PageTitle>Attributes</PageTitle>

      <SearchInput />

      {attributes.length === 0 && <Alert type="warning">No results found</Alert>}

      {attributes.length > 0 && (
        <div>
          <ul className="diving-gray-200 divide-y">
            {attributes.slice(0, displayCount).map((attribute: any) => (
              <li key={attribute.key}>
                <Link to={`/attributes/${attribute.key}`} className="block hover:bg-gray-50">
                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-md relative font-bold text-slate-600">
                        {attribute.key}{" "}
                        {attribute.capture && (
                          <span className="ml-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                            capture
                          </span>
                        )}
                        {attribute.archived && (
                          <span className="ml-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                            archived
                          </span>
                        )}
                      </p>

                      <div className="ml-2 flex flex-shrink-0 text-xs text-gray-500">
                        <div>
                          Used in: <Tag tag={`${attribute.usedInSegments.length} segments`} />{" "}
                          <Tag tag={`${attribute.usedInFeatures.length} features`} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex justify-between">
                      <div className="flex">
                        <p className="line-clamp-3 max-w-md items-center text-sm text-gray-500">
                          {attribute.description && attribute.description.trim().length > 0
                            ? attribute.description
                            : "n/a"}
                        </p>
                      </div>

                      <div className="items-top mt-2 flex text-xs text-gray-500 sm:mt-0">
                        <LastModified lastModified={attribute.lastModified} />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* <p className="mt-6 text-center text-sm text-gray-500">
            A total of <span className="font-bold">{attributes.length}</span> results found.
          </p> */}

          {displayCount < attributes.length && (
            <div className="px-6">
              <button
                className="w-full text-md block rounded-md border border-gray-300 bg-gray-50 py-2 pl-6 text-center font-bold text-gray-500 shadow-sm hover:bg-gray-100"
                onClick={() => {
                  loadMore();
                }}
              >
                Load more
              </button>
            </div>
          )}

        </div>
      )}
    </PageContent>
  );
}
