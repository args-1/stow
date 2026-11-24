import type { LinkSort } from '@stow/core';
import { inputClass } from '@stow/ui';
import { Search } from 'lucide-react';

const SORTS: { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'alpha', label: 'A–Z' },
  { value: 'visits', label: 'Most visited' },
];

export interface ToolbarProps {
  search: string;
  onSearchChange(search: string): void;
  sort: LinkSort;
  onSortChange(sort: LinkSort): void;
}

export function Toolbar({ search, onSearchChange, sort, onSortChange }: ToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          aria-label="Search links"
          placeholder="Search, or #tag"
          className={`${inputClass} pl-9`}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="w-36 shrink-0">
        <select
          aria-label="Sort"
          className={inputClass}
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LinkSort)}
        >
          {SORTS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
