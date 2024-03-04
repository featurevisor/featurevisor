import * as React from "react";
import { useSearch } from "../hooks/useSearch";

export function SearchInput() {
  const { searchQuery, setSearchQuery } = useSearch();

  return (
    <div className=" px-6 pt-3.5">
      <div className="pointer-events-none ">
        <svg
          className="absolute ml-3 mt-5 h-6 w-6 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Type to search..."
        autoComplete="off"
        className="mb-4 mt-2 p-2 w-full rounded-full border border-slate-300 indent-8 text-xl text-gray-700 placeholder:text-gray-400"
      />
    </div>
  );
}
