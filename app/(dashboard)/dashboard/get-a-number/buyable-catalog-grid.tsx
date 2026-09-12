"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ServiceCatalogGrid, type CatalogGridEntry } from "@/components/catalog/service-catalog-grid";

export function BuyableCatalogGrid({
  entries,
  countryId,
}: {
  entries: CatalogGridEntry[];
  countryId: string;
}) {
  const router = useRouter();
  const [buyingServiceId, setBuyingServiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(serviceId: string) {
    setError(null);
    setBuyingServiceId(serviceId);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, countryId }),
      });
      const json = await response.json();

      if (!response.ok) {
        setError(json.error ?? "Purchase failed.");
        setBuyingServiceId(null);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
      setBuyingServiceId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-[10px] border border-line bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ServiceCatalogGrid entries={entries} onBuy={handleBuy} buyingServiceId={buyingServiceId} />
    </div>
  );
}
