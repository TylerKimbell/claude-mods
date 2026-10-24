import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, On, RenderPropsOf, SessionStartInput, TurnCompleteInput, TurnStepInput, TurnUsage } from 'claude-code'

import { FLUSH_MS, STEP_NOTE } from '../hooks/register'
import type { AgentRun, Bar } from '../types'

const session: SessionStartInput = { surface: 'desktop', isInteractive: true, cwd: '/work' }
const band: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const pane = {
  plugin: 'agent-progress',
  component: 'Pane',
  requestId: 'agent-progress',
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

type World = { opened: string[]; nextStep: TurnUsage[]; state: Map<string, unknown>; writes: string[]; prompts: string[] }

// The engine beneath the mod: tools and commands answer, panes open, subagents get ids,
// steps answer from a queue, and another mod's row sits in the band.
function world(on: On): World {
  const w: World = { opened: [], nextStep: [], state: new Map(), writes: [], prompts: [] }
  on('state.set', ($, e, next) => {
    const write = e as unknown as { plugin: string; key: string; value: unknown }
    if (write.plugin === 'agent-progress') {
      w.state.set(write.key, write.value)
      w.writes.push(write.key)
    }
    return next(e)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: {} }))
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', ($, e) => {
    w.prompts.push(e.prompt)
    return { agentId: `agent-${e.tool_use_id}`, model: 'claude-opus-5-5' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: w.nextStep.shift() ?? null }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['other mod'] }))
  return w
}

const spawn = (id: string, subagentType = 'general-purpose'): AgentSpawnInput =>
  ({
    tool_use_id: id,
    prompt: 'Look into it.',
    description: `task ${id}`,
    subagentType,
    provider: { kind: 'model', model: 'claude-opus-5-5' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  }) as unknown as AgentSpawnInput

type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
const finish = (agentId: string): TurnCompleteInput =>
  ({ answer: 'done', durationMs: 1000, isAborted: false, turnId: `t-${agentId}`, reason: 'answer', agentId }) as AnsweredTurn

const use = (n: number): TurnUsage => ({ input_tokens: n, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, model: 'claude-opus-5-5' })

async function step($: Engine, w: World, agentId: string, index: number, usage: TurnUsage) {
  w.nextStep.push(usage)
  const input: TurnStepInput = { turnId: `t-${agentId}`, index, model: 'claude-opus-5-5', messageCount: 3, agentId }
  for await (const _ of $.turn.step(input)) {
    /* drain */
  }
}

const barOf = (w: World) => (w.state.get('bar') ?? null) as Bar | null
const agentsOf = (w: World) => (w.state.get('agents') ?? []) as AgentRun[]
const barAlt = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) => String((await ui.find({ type: 'Svg' }))?.props.alt)

describe('agent-progress', () => {
  test('subagents start a bar, open the pane once, and finishing them all reads Done', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface: 'desktop', component: 'AbovePrompt', props: band })
    expect(await ui.find({ type: 'Svg' })).toBe(undefined)

    await $.agent.spawn(spawn('1'))
    await $.agent.spawn(spawn('2', 'Explore'))
    expect(await barAlt(ui)).toBe('Subagents: 0/2, 0%')
    expect(w.opened).toEqual(['agent-progress'])
    // The band keeps the other mod's row.
    expect(await ui.find({ type: 'Text', text: /^other mod$/ })).toBeTruthy()

    await $.turn.complete(finish('agent-1'))
    expect(await barAlt(ui)).toBe('Subagents: 1/2, 50%')
    await $.turn.complete(finish('agent-2'))
    expect(await barAlt(ui)).toBe('Subagents: Done, 100%')

    // A later burst starts a fresh bar, and the pane does not open again this session.
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    expect(barOf(w)).toBe(null)
    expect(await ui.find({ type: 'Svg' })).toBe(undefined)
    await $.agent.spawn(spawn('3'))
    expect(await barAlt(ui)).toBe('Subagents: 0/1, 0%')
    expect(w.opened).toEqual(['agent-progress'])
    await ui.unmount()
  })

  test('the band draws in text on the terminal', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    world(on)
    await $.session.start({ ...session, surface: 'terminal' })
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface: 'terminal', component: 'AbovePrompt', props: band })
    await $.agent.spawn(spawn('1'))
    expect(await ui.find({ type: 'Svg' })).toBe(undefined)
    expect(String((await ui.find({ type: 'Text', text: /Subagents/ }))?.text)).toContain('Subagents')
    expect(String((await ui.find({ type: 'Text', text: /0\/1/ }))?.text)).toContain('0/1')
    expect(String((await ui.find({ type: 'Text', text: /%/ }))?.text)).toContain('0%')
    expect(String((await ui.find({ type: 'Text', text: /running/ }))?.text)).toContain('1 running')
    await ui.unmount()
  })

  test('each subagent is asked to report steps, and its row shows them', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await $.agent.spawn(spawn('1'))
    expect(w.prompts[0]).toBe('Look into it.' + STEP_NOTE)

    await $.tool.call({ tool: 'mcp__agent-progress__step', done: 1, total: 4, note: 'reading', agentId: 'agent-1' } as never)
    const run = agentsOf(w)[0]
    expect(run?.stepDone).toBe(1)
    expect(run?.stepTotal).toBe(4)
    expect(run?.stepNote).toBe('reading')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...pane, surface })
      expect(await ui.find({ type: 'Text', text: /task 1/ })).toBeTruthy()
      expect(await ui.find({ type: 'Text', text: /1\/4 reading/ })).toBeTruthy()
      await ui.unmount()
    }
  })

  test('a fork keeps its prompt as given', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await $.agent.spawn(spawn('1', 'fork'))
    expect(w.prompts[0]).toBe('Look into it.')
  })

  test("a subagent's usage is written in one batch per FLUSH_MS, not on every request", async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await $.agent.spawn(spawn('1'))
    await step($, w, 'agent-1', 0, use(1000))
    await step($, w, 'agent-1', 1, use(2000))
    await step($, w, 'agent-1', 2, use(3000))
    expect(agentsOf(w)[0]?.tokens).toBe(0)
    expect(w.writes.filter(k => k === 'agents')).toEqual(['agents'])
    await clock.advance(FLUSH_MS)
    expect(agentsOf(w)[0]?.tokens).toBe(6000)
    expect(agentsOf(w)[0]?.steps).toBe(3)
    // Finishing writes what is still held before the run is marked done.
    await step($, w, 'agent-1', 3, use(500))
    await $.turn.complete(finish('agent-1'))
    const run = agentsOf(w)[0]
    expect(run?.tokens).toBe(6500)
    expect(run?.status).toBe('done')
  })

  test('the clock stops ticking once no subagent runs', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    await $.agent.spawn(spawn('1'))
    await $.turn.complete(finish('agent-1'))
    await clock.advance(FLUSH_MS)
    await clock.advance(24 * 60 * 60 * 1000)
    expect(agentsOf(w)[0]?.status).toBe('done')
  })
})
