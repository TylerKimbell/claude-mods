// usage-credits: the account's usage credits (what Fable draws on once the plan limits are
// hit) above the prompt, read from the same account endpoint the app's usage page reads,
// through the session's own credential. The mod never sees the token.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Credits, View } from '../types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const STORE_LAST = 'last'
const STORE_WARNED = 'warnedAt'
const MIN_REFRESH_MS = 5 * 60_000
const BACKOFF_MS = 15 * 60_000
const DEFAULT_POLL_MINUTES = 10
const DEFAULT_WARN_AT = 80

const credits = atom({ plugin: 'usage-credits', key: 'credits' } as const, null as Credits | null)
const view = atom({ plugin: 'usage-credits', key: 'view' } as const, { isHidden: false, error: '' } as View)

const GREEN = '#5fbf8f'
const AMBER = '#d9a441'
const RED = '#e5484d'

// ---------------------------------------------------------------------------
// Reading the endpoint

type ExtraUsage = {
  is_enabled?: boolean
  monthly_limit?: number | null
  used_credits?: number | null
  utilization?: number | null
  currency?: string | null
  decimal_places?: number | null
  spend_limit_reached?: boolean | null
}

type Spend = {
  used?: { amount_minor?: number; currency?: string; exponent?: number } | null
  limit?: { amount_minor?: number; currency?: string; exponent?: number } | null
  percent?: number | null
  enabled?: boolean | null
}

/** Pulls the credit figures out of the endpoint's JSON, or null when it carries none. */
export const parseCredits = (text: string, at: number): Credits | null => {
  let body: { extra_usage?: ExtraUsage | null; spend?: Spend | null }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return null
  }
  const x = body.extra_usage
  const s = body.spend
  // An unlimited monthly limit comes back as null: the limit fields are then left out.
  if (x && typeof x === 'object') {
    const limit = typeof x.monthly_limit === 'number' && x.monthly_limit > 0 ? x.monthly_limit : undefined
    const used = typeof x.used_credits === 'number' ? x.used_credits : undefined
    return {
      ...(used !== undefined ? { usedMinor: used } : {}),
      ...(limit !== undefined ? { limitMinor: limit, percent: typeof x.utilization === 'number' ? x.utilization : ((used ?? 0) / limit) * 100 } : {}),
      exponent: typeof x.decimal_places === 'number' ? x.decimal_places : 2,
      currency: x.currency || 'USD',
      isEnabled: x.is_enabled !== false,
      isLimitReached: limit !== undefined && x.spend_limit_reached === true,
      fetchedAt: at,
    }
  }
  if (s && typeof s === 'object') {
    const limit = s.limit && typeof s.limit.amount_minor === 'number' && s.limit.amount_minor > 0 ? s.limit.amount_minor : undefined
    const used = s.used && typeof s.used.amount_minor === 'number' ? s.used.amount_minor : undefined
    if (limit === undefined && used === undefined) return null
    return {
      ...(used !== undefined ? { usedMinor: used } : {}),
      ...(limit !== undefined ? { limitMinor: limit, percent: typeof s.percent === 'number' ? s.percent : ((used ?? 0) / limit) * 100 } : {}),
      exponent: s.limit?.exponent ?? s.used?.exponent ?? 2,
      currency: s.limit?.currency || s.used?.currency || 'USD',
      isEnabled: s.enabled !== false,
      isLimitReached: limit !== undefined && (used ?? 0) >= limit,
      fetchedAt: at,
    }
  }
  return null
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

export const fmtMoney = (minor: number, exponent: number, currency: string): string => {
  const major = minor / Math.pow(10, exponent)
  const sym = SYMBOL[currency] ?? `${currency} `
  const isWhole = Math.abs(major - Math.round(major)) < 1e-9
  return `${sym}${isWhole ? Math.round(major).toString() : major.toFixed(exponent)}`
}

/** What the monthly limit still allows this month, in minor units; 0 with no limit. */
export const leftOf = (c: Credits): number => (c.limitMinor === undefined ? 0 : Math.max(0, c.limitMinor - (c.usedMinor ?? 0)))

const money = (c: Credits, minor: number): string => fmtMoney(minor, c.exponent, c.currency)

const pct = (c: Credits): string => `${Math.round(c.percent ?? 0)}%`

/** The status line under the prompt: the dollars left, and a flag only when something stops spending. */
export const statusText = (c: Credits): string | undefined => {
  const flags = `${c.isLimitReached ? ' · monthly limit reached' : ''}${c.isEnabled ? '' : ' · credits off'}`
  if (c.balanceMinor !== undefined) return `Credits ${money(c, c.balanceMinor)} left${flags}`
  if (c.limitMinor !== undefined) return `Credits ${money(c, leftOf(c))} left of ${money(c, c.limitMinor)} · ${pct(c)}${flags}`
  return undefined
}

/** The longer line for /credits and the optional band row. */
export const summary = (c: Credits): string => {
  const month =
    c.limitMinor !== undefined
      ? `this month ${money(c, c.usedMinor ?? 0)} of ${money(c, c.limitMinor)} monthly limit (${pct(c)})`
      : `no monthly limit${c.usedMinor !== undefined ? `, ${money(c, c.usedMinor)} spent this month` : ''}`
  if (c.balanceMinor !== undefined) return `${money(c, c.balanceMinor)} left · ${month}`
  if (c.limitMinor !== undefined) return `${money(c, leftOf(c))} left of ${money(c, c.limitMinor)} · ${pct(c)} used`
  return `balance not available · ${month}`
}

/** The prepaid balance from the billing endpoint's answer, in minor units, or null. */
export const parseBalance = (text: string): number | null => {
  try {
    const body = JSON.parse(text) as { amount?: unknown }
    return typeof body.amount === 'number' ? body.amount : null
  } catch {
    return null
  }
}

/** The organization's id from the profile endpoint's answer, or null. */
export const parseOrgId = (text: string): string | null => {
  try {
    const body = JSON.parse(text) as { organization?: { uuid?: unknown } | null }
    const id = body.organization?.uuid
    return typeof id === 'string' && /^[A-Za-z0-9-]+$/.test(id) ? id : null
  } catch {
    return null
  }
}

const colorOf = (c: Credits, warnAt: number): string => {
  const p = c.percent ?? 0
  return c.isLimitReached || !c.isEnabled || p >= 95 ? RED : p >= warnAt ? AMBER : GREEN
}

const fmtAgo = (ms: number): string => {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

// ---------------------------------------------------------------------------
// Refreshing. Module scope is fine for the in-flight flag: a reload starts it over.

let isRefreshing = false
// After a 429 the endpoint is left alone until this time.
let backoffUntil = 0

type RefreshOptions = { isForced: boolean; warnAt: number }

/** One toast when usage first crosses the warn level, one more at 95; re-armed when it drops below. */
async function warnIfCrossed($: EngineInterface, c: Credits, warnAt: number): Promise<void> {
  // No monthly limit, nothing to warn about: the level re-arms at 0.
  const p = c.percent ?? 0
  const level = c.limitMinor === undefined ? 0 : c.isLimitReached || p >= 95 ? 95 : p >= warnAt ? warnAt : 0
  const warned = Number((await $.store.get(STORE_WARNED)) ?? 0)
  if (level === warned) return
  await $.store.set(STORE_WARNED, level)
  if (level === 0) return
  const left = fmtMoney(leftOf(c), c.exponent, c.currency)
  $.ui.toast(
    level >= 95
      ? `Monthly credit limit nearly reached: ${left} left this month (${pct(c)} used)`
      : `Monthly credit limit at ${pct(c)}: ${left} left this month`,
  )
}

const HEADERS = { 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' }

// The organization's id, looked up once per load: the prepaid balance is filed under it.
let orgId: string | null = null

/** The prepaid credit balance in minor units, or null when it cannot be read. */
async function fetchBalance($: EngineInterface, handle: string): Promise<number | null> {
  if (!orgId) {
    const profile = await $.http.fetch(PROFILE_URL, { auth: handle, headers: HEADERS })
    if (!profile.ok) return null
    orgId = parseOrgId(profile.text)
    if (!orgId) return null
  }
  const res = await $.http.fetch(`https://api.anthropic.com/api/oauth/organizations/${orgId}/prepaid/credits`, { auth: handle, headers: HEADERS })
  return res.ok ? parseBalance(res.text) : null
}

/**
 * Reads the balance and the monthly-limit figures, each on its own: a 429 or an error on
 * the usage endpoint does not hold back the balance. What fails keeps its last value.
 */
async function refresh($: EngineInterface, opts: RefreshOptions): Promise<Credits | null> {
  if (isRefreshing) return read($, credits)
  const now = await $.clock.now()
  const prev = await read($, credits)
  if (!opts.isForced && prev && now - prev.fetchedAt < MIN_REFRESH_MS) return prev
  isRefreshing = true
  try {
    const auth = await $.session.authorize()
    if (!auth || auth.kind !== 'bearer') {
      await update($, view, v => ({ ...v, error: 'no Claude login' }))
      return prev
    }

    const balance = await fetchBalance($, auth.handle).catch(() => null)

    // The monthly-limit figures, unless the usage endpoint asked us to stay away.
    let parsed: Credits | null = null
    let error: string | null = null
    if (now >= backoffUntil) {
      const res = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: HEADERS })
      if (res.ok) {
        parsed = parseCredits(res.text, now)
        if (!parsed) error = 'no credit figures in the answer'
      } else if (res.status === 429) {
        // Honour Retry-After, else stay away a good while: another mod polls this endpoint too.
        const header = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === 'retry-after')?.[1]
        const seconds = Number(header)
        backoffUntil = now + Math.max(BACKOFF_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0)
        error = `refused (429), retrying in ${Math.round((backoffUntil - now) / 60_000)}m`
      } else {
        error = `failed (${res.status})`
      }
    }

    if (parsed === null && balance === null) {
      if (error !== null) await update($, view, v => ({ ...v, error: error ?? '' }))
      return prev
    }
    // Fresh figures where read, the last known ones where not.
    const base: Credits = parsed ?? prev ?? { exponent: 2, currency: 'USD', isEnabled: true, isLimitReached: false, fetchedAt: now }
    const known = balance ?? prev?.balanceMinor
    const next: Credits = { ...base, fetchedAt: now, ...(known !== undefined ? { balanceMinor: known } : {}) }
    await update($, credits, () => next)
    await update($, view, v => ({ ...v, error: error ?? '' }))
    await $.store.set(STORE_LAST, next)
    await warnIfCrossed($, next, opts.warnAt)
    $.ui.status(statusText(next))
    return next
  } catch (err) {
    await update($, view, v => ({ ...v, error: String(err).slice(0, 60) }))
    return prev
  } finally {
    isRefreshing = false
  }
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  const pollMs = () => {
    const m = Number(options.pollMinutes)
    return (Number.isFinite(m) && m >= 1 ? m : DEFAULT_POLL_MINUTES) * 60_000
  }
  const warnAt = () => {
    const p = Number(options.warnAt)
    return Number.isFinite(p) && p > 0 && p < 100 ? p : DEFAULT_WARN_AT
  }
  const showBand = () => options.showBand === true

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'credits',
      description: 'Usage credits: /credits refreshes and shows the balance; /credits hide or show toggles the optional row above the prompt',
    })
    // Last session's reading shows at once; the fresh one replaces it.
    const last = (await $.store.get(STORE_LAST)) as Credits | undefined
    if (last && typeof last.fetchedAt === 'number') {
      await update($, credits, () => last)
      $.ui.status(statusText(last))
    }
    // The first refresh runs right after the session is ready, off the start's own wait.
    $.clock.after(1, () => {
      void refresh($, { isForced: true, warnAt: warnAt() })
    })
    $.clock.every(pollMs(), () => {
      void refresh($, { isForced: true, warnAt: warnAt() })
    })
    return started
  })

  // A status set while the session starts can land before the app attaches, so the
  // line is pinned again at the first turn, and at every turn after, from the reading
  // in hand: no request. Spend moves after a turn, so it is also re-read then (at most
  // every five minutes, and never inside a 429 backoff).
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const c = await read($, credits)
      if (c) $.ui.status(statusText(c))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const c = await read($, credits)
      if (c) $.ui.status(statusText(c))
      $.clock.after(1, () => {
        void refresh($, { isForced: false, warnAt: warnAt() })
      })
    }
    return next(e)
  })

  on('command.run', { command: 'credits' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'hide' || arg === 'show') {
      await update($, view, v => ({ ...v, isHidden: arg === 'hide' }))
      return { text: arg === 'hide' ? 'Credits row hidden. /credits show brings it back.' : 'Credits row shown.' }
    }
    const c = await refresh($, { isForced: true, warnAt: warnAt() })
    const v = await read($, view)
    if (!c) return { text: `Usage credits: no reading yet${v.error ? ` (${v.error})` : ''}.` }
    const now = await $.clock.now()
    return { text: `Usage credits: ${summary(c)} · refreshed ${fmtAgo(now - c.fetchedAt)}${v.error ? ` · last refresh ${v.error}` : ''}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, credits)
    const v = await read($, view)
    if (!showBand() || c === null || v.isHidden || e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    // Other mods' rows stay in the band; an empty Box when nothing sits beneath.
    const rest = await next(e).catch(() => Box({ children: [] }))
    const now = await $.clock.now()
    const isStale = now - c.fetchedAt > 2 * pollMs()
    const note = v.error ? ` · ${v.error}` : isStale ? ` · ${fmtAgo(now - c.fetchedAt)}` : ''
    const text = `◆ Credits ${summary(c)}${c.isEnabled ? '' : ' · off'}`

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" gap={1}>
          <Text color={colorOf(c, warnAt())}>{text}</Text>
          {note ? <Text dimColor>{note}</Text> : null}
          <Button key="usage-credits-hide" label="✕" plain role="dismiss" onPress={() => update($, view, prev => ({ ...prev, isHidden: true }))} />
        </Box>
      </Box>
    )
  })
}
