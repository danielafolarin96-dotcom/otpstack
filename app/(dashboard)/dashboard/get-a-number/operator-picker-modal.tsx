"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface OperatorOption {
  operator: string;
  priceKobo: number;
  ratePct: number | null;
}

function formatNairaWhole(kobo: number) {
  return Math.round(kobo / 100).toLocaleString("en-NG");
}

function RateBadge({ ratePct }: { ratePct: number | null }) {
  if (ratePct === null) {
    return (
      <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs font-medium text-text-dim">
        New / unrated
      </span>
    );
  }
  return (
    <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs font-medium text-text-dim">
      {Math.round(ratePct)}% delivered
    </span>
  );
}

// Opened from BuyableCatalogGrid when a customer taps "Buy" on a service —
// replaces the old immediate POST /api/orders with a choice step: fetch
// every real operator option for this (service, country) from
// /api/catalog/operators (backed by lib/pricing/catalog.ts's
// computeOperatorPrices), let the customer pick one (pre-selected to the
// recommended option so a quick "Buy" still works with one tap), and only
// purchase the exact operator they confirmed.
export function OperatorPickerModal({
  serviceId,
  serviceName,
  countryId,
  onClose,
  onPurchased,
}: {
  serviceId: string;
  serviceName: string;
  countryId: string;
  onClose: () => void;
  onPurchased: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<OperatorOption[]>([]);
  const [recommendedOperator, setRecommendedOperator] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/catalog/operators?serviceId=${encodeURIComponent(serviceId)}&countryId=${encodeURIComponent(countryId)}`,
        );
        const json = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setLoadError(json.error ?? "Couldn't load options. Try again.");
          return;
        }
        setOptions(json.options ?? []);
        setRecommendedOperator(json.recommended?.operator ?? null);
        setSelected(json.recommended?.operator ?? json.options?.[0]?.operator ?? null);
      } catch {
        if (!cancelled) setLoadError("Couldn't reach the server. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [serviceId, countryId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleConfirm() {
    if (!selected) return;
    setPurchaseError(null);
    setBuying(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, countryId, operator: selected }),
      });
      const json = await response.json();

      if (!response.ok) {
        setPurchaseError(json.error ?? "Purchase failed.");
        setBuying(false);
        return;
      }

      onPurchased();
      router.push("/dashboard");
      router.refresh();
    } catch {
      setPurchaseError("Couldn't reach the server. Try again.");
      setBuying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-5"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose an operator for ${serviceName}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col gap-4 rounded-t-[18px] border border-line bg-paper-raised p-5 sm:max-w-md sm:rounded-[18px]"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Choose an operator — {serviceName}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-text-dim transition-colors hover:bg-paper hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-text-dim">Loading options…</p>}

        {!loading && loadError && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-danger">{loadError}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line px-4 py-2 text-sm font-medium text-text"
            >
              Close
            </button>
          </div>
        )}

        {!loading && !loadError && options.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-text-dim">
              No operators currently available for {serviceName} here — try another service.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line px-4 py-2 text-sm font-medium text-text"
            >
              Close
            </button>
          </div>
        )}

        {!loading && !loadError && options.length > 0 && (
          <>
            <div role="radiogroup" className="flex flex-col gap-2 overflow-y-auto">
              {options.map((option) => {
                const isSelected = selected === option.operator;
                const isRecommended = option.operator === recommendedOperator;
                return (
                  <button
                    key={option.operator}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(option.operator)}
                    className={`flex items-center justify-between gap-3 rounded-[14px] border p-3 text-left transition-colors ${
                      isSelected ? "border-signal bg-paper" : "border-line hover:bg-paper"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{option.operator}</span>
                        {isRecommended && (
                          <span className="rounded-full bg-signal/15 px-2 py-0.5 text-xs font-semibold text-signal-text">
                            Recommended
                          </span>
                        )}
                      </div>
                      <RateBadge ratePct={option.ratePct} />
                    </div>
                    <span className="font-technical text-sm font-bold text-signal-text">
                      ₦{formatNairaWhole(option.priceKobo)}
                    </span>
                  </button>
                );
              })}
            </div>

            {purchaseError && (
              <p className="rounded-[10px] border border-line bg-danger/10 px-4 py-3 text-sm text-danger">
                {purchaseError}
              </p>
            )}

            <button
              type="button"
              disabled={!selected || buying}
              onClick={handleConfirm}
              className="w-full rounded-[10px] bg-signal-button px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-signal-dark disabled:opacity-50"
            >
              {buying ? "Buying…" : "Buy"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
