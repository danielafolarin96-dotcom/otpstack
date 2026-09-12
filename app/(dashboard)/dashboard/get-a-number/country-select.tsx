"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Country {
  id: string;
  name: string;
  flagEmoji: string;
}

// A searchable dropdown instead of a native <select> — at 80 countries,
// scrolling through a plain option list to find one was the reported
// problem. This search is scoped to the country picker only; the
// separate search in ServiceCatalogGrid is services/apps only.
export function CountrySelect({
  countries,
  selectedId,
}: {
  countries: Country[];
  selectedId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = countries.find((c) => c.id === selectedId);

  useEffect(() => {
    if (!open) return;
    searchInputRef.current?.focus();

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleSelect(id: string) {
    setOpen(false);
    setQuery("");
    const params = new URLSearchParams(searchParams.toString());
    params.set("country", id);
    router.push(`/dashboard/get-a-number?${params.toString()}`);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? countries.filter((c) => c.name.toLowerCase().includes(normalizedQuery))
    : countries;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-w-[200px] items-center justify-between gap-2 rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-text transition-colors hover:border-signal focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
      >
        <span>{selected ? `${selected.flagEmoji} ${selected.name}` : "Select a country"}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-text-dim"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-10 mt-2 w-72 rounded-[14px] border border-line bg-paper-raised p-2 shadow-lg"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries…"
            className="mb-2 w-full rounded-[10px] border border-line bg-paper px-3.5 py-2 text-sm text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
          />
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-text-dim">No countries match.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === selectedId}
                  onClick={() => handleSelect(c.id)}
                  className={`block w-full rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-colors ${
                    c.id === selectedId
                      ? "bg-ink text-paper"
                      : "text-text-dim hover:bg-paper hover:text-text"
                  }`}
                >
                  {c.flagEmoji} {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
