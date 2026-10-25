export type Warm = {
  /** /warmer off. */
  isOff: boolean
  /** A turn of the main thread is running. */
  isWorking: boolean
  /** When the main thread's cache was last written or read, in `$.clock.now()` milliseconds. */
  lastRequestAt: number
  /** The model the main thread last answered with, for the price table. */
  model: string
  /** Input tokens of the last main-thread request: the size of the cached prefix. */
  contextTokens: number
  /** Pings since the person's last turn ended. */
  stretchPings: number
  /** What those pings cost. */
  stretchSpentUsd: number
  /** What coming back cold would have cost instead, at the context's size. */
  stretchColdUsd: number
  totalPings: number
  totalSpentUsd: number
  /** Why the last check pinged, skipped or stopped. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'cache-warmer': { warm: Warm }
  }
}
