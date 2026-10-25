import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { fmtMoney, parseCredits, summary } from '../hooks/register'

const band: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const session = { cwd: '/', surface: 'desktop', isInteractive: true } as const

// A trimmed copy of what the endpoint answered on 2026-10-24: $100 of credits, $42.49 used.
const answer = (used: number, limit = 10000) =>
  JSON.stringify({
    five_hour: { utilization: 0, resets_at: '2026-10-25T03:09:59Z' },
    seven_day: { utilization: 0, resets_at: '2026-10-27T11:59:59Z' },
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

type World = { fetches: number; toasts: string[]; store: Map<string, unknown>; used: number; status: number; lines: string[] }

function world(on: On, used = 4249): World {
  const w: World = { fetches: 0, toasts: [], store: new Map(), used, status: 200, lines: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('http.fetch', () => {
    w.fetches += 1
    return { value: { status: w.status, ok: w.status === 200, headers: {}, text: w.status === 200 ? answer(w.used) : 'nope' } }
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

  test('money formatting', async () => {
    expect(fmtMoney(10000, 2, 'USD')).toBe('$100')
    expect(fmtMoney(5751, 2, 'USD')).toBe('$57.51')
    expect(fmtMoney(5, 2, 'EUR')).toBe('€0.05')
  })
})

describe('usage-credits', () => {
  test('the band shows the balance after the first refresh, on both surfaces', { options: { showBand: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    expect(w.fetches).toBe(1)
    expect(w.store.get('last')).toBeTruthy()
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-credits', surface, component: 'AbovePrompt', props: band })
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
    expect(w.lines[w.lines.length - 1]).toBe('Credits $57.51 left of $100 · 42%')
    const ui = await $.ui.mount({ plugin: 'usage-credits', surface: 'desktop', component: 'AbovePrompt', props: band })
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
    const ui = await $.ui.mount({ plugin: 'usage-credits', surface: 'desktop', component: 'AbovePrompt', props: band })
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
    expect(w.lines[w.lines.length - 1]).toBe('Credits $57.51 left of $100 · 42%')
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(1)
    expect(w.lines[w.lines.length - 1]).toBe('Credits $57.51 left of $100 · 42%')
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
    expect(w.toasts[1]).toContain('nearly gone')
  })

  test('a failed refresh keeps the last reading and says why', { options: { showBand: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await clock.advance(1)
    w.status = 500
    await clock.advance(10 * 60_000)
    const ui = await $.ui.mount({ plugin: 'usage-credits', surface: 'terminal', component: 'AbovePrompt', props: band })
    expect(String((await ui.find({ type: 'Text', text: /Credits/ }))?.text)).toContain('$57.51 left')
    expect(String((await ui.find({ type: 'Text', text: /failed/ }))?.text)).toContain('failed (500)')
    await ui.unmount()
  })
})
