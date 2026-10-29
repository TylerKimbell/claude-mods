import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { fmtMoney, parseBalance, parseCredits, parseOrgId, statusText, summary } from '../hooks/register'

const band: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const session = { cwd: '/', surface: 'desktop', isInteractive: true } as const

// A trimmed copy of what the endpoint answered on 2026-10-24: $100 of credits, $42.49 used.
const FIVE_RESET = '2026-10-25T03:09:59Z'
const WEEK_RESET = '2026-10-27T11:59:59Z'
const answer = (used: number, limit = 10000, five = 0, week = 0) =>
  JSON.stringify({
    five_hour: { utilization: five, resets_at: FIVE_RESET },
    seven_day: { utilization: week, resets_at: WEEK_RESET },
    extra_usage: {
      is_enabled: true,
      monthly_limit: limit,
      used_credits: used,
      utilization: (used / limit) * 100,
      currency: 'USD',
      decimal_places: 2,
      spend_limit_reached: used >= limit,
    },
    spend: { used: { amount_minor: used, currency: 'USD', exponent: 2 }, limit: { amount_minor: limit, currency: 'USD', exponent: 2 }, percent: Math.round((used / limit) * 100), enabled: true },
  })

type World = {
  /** Requests to the usage endpoint. */
  fetches: number
  profiles: number
  balances: number
  toasts: string[]
  store: Map<string, unknown>
  used: number
  status: number
  /** The prepaid balance in cents; null answers the billing endpoint with a 404. */
  balance: number | null
  /** The usage endpoint's 5-hour and weekly percents. */
  five: number
  week: number
  /** What `$.session.usage()` reports as the engine's rate limits. */
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  lines: string[]
}

function world(on: On, used = 4249): World {
  const w: World = { fetches: 0, profiles: 0, balances: 0, toasts: [], store: new Map(), used, status: 200, balance: null, five: 0, week: 0, rateLimits: [], lines: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: w.rateLimits } }))
  on('http.fetch', ($, e) => {
    const url = (e as unknown as { url: string }).url
    if (url.endsWith('/api/oauth/profile')) {
      w.profiles += 1
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ account: { uuid: 'acc-1' }, organization: { uuid: 'org-1', name: 'Org' } }) } }
    }
    if (url.includes('/prepaid/credits')) {
      w.balances += 1
      expect(url).toBe('https://api.anthropic.com/api/oauth/organizations/org-1/prepaid/credits')
      return w.balance === null
        ? { value: { status: 404, ok: false, headers: {}, text: 'not found' } }
        : { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ amount: w.balance, currency: 'USD', auto_reload_settings: null, expiry_policy_months: null }) } }
    }
    w.fetches += 1
    return { value: { status: w.status, ok: w.status === 200, headers: {}, text: w.status === 200 ? answer(w.used, 10000, w.five, w.week) : 'nope' } }
  })
  on('store.get', ($, e) => ({ value: w.store.get((e as unknown as { key: string }).key) }))
  on('store.set', ($, e) => {
    const { key, value } = e as unknown as { key: string; value: unknown }
    w.store.set(key, value)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push((e as unknown as { text: string }).text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    w.lines.push(String((e as unknown as { text?: string }).text))
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['other mod'] }))
  return w
}

describe('parsing', () => {
  test('reads the extra_usage block in cents', async () => {
    const c = parseCredits(answer(4249), 1)
    expect(c?.usedMinor).toBe(4249)
    expect(c?.limitMinor).toBe(10000)
    expect(Math.round(c?.percent ?? 0)).toBe(42)
    expect(summary(c!)).toBe('$57.51 left of $100 · 42% used')
  })

  test('falls back to the spend block, and null without either', async () => {
    const only = JSON.stringify({ spend: { used: { amount_minor: 250, currency: 'USD', exponent: 2 }, limit: { amount_minor: 5000, currency: 'USD', exponent: 2 }, percent: 5, enabled: true } })
    expect(parseCredits(only, 1)?.limitMinor).toBe(5000)
    expect(parseCredits('{"five_hour":{}}', 1)).toBe(null)
    expect(parseCredits('not json', 1)).toBe(null)
  })

  test('reads the prepaid balance and the organization id', async () => {
    expect(parseBalance(JSON.stringify({ amount: 9149, currency: 'USD' }))).toBe(9149)
    expect(parseBalance(JSON.stringify({ currency: 'USD' }))).toBe(null)
    expect(parseBalance('nope')).toBe(null)
    expect(parseOrgId(JSON.stringify({ organization: { uuid: 'a1b2-c3' } }))).toBe('a1b2-c3')
    expect(parseOrgId(JSON.stringify({ organization: { uuid: '../x' } }))).toBe(null)
    expect(parseOrgId(JSON.stringify({ organization: null }))).toBe(null)
  })

  test('with a balance, the line leads with it and keeps the monthly limit beside it', async () => {
    const c = { ...parseCredits(answer(9384), 1)!, balanceMinor: 9149 }
    expect(statusText(c)).toBe('$91.49 left')
    expect(summary(c)).toBe('$91.49 left · this month $93.84 of $100 monthly limit (94%)')
  })

  test('an unlimited monthly limit comes back as null and the line is the balance alone', async () => {
    const unlimited = JSON.stringify({
      extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 9384, utilization: null, currency: 'USD', decimal_places: 2, spend_limit_reached: false },
      spend: { used: { amount_minor: 9384, currency: 'USD', exponent: 2 }, limit: null, percent: null, enabled: true },
    })
    const parsed = parseCredits(unlimited, 1)!
    expect(parsed.limitMinor).toBe(undefined)
    expect(parsed.usedMinor).toBe(9384)
    expect(parsed.isLimitReached).toBe(false)
    const c = { ...parsed, balanceMinor: 9149 }
    expect(statusText(c)).toBe('$91.49 left')
    expect(summary(c)).toBe('$91.49 left · no monthly limit, $93.84 spent this month')
    // With neither a balance nor a limit, the status line is cleared rather than guessed.
    expect(statusText(parsed)).toBe(undefined)
  })

  test('money formatting', async () => {
    expect(fmtMoney(10000, 2, 'USD')).toBe('$100')
    expect(fmtMoney(5751, 2, 'USD')).toBe('$57.51')
    expect(fmtMoney(5, 2, 'EUR')).toBe('€0.05')
  })
})

describe('usage', () => {
  test('the band shows the balance after the first refresh, on both surfaces', { options: { showBand: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    expect(w.fetches).toBe(1)
    expect(w.store.get('last')).toBeTruthy()
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage', surface, component: 'AbovePrompt', props: band })
      expect(String((await ui.find({ type: 'Text', text: /Credits/ }))?.text)).toBe('◆ Credits $57.51 left of $100 · 42% used')
      expect(await ui.find({ type: 'Text', text: /^other mod$/ })).toBeTruthy()
      await ui.unmount()
    }
  })

  test('the status line under the prompt carries the balance by default, with no band row', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $57.51 left of $100 · 42%')
    const ui = await $.ui.mount({ plugin: 'usage', surface: 'desktop', component: 'AbovePrompt', props: band })
    expect(await ui.find({ type: 'Text', text: /Credits/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^other mod$/ })).toBeTruthy()
    await ui.unmount()
  })

  test('/credits refreshes and answers the balance; hide and show toggle the row', { options: { showBand: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    w.used = 5000
    const out = await $.command.run({ command: 'credits', args: '' })
    expect(String(out.text)).toContain('$50 left of $100 · 50% used')
    expect(w.fetches).toBe(2)

    await $.command.run({ command: 'credits', args: 'hide' })
    const ui = await $.ui.mount({ plugin: 'usage', surface: 'desktop', component: 'AbovePrompt', props: band })
    expect(await ui.find({ type: 'Text', text: /Credits/ })).toBe(undefined)
    await $.command.run({ command: 'credits', args: 'show' })
    expect(await ui.find({ type: 'Text', text: /Credits/ })).toBeTruthy()
    await ui.unmount()
  })

  test('a turn refreshes at most every five minutes; the poll runs every ten', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(1)
    expect(w.fetches).toBe(1)
    await clock.advance(5 * 60_000 + 1_000)
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)
    await clock.advance(1)
    expect(w.fetches).toBe(2)
    await clock.advance(10 * 60_000)
    expect(w.fetches).toBe(3)
  })

  test('the purchased balance leads the status line; the profile is asked once; a failed balance read keeps the last one', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, 9384)
    w.balance = 9149
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $91.49 left')
    const out = await $.command.run({ command: 'credits', args: '' })
    expect(String(out.text)).toContain('$91.49 left · this month $93.84 of $100 monthly limit (94%)')
    expect(w.profiles).toBe(1)
    expect(w.balances).toBe(2)
    // The billing endpoint fails: the last balance stands rather than flipping the line back.
    w.balance = null
    await clock.advance(10 * 60_000)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $91.49 left')
    expect(w.profiles).toBe(1)
  })

  test('the balance still refreshes while the usage endpoint is backing off', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, 9900)
    w.balance = 9149
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $91.49 left')
    // The usage endpoint refuses; the balance moves on its own.
    w.status = 429
    w.balance = 8000
    await clock.advance(10 * 60_000)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $80 left')
    w.balance = 7500
    await clock.advance(10 * 60_000)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $75 left')
  })

  test('the 5-hour and weekly windows lead the status line, from the usage answer', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.five = 12.4
    w.week = 3
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 12% · Weekly 3% · $57.51 left of $100 · 42%')
    const out = await $.command.run({ command: 'credits', args: '' })
    expect(String(out.text)).toContain('Plan: 5-hour 12% (resets in')
    expect(String(out.text)).toContain('weekly 3% (resets in')
  })

  test("the engine's per-reply figures update the windows; within a window the higher reading stands", async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.balance = 9149
    w.five = 10
    // The engine beneath answers its own measure event with what changed.
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 10% · Weekly 0% · $91.49 left')
    const measure = (five: number, resetsAt: string) =>
      $.session.measure({ context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: five, resetsAt }], changed: ['rateLimits'] } as never)
    await measure(20, FIVE_RESET)
    expect(w.lines[w.lines.length - 1]).toBe('5h 20% · Weekly 0% · $91.49 left')
    // A lower figure for the same window is a lagging reading: 20 stands.
    await measure(15, FIVE_RESET)
    expect(w.lines[w.lines.length - 1]).toBe('5h 20% · Weekly 0% · $91.49 left')
    // A new window (it reset) takes the newer reading.
    await measure(1, '2026-10-25T08:09:59Z')
    expect(w.lines[w.lines.length - 1]).toBe('5h 1% · Weekly 0% · $91.49 left')
  })

  test('a window whose reset has passed reads 0%', async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-25T04:00:00Z') })
    const w = world(on)
    w.balance = 9149
    w.five = 55
    w.week = 7
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 7% · $91.49 left')
  })

  test('with showWindows off, the line is the credits alone', { options: { showWindows: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.balance = 9149
    w.five = 12
    await $.session.start(session)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('$91.49 left')
  })

  test('every turn re-pins the status line from the reading in hand, even inside a 429 backoff', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await $.session.start(session)
    await clock.advance(1)
    w.status = 429
    await clock.advance(10 * 60_000)
    const fetches = w.fetches
    w.lines.length = 0
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $57.51 left of $100 · 42%')
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('5h 0% · Weekly 0% · $57.51 left of $100 · 42%')
    // Inside the backoff: no request was made for it.
    expect(w.fetches).toBe(fetches)
  })

  test('a 429 backs off for at least fifteen minutes and keeps the last reading', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    w.status = 429
    await clock.advance(10 * 60_000)
    expect(w.fetches).toBe(2)
    // The next poll lands inside the backoff: no request.
    await clock.advance(10 * 60_000)
    expect(w.fetches).toBe(2)
    const out = await $.command.run({ command: 'credits', args: '' })
    expect(String(out.text)).toContain('$57.51 left')
    expect(String(out.text)).toContain('refused (429)')
  })

  test('toasts once when crossing the warn level and again near the end', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, 8500)
    await $.session.start(session)
    await clock.advance(1)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('85%')
    await clock.advance(10 * 60_000)
    expect(w.toasts.length).toBe(1)
    w.used = 9700
    await clock.advance(10 * 60_000)
    expect(w.toasts.length).toBe(2)
    expect(w.toasts[1]).toContain('nearly reached')
  })

  test('a failed refresh keeps the last reading and says why', { options: { showBand: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    w.status = 500
    await clock.advance(10 * 60_000)
    const ui = await $.ui.mount({ plugin: 'usage', surface: 'terminal', component: 'AbovePrompt', props: band })
    expect(String((await ui.find({ type: 'Text', text: /Credits/ }))?.text)).toContain('$57.51 left')
    expect(String((await ui.find({ type: 'Text', text: /failed/ }))?.text)).toContain('failed (500)')
    await ui.unmount()
  })
})
