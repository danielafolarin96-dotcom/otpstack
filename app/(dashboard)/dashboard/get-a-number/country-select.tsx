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
    <div ref={containerRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-text transition-colors hover:border-signal focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:w-auto sm:min-w-[200px]"
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
          // At the trigger's own width (matching it via inset-x-0) rather
          // than a fixed w-72 on mobile: the trigger is full-width there
          // (see the button above), and it's always fully on-screen as a
          // normal-flow element, so a dropdown that never extends past its
          // bounds can't overflow the viewport either — no matter where a
          // wrapped flex row (justify-between with this as the sole
          // wrapped item) ends up placing the trigger. Reverts to the
          // original fixed-width, right-anchored popover from sm: up,
          // where there's room for it regardless of trigger position.
          className="absolute inset-x-0 z-10 mt-2 rounded-[14px] border border-line bg-paper-raised p-2 shadow-lg sm:inset-x-auto sm:right-0 sm:w-72"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries…"
            // text-base (16px) below sm:, not text-sm (14px): iOS Safari
            // auto-zooms the whole page in on focus of any input whose
            // computed font-size is under 16px, since our viewport meta
            // (width=device-width, initial-scale=1) doesn't set
            // maximum-scale to suppress it — that's deliberate, disabling
            // pinch-zoom site-wide would be an accessibility regression.
            // That zoom is what made the page look like it "expands" past
            // the device width on mobile, and, mid-zoom-animation, threw
            // off the tap coordinates for the dropdown list items below,
            // so a tap that should hit a partial match could miss — by
            // the time a full name was typed the zoom had settled and the
            // tap landed. Filtering itself was already instant substring
            // matching (see the includes() below); this is what actually
            // made it look broken on a real phone.
            className="mb-2 w-full rounded-[10px] border border-line bg-paper px-3.5 py-2 text-base text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
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
                  // onMouseDown (which also fires for touch taps), not just
                  // onClick: the search input above is auto-focused while
                  // open, and on mobile the first tap on a different
                  // element while an input is focused can get consumed
                  // just blurring/dismissing the keyboard rather than
                  // delivering a click — mousedown fires before that blur,
                  // so selecting there (with preventDefault to stop the
                  // button from stealing focus and triggering the blur
                  // race in the first place) makes the first tap reliable.
                  // onClick stays as a fallback for keyboard activation
                  // (Enter/Space) and is a harmless no-op redo on a normal
                  // desktop click, since selecting the same country twice
                  // is idempotent.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(c.id);
                  }}
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
