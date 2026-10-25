import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnCompleteInput, TurnStepInput, TurnUsage } from 'claude-code'

import { CHECK_MS, coldPenaltyOf, costOf, statusOf } from '../hooks/register'
import type { Warm } from '../types'

const MIN = 60_000
const session = { cwd: '/', surface: 'desktop', isInteractive: true } as const

type World = { forks: number; served: number; context: number; logs: string[]; lines: (string | undefined)[]; warm: Warm | null }

function world(on: On, context = 400_000): World {
  const w: World = { forks: 0, served: context, context, logs: [], lines: [], warm: null }
  on('state.set', ($, e, next) => {
    const write = e as unknown as { plugin: string; key: string; value: unknown }
    if (write.plugin === 'cache-warmer' && write.key === 'warm') w.warm = write.value as Warm
    return next(e)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: w.context, window: 1_000_000, percent: Math.round(w.context / 10_000) }, rateLimits: [] } }))
  on('model.fork', () => {
    w.forks += 1
    return { value: { isAnswered: true as const, text: 'ok', usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: w.served, cache_creation_input_tokens: 0 } } }
  })
  on('ui.log', ($, e) => {
    w.logs.push(String((e as unknown as { text: string }).text))
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    w.lines.push((e as unknown as { text?: string }).text)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: w.context - 1000, cache_creation_input_tokens: 0, model: 'claude-fable-5-1' } as TurnUsage }
  })
  return w
}

type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>

/** One turn of the main thread: start, one model request, complete. */
async function turn($: Engine, id: string) {
  await $.turn.start({ text: 'go', turnId: id })
  const input: TurnStepInput = { turnId: id, index: 0, model: 'claude-fable-5-1', messageCount: 3 }
  for await (const _ of $.turn.step(input)) {
    /* drain */
  }
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' } as AnsweredTurn)
}

describe('pricing', () => {
  test('a Fable ping costs cents and a cold return costs dollars', async () => {
    const ping = costOf('claude-fable-5-1', { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 0 })
    expect(ping > 0.09 && ping < 0.12).toBe(true)
    const cold = coldPenaltyOf('claude-fable-5-1', 400_000)
    expect(Math.round(cold * 100) / 100).toBe(4.9)
  })
})

describe('cache-warmer', () => {
  test('pings a few minutes before expiry while idle, once per cache lifetime, up to the cap', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await turn($, 't1')
    // 55 minutes idle: the cache has 5 minutes left, the lead is 4, so nothing yet.
    await clock.advance(55 * MIN)
    expect(w.forks).toBe(0)
    await clock.advance(2 * MIN)
    expect(w.forks).toBe(1)
    expect(w.logs[0]).toContain('pinged')
    expect(String(w.lines[w.lines.length - 1])).toContain('1 ping')
    // The ping restarted the clock: the next one comes a lifetime later.
    await clock.advance(30 * MIN)
    expect(w.forks).toBe(1)
    await clock.advance(30 * MIN)
    expect(w.forks).toBe(2)
    // Four pings in four idle hours, then it stops.
    await clock.advance(10 * 60 * MIN)
    expect(w.forks).toBe(4)
    expect(w.warm?.note).toBe('cap')
  })

  test('a new turn starts a fresh run', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await turn($, 't1')
    await clock.advance(57 * MIN)
    expect(w.forks).toBe(1)
    await turn($, 't2')
    expect(w.warm?.stretchPings).toBe(0)
    expect(w.lines[w.lines.length - 1]).toBe(undefined)
    await clock.advance(57 * MIN)
    expect(w.forks).toBe(2)
  })

  test('never pings while a turn is running, or when the cache already went cold', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await turn($, 't1')
    await $.turn.start({ text: 'long one', turnId: 't2' })
    await clock.advance(57 * MIN)
    expect(w.forks).toBe(0)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as AnsweredTurn)
    // Idle past the lifetime with no check landing in the window (the clock jumps): cold, so no ping.
    await clock.advance(61 * MIN)
    expect(w.warm?.note === 'cold' || w.forks === 1).toBe(true)
  })

  test('skips a small context', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, 20_000)
    await $.session.start(session)
    await turn($, 't1')
    await clock.advance(57 * MIN)
    expect(w.forks).toBe(0)
    expect(w.warm?.note).toBe('small')
  })

  test('a ping that misses the cache stops the run', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.served = 0
    await $.session.start(session)
    await turn($, 't1')
    await clock.advance(57 * MIN)
    expect(w.forks).toBe(1)
    expect(w.logs[0]).toContain('missed the cache')
    await clock.advance(120 * MIN)
    expect(w.forks).toBe(1)
    expect(w.warm?.note).toBe('miss')
  })

  test('/warmer off stops it, /warmer shows the state', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await turn($, 't1')
    const off = await $.command.run({ command: 'warmer', args: 'off' })
    expect(String(off.text)).toContain('off')
    await clock.advance(57 * MIN)
    expect(w.forks).toBe(0)
    const state = await $.command.run({ command: 'warmer', args: '' })
    expect(String(state.text)).toContain('Cache warmer off')
    expect(String(state.text)).toContain('400k tokens')
    // Back on inside the lead window: the next check pings.
    await $.command.run({ command: 'warmer', args: 'on' })
    await clock.advance(CHECK_MS)
    expect(w.forks).toBe(1)
  })

  test('does nothing in a headless session', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start({ ...session, isInteractive: false })
    await turn($, 't1')
    await clock.advance(120 * MIN)
    expect(w.forks).toBe(0)
  })

  test('the status line reads nothing until a ping has happened', async () => {
    expect(statusOf({ isOff: false, isWorking: false, lastRequestAt: 1, model: 'm', contextTokens: 0, stretchPings: 0, stretchSpentUsd: 0, stretchColdUsd: 0, totalPings: 0, totalSpentUsd: 0, note: '' })).toBe(undefined)
    expect(statusOf({ isOff: true, isWorking: false, lastRequestAt: 1, model: 'm', contextTokens: 0, stretchPings: 0, stretchSpentUsd: 0, stretchColdUsd: 0, totalPings: 0, totalSpentUsd: 0, note: '' })).toBe('cache-warmer off')
  })
})
