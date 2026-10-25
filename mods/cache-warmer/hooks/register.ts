// cache-warmer: keeps a big session's prompt cache warm while the person is away.
// A few minutes before the cache would expire, one tool-less fork over the transcript as
// the main thread last sent it reads the cached prefix back, which restarts the cache's
// clock for a fraction of what re-sending the whole context cold would cost.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Warm } from '../types'

export const CHECK_MS = 20_000
const PING_PROMPT = 'Reply with only the word ok.'

const DEFAULTS = { ttlMinutes: 60, leadMinutes: 4, maxHours: 4, minTokens: 100_000 }

const blank = (): Warm => ({
  isOff: false,
  isWorking: false,
  lastRequestAt: 0,
  model: '',
  contextTokens: 0,
  stretchPings: 0,
  stretchSpentUsd: 0,
  stretchColdUsd: 0,
  totalPings: 0,
  totalSpentUsd: 0,
  note: '',
})

const warm = atom({ plugin: 'cache-warmer', key: 'warm' } as const, blank())

// USD per million tokens: input, output, cache read, cache write. An estimate, not a bill.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const priceOf = (model: string): [number, number, number, number] => PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

export const costOf = (model: string, u: Usage): number => {
  const [i, o, r, w] = priceOf(model)
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
}

/** What a cold return costs beyond a warm one: the prefix written at cache-write price instead of read at cache-read price. */
export const coldPenaltyOf = (model: string, tokens: number): number => {
  const [, , r, w] = priceOf(model)
  return (tokens * (w - r)) / 1e6
}

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

export const statusOf = (w: Warm): string | undefined => {
  if (w.isOff) return 'cache-warmer off'
  if (w.stretchPings === 0) return undefined
  const saved = Math.max(0, w.stretchColdUsd - w.stretchSpentUsd)
  return `cache warm · ${w.stretchPings} ping${w.stretchPings === 1 ? '' : 's'} · ≈${fmtCost(w.stretchSpentUsd)} · ≈${fmtCost(saved)} saved if you come back`
}

type Options = { ttlMs: number; leadMs: number; maxPings: number; minTokens: number }

/** One check of the clock: pings when the cache is about to lapse and it is worth it. */
async function check($: EngineInterface, o: Options): Promise<void> {
  const w = await read($, warm)
  if (w.isOff || w.isWorking || w.lastRequestAt === 0) return
  const now = await $.clock.now()
  const expiresAt = w.lastRequestAt + o.ttlMs
  if (now < expiresAt - o.leadMs) return
  if (now >= expiresAt) {
    // A run the cap or a miss ended keeps that reason; otherwise say the cache lapsed.
    if (w.note !== 'cold' && w.note !== 'cap' && w.note !== 'miss') await update($, warm, p => ({ ...p, note: 'cold' }))
    return
  }
  if (w.stretchPings >= o.maxPings) {
    // A miss also ends the run; its reason is the more useful one to keep.
    if (w.note !== 'cap' && w.note !== 'miss') await update($, warm, p => ({ ...p, note: 'cap' }))
    return
  }
  let tokens = w.contextTokens
  try {
    const usage = await $.session.usage()
    if (typeof usage.context.tokens === 'number' && usage.context.tokens > 0) tokens = usage.context.tokens
  } catch {
    // keep the last known size
  }
  if (tokens < o.minTokens) {
    if (w.note !== 'small') await update($, warm, p => ({ ...p, note: 'small' }))
    return
  }

  const reply = await $.model.fork({ prompt: PING_PROMPT })
  if (!reply.isAnswered) {
    await update($, warm, p => ({ ...p, note: `ping failed: ${reply.reason}` }))
    $.ui.log(`cache-warmer: ping failed (${reply.reason})`, { to: 'debug' })
    return
  }
  const model = w.model || 'claude-opus-5-5'
  const cost = costOf(model, reply.usage)
  const served = reply.usage.cache_read_input_tokens || 0
  const isMiss = served < tokens * 0.5
  const cold = coldPenaltyOf(model, tokens)
  const next = await update($, warm, p => ({
    ...p,
    lastRequestAt: now,
    contextTokens: tokens,
    // A miss paid for the prefix in full, so it is warm now, but another miss would pay again: stop here.
    stretchPings: isMiss ? o.maxPings : p.stretchPings + 1,
    stretchSpentUsd: p.stretchSpentUsd + cost,
    stretchColdUsd: cold,
    totalPings: p.totalPings + 1,
    totalSpentUsd: p.totalSpentUsd + cost,
    note: isMiss ? 'miss' : 'pinged',
  }))
  $.ui.log(
    isMiss
      ? `cache-warmer: the ping missed the cache (${fmtTokens(served)} of ${fmtTokens(tokens)} served), paid ≈${fmtCost(cost)}; no more pings until your next message`
      : `cache-warmer: pinged, ${fmtTokens(served)} read from cache for ≈${fmtCost(cost)}`,
  )
  if (next) $.ui.status(statusOf(next))
}

export const register: Register = (on, options) => {
  const num = (key: keyof typeof DEFAULTS): number => {
    const v = Number(options[key])
    return Number.isFinite(v) && v > 0 ? v : DEFAULTS[key]
  }
  const opts = (): Options => {
    const ttlMinutes = num('ttlMinutes')
    return {
      ttlMs: ttlMinutes * 60_000,
      leadMs: Math.min(num('leadMinutes'), ttlMinutes / 2) * 60_000,
      maxPings: Math.max(1, Math.floor((num('maxHours') * 60) / ttlMinutes)),
      minTokens: num('minTokens'),
    }
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'warmer',
      description: 'Cache warmer: /warmer shows what it has done; /warmer off and /warmer on switch it',
    })
    // Nobody is away in a headless run.
    if (!e.isInteractive) return started
    const now = await $.clock.now()
    await update($, warm, p => ({ ...blank(), isOff: p.isOff, totalPings: p.totalPings, totalSpentUsd: p.totalSpentUsd, lastRequestAt: now }))
    $.clock.every(CHECK_MS, () => {
      void check($, opts())
    })
    return started
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await update($, warm, p => ({ ...p, isWorking: true }))
    return next(e)
  })

  // Each main-thread request rewrites the cache; its input size is the prefix a ping would read.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId) return result
    const u = result.usage
    const now = await $.clock.now()
    await update($, warm, p => ({
      ...p,
      lastRequestAt: now,
      model: u?.model || e.model || p.model,
      contextTokens: u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : p.contextTokens,
    }))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      const w = await update($, warm, p => ({ ...p, isWorking: false, lastRequestAt: now, stretchPings: 0, stretchSpentUsd: 0, stretchColdUsd: 0, note: '' }))
      if (w) $.ui.status(statusOf(w))
    }
    return next(e)
  })

  on('command.run', { command: 'warmer' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      const w = await update($, warm, p => ({ ...p, isOff: arg === 'off' }))
      if (w) $.ui.status(statusOf(w))
      return { text: arg === 'off' ? 'Cache warmer off. /warmer on turns it back on.' : 'Cache warmer on.' }
    }
    const w = await read($, warm)
    const o = opts()
    const now = await $.clock.now()
    const left = w.lastRequestAt ? Math.max(0, Math.round((w.lastRequestAt + o.ttlMs - now) / 60_000)) : 0
    const why: Record<string, string> = {
      cold: 'the cache went cold before a ping was due',
      cap: `the idle cap of ${num('maxHours')}h was reached`,
      small: `the context is under ${fmtTokens(o.minTokens)} tokens`,
      miss: 'the last ping missed the cache, so pinging stopped',
      pinged: 'the last ping was served from cache',
    }
    return {
      text:
        `Cache warmer ${w.isOff ? 'off' : 'on'} · cache has about ${left} min left · context ${fmtTokens(w.contextTokens)} tokens · ` +
        `this stretch ${w.stretchPings} ping${w.stretchPings === 1 ? '' : 's'} (≈${fmtCost(w.stretchSpentUsd)}) · session ${w.totalPings} ping${w.totalPings === 1 ? '' : 's'} (≈${fmtCost(w.totalSpentUsd)})` +
        (w.note ? ` · ${why[w.note] ?? w.note}` : ''),
    }
  })
}
