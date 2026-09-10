"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;

// Paystack's client-side redirect back to us only means checkout finished —
// per ARCHITECTURE.md, the wallet is credited by the webhook, not this
// redirect. This just re-fetches the server data a few times so the balance
// updates once that webhook has landed, without the user manually reloading.
export function PaymentStatusPoller({ reference }: { reference: string }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (attempts >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => {
      router.refresh();
      setAttempts((n) => n + 1);
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [attempts, router]);

  if (attempts >= MAX_ATTEMPTS) return null;

  return (
    <div className="rounded-[10px] border border-line bg-amber/10 px-4 py-3 text-sm text-amber">
      Confirming your payment ({reference})… this updates automatically.
    </div>
  );
}
