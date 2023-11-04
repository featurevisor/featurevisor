import * as React from "react";
import { Link } from "react-router-dom";
import { UserCircleIcon } from "@heroicons/react/20/solid";

import { Alert } from "./Alert";
import { PrettyDate } from "./PrettyDate";
import { useSearchIndex } from "../hooks/useSearchIndex";

const entriesPerPage = 50;
const initialMaxEntitiesCount = 10;

function Activity(props) {
  const { entry, links } = props;
  const [showAll, setShowAll] = React.useState(false);

  const entitiesToRender = showAll
    ? entry.entities
    : entry.entities.slice(0, initialMaxEntitiesCount);

  return (
    <>
      <span className="font-semibold text-gray-600">{entry.author}</span> updated{" "}
      {entry.entities.length === 1 ? (
        <>
          {entry.entities[0].type}{" "}
          <Link
            to={`/${entry.entities[0].type}s/${entry.entities[0].key}`}
            className="font-semibold text-gray-600"
          >
            {entry.entities[0].key}
          </Link>
        </>
      ) : (
        ""
      )}{" "}
      on{" "}
      <a
        href={links ? links.commit.replace("{{hash}}", entry.commit) : `#${entry.commit}`}
        target="_blank"
        className="font-semibold text-gray-600"
      >
        <PrettyDate date={entry.timestamp} showTime={props.showTime} />
      </a>
      {entry.entities.length > 1 && (
        <>
          <span>:</span>
          <ul className="list-disc pl-3.5 pt-2 text-gray-400 marker:text-gray-400">
            {entitiesToRender.map((entity, index) => {
              return (
                <li key={index}>
                  <span className="text-gray-400">{entity.type}</span>{" "}
                  <Link
                    to={`/${entity.type}s/${entity.key}`}
                    className="font-semibold text-gray-500"
                  >
                    {entity.key}
                  </Link>
                </li>
              );
            })}

            {!showAll && entry.entities.length > initialMaxEntitiesCount && (
              <li key="show-all">
                <a
                  href="javascript:void(0)"
                  className="font-bold underline"
                  onClick={() => {
                    setShowAll(true);
                  }}
                >
                  Show all
                </a>
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );
}

interface HistoryTimelineProps {
  className?: string;
  filter?: (entry: any) => boolean;
  entityType?: string;
  entityKey?: string;
  showTime?: boolean;
}

export function HistoryTimeline(props: HistoryTimelineProps) {
  const { data } = useSearchIndex();
  const links = data?.links;
  const [historyEntries, setHistoryEntries] = React.useState([]);

  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    fetch("/history-full.json")
      .then((res) => res.json())
      .then((data) => {
        const filteredHistoryEntries = data.filter((entry: any) => {
          if (props.filter) {
            return props.filter(entry);
          }

          if (props.entityType && props.entityKey) {
            return entry.entities.some(
              (entity: any) => entity.type === props.entityType && entity.key === props.entityKey,
            );
          }

          return true;
        });

        setHistoryEntries(filteredHistoryEntries);
      });
  }, []);

  const entriesToRender = historyEntries.slice(0, page * entriesPerPage);

  return (
    <div className={props.className || ""}>
      {entriesToRender.length === 0 && <Alert type="warning">No history found.</Alert>}

      {entriesToRender.length > 0 && (
        <div>
          <ul className="mt-8">
            <li>
              {entriesToRender.slice(0, page * entriesPerPage).map((entry: any, index) => {
                const isNotLast = entriesToRender.length !== index + 1;

                return (
                  <div className="relative pb-8">
                    {isNotLast ? (
                      <span className="absolute left-4 top-5 -ml-px h-full w-0.5 bg-gray-200" />
                    ) : (
                      ""
                    )}
                    <div className="relative flex space-x-3">
                      <div>
                        <div className="relative">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 ring-4 ring-white">
                            <UserCircleIcon className="h-5 w-5 text-gray-500" />
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 py-1.5">
                        <div className="text-sm text-gray-500">
                          <Activity entry={entry} showTime={props.showTime} links={links} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </li>
          </ul>

          {historyEntries.length > entriesToRender.length && (
            <a
              href="javascript:void(0)"
              className="text-md block rounded-md border border-gray-300 bg-gray-50 py-2 pl-6 text-center font-bold text-gray-500 shadow-sm hover:bg-gray-100"
              onClick={() => {
                setPage(page + 1);
              }}
            >
              Load more
            </a>
          )}
        </div>
      )}
    </div>
  );
}
