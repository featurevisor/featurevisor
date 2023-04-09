import * as React from "react";

interface SearchInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function SearchInput(props: SearchInputProps) {
  return (
    <div className="relative px-6 pt-3.5">
      <div className="pointer-events-none absolute">
        <svg
          className="absolute ml-3 mt-5 h-6 w-6 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
            clip-rule="evenodd"
          />
        </svg>
      </div>
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e)}
        placeholder="Type to search..."
        autoComplete="off"
        className="mb-4 mt-2 w-full rounded-full border-slate-300 indent-8 text-xl text-gray-700 placeholder:text-gray-400"
      />
    </div>
  );
}
