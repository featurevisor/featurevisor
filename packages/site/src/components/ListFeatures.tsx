import * as React from "react";

import { SearchIndexData } from "../contexts/SearchIndexContext";
import { useSearchIndex } from "../hooks/searchIndexHook";

export function ListFeatures() {
  const contextValue = useSearchIndex();
  const data = contextValue.data as SearchIndexData;
  const features = data.entities.features.sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div className="mx-auto max-w-7xl p-6 lg:px-8">
      <h1 className="text-5xl font-bold">Features</h1>

      <input
        type="text"
        name="search"
        id="q"
        className="block w-full rounded-md border-0 py-2 text-2xl text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        placeholder="you@example.com"
      />

      <table className="min-w-full divide-y divide-gray-300">
        <thead>
          <tr>
            <th
              scope="col"
              className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6 lg:pl-8"
            >
              Key
            </th>
            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
              Description
            </th>
            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
              -
            </th>
            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
              -
            </th>
            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6 lg:pr-8">
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody className="table-auto divide-y divide-gray-200 bg-white">
          {features.map((feature) => (
            <tr key={feature.key}>
              <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6 lg:pl-8">
                {feature.key}
              </td>
              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                {feature.description}
              </td>
              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">blah</td>
              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">blah</td>
              <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6 lg:pr-8">
                <a href="#" className="text-indigo-600 hover:text-indigo-900">
                  Edit<span className="sr-only">, blah</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
