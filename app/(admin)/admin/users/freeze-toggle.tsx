"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setUserFrozen } from "./actions";

export function FreezeToggle({ userId, isFrozen }: { userId: string; isFrozen: boolean }) {
  const [state, formAction, isPending] = useActionState(setUserFrozen, {});
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const wasPending = useRef(false);

  // useActionState gives no distinct "succeeded" signal beyond the absence
  // of an error once pending finishes — close the confirm form and clear
  // the reason on that transition so it doesn't sit open afterward.
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
        className="rounded-[8px] border border-line px-3 py-1.5 text-xs font-medium text-text-dim transition-colors hover:border-signal hover:text-text"
      >
        {isFrozen ? "Unfreeze" : "Freeze"}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="frozen" value={isFrozen ? "false" : "true"} />
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
          className={`rounded-[8px] px-2.5 py-1 text-xs font-semibold text-paper transition-colors disabled:opacity-60 ${
            isFrozen ? "bg-good hover:bg-good/90" : "bg-danger hover:bg-danger/90"
          }`}
        >
          {isPending ? "Saving…" : isFrozen ? "Confirm unfreeze" : "Confirm freeze"}
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
