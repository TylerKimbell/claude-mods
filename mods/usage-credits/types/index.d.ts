/** The account's usage credits, as the usage endpoint's `extra_usage` block reports them. */
export type Credits = {
  /** Spent so far this month, in minor units (cents for USD); absent when not reported. */
  usedMinor?: number
  /** The monthly spend limit, in minor units; absent when the limit is unlimited. */
  limitMinor?: number
  /** Minor units per major unit, as a power of ten: 2 for cents. */
  exponent: number
  currency: string
  /** Percent of the monthly limit spent, 0 to 100; absent with no limit. */
  percent?: number
  isEnabled: boolean
  isLimitReached: boolean
  /** The prepaid credit balance, in minor units, as the account's billing page shows it; absent when it could not be read. */
  balanceMinor?: number
  /** When this reading was fetched, in `$.clock.now()` milliseconds. */
  fetchedAt: number
}

export type View = {
  isHidden: boolean
  /** The last error the refresh hit, shown dim beside a stale reading; empty when the last refresh worked. */
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-credits': {
      credits: Credits | null
      view: View
    }
  }
}
