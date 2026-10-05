"use client";

import { useState } from "react";
import { ServiceCatalogGrid, type CatalogGridEntry } from "@/components/catalog/service-catalog-grid";
import { OperatorPickerModal } from "./operator-picker-modal";

// handleBuy used to POST /api/orders immediately with whatever operator
// getProductPrices had auto-picked server-side. It now just opens the
// operator picker for that service — the actual purchase (and the
// operator choice itself) happens inside OperatorPickerModal, which POSTs
// /api/orders with the customer's confirmed choice.
export function BuyableCatalogGrid({
  entries,
  countryId,
  initialQuery,
}: {
  entries: CatalogGridEntry[];
  countryId: string;
  initialQuery?: string;
}) {
  const [pickerService, setPickerService] = useState<{ id: string; name: string } | null>(null);

  function handleBuy(serviceId: string) {
    const entry = entries.find((e) => e.service.id === serviceId);
    if (!entry) return;
    setPickerService({ id: entry.service.id, name: entry.service.name });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* No buyingServiceId here — the picker modal (which fully covers the
          grid once open) owns all in-flight-purchase UI now, so the tile
          itself never needs to show "Buying…" before anything is actually
          in flight. */}
      <ServiceCatalogGrid entries={entries} onBuy={handleBuy} initialQuery={initialQuery} />

      {pickerService && (
        <OperatorPickerModal
          serviceId={pickerService.id}
          serviceName={pickerService.name}
          countryId={countryId}
          onClose={() => setPickerService(null)}
          onPurchased={() => setPickerService(null)}
        />
      )}
    </div>
  );
}
