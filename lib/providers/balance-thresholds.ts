// Below this USD balance, the Overview page's balance cards flag the
// provider as low so it gets noticed before a purchase actually fails on
// insufficient upstream balance. Both providers are funded in small
// increments in practice -- Grizzly's own minimum deposit is $3, and 5sim
// has historically been topped up a few dollars at a time (see
// claude/provider-evaluation.md's "never hold a large balance with any
// provider" note) -- so $5 gives a bit of runway rather than firing right
// at $0.
export const LOW_BALANCE_THRESHOLD_USD = {
  "5sim": 5,
  grizzly: 5,
} as const;

export type BalanceProvider = keyof typeof LOW_BALANCE_THRESHOLD_USD;

export function isLowBalance(provider: BalanceProvider, balanceUsd: number): boolean {
  return balanceUsd <= LOW_BALANCE_THRESHOLD_USD[provider];
}
