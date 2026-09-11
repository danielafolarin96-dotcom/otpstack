"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { refundOrder } from "./actions";

export function RefundButton({ orderId }: { orderId: string }) {
  const [state, formAction, isPending] = useActionState(refundOrder, {});
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
      setReason("");
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[8px] border border-line px-3 py-1.5 text-xs font-medium text-text-dim transition-colors hover:border-danger hover:text-danger"
      >
        Refund
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <input
        type="text"
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        required
        className="w-48 rounded-[8px] border border-line bg-paper px-2.5 py-1.5 text-xs text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
      />
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-[8px] bg-danger px-2.5 py-1 text-xs font-semibold text-paper transition-colors hover:bg-danger/90 disabled:opacity-60"
        >
          {isPending ? "Refunding…" : "Confirm refund"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          className="rounded-[8px] px-2.5 py-1 text-xs font-medium text-text-dim hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
