import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, On, RenderPropsOf, SessionStartInput, TurnCompleteInput, TurnStepInput, TurnUsage } from 'claude-code'

import { FLUSH_MS, STEP_NOTE, segmentsOf, segmentText } from '../hooks/register'
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
type Found = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
// The band's rows by what their SVG says: Claude's own, and the subagents'.
const rowAlt = async (ui: Found, lead: string) => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt)).find(a => a.startsWith(lead))
const barAlt = (ui: Found) => rowAlt(ui, 'Subagents')
const mainAlt = (ui: Found) => rowAlt(ui, 'Claude')
const mainTurn = (turnId: string): TurnCompleteInput =>
  ({ answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' }) as AnsweredTurn

describe('agent-progress', () => {
  test('subagents start a bar, open the pane once, and finishing them all reads Done', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await $.session.start(session)
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface: 'desktop', component: 'AbovePrompt', props: band })
    expect(await barAlt(ui)).toBe(undefined)
    expect(await mainAlt(ui)).toBe('Claude ready')

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

    // The finished bar stays through the next prompt; a later burst starts a fresh one, and
    // the pane does not open again this session.
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    expect(barOf(w)?.isFinished).toBe(true)
    expect(await barAlt(ui)).toBe('Subagents: Done, 100%')
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

    // The desktop draws one segment per step: one solid, the next pulsing, two waiting.
    const desk = await $.ui.mount({ ...pane, surface: 'desktop' })
    const svg = await desk.find({ type: 'Svg' })
    expect(String(svg?.props.alt)).toBe('task 1: 1/4 reading')
    const source = String(svg?.props.source)
    expect(source.match(/<rect /g)?.length).toBe(4)
    expect(source.match(/class="live"/g)?.length).toBe(1)
    expect(source.match(/class="k"/g)?.length).toBe(2)
    await desk.unmount()
  })

  test('segments scale down past twelve steps, and the terminal draws them as rules', () => {
    expect(segmentsOf(2, 5, 1)).toEqual({ count: 5, filled: 2, live: 1, isWave: false })
    expect(segmentsOf(12, 24, 2)).toEqual({ count: 12, filled: 6, live: 1, isWave: false })
    expect(segmentsOf(3, 3, 0)).toEqual({ count: 3, filled: 3, live: 0, isWave: false })
    expect(segmentText(segmentsOf(1, 3, 1), 11)).toEqual(['━━━ ', '━━━ ━━━'])
    expect(segmentText(segmentsOf(0, 2, 1), 7)).toEqual(['', '━━━ ━━━'])
  })

  test("Claude's own row follows its task list, keeps what it last said, and leaves the spinner alone", async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e) => ({ value: { tool: e.name } }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ran' }))
    // The engine beneath draws each site from its props, as the surface would.
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: [`${(e.props as { word?: string }).word ?? 'engine'}${(e.props as { suffix?: string }).suffix ?? ''}`] }))
    await $.session.start(session)
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface: 'desktop', component: 'AbovePrompt', props: band })
    expect(await mainAlt(ui)).toBe('Claude ready')

    await $.turn.start({ text: 'go', turnId: 't-1' })
    expect(await mainAlt(ui)).toBe('Claude working')
    await $.tool.call({
      tool: 'mcp__ccd_turn__update_plan',
      items: [
        { content: 'Read the code', status: 'in_progress' },
        { content: 'Write the fix', status: 'pending' },
      ],
    } as never)
    expect(await mainAlt(ui)).toBe('Claude 0/2: Read the code')
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
    expect(await mainAlt(ui)).toBe('Claude 1/2: Write the fix')
    await $.tool.call({ tool: 'Bash', command: 'git status' })

    const spinner = await $.ui.mount({ plugin: 'agent-progress', surface: 'desktop', component: 'Spinner', requestId: 'main', props: { word: 'Working', message: null, suffix: '…', mode: 'thinking' } as RenderPropsOf['Spinner'] })
    expect(String((await spinner.find({ type: 'Text', text: /Working/ }))?.text)).toBe('Working…')
    await spinner.unmount()

    // Wrapping up checks the list off, and the row keeps it after the turn.
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Fixed.' } as never)
    await $.turn.complete(mainTurn('t-1'))
    expect(await mainAlt(ui)).toBe('Claude done 2/2')
    await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } })
    expect(await mainAlt(ui)).toBe('Claude done 2/2')

    // A turn with no list waves while it runs and reads done after.
    await $.turn.start({ text: 'thanks', turnId: 't-2' })
    expect(await mainAlt(ui)).toBe('Claude working')
    await $.turn.complete(mainTurn('t-2'))
    expect(await mainAlt(ui)).toBe('Claude done')
    await ui.unmount()
  })

  test("the CLI's task tools drive the row too, drawn in text on the terminal", async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e) => ({ value: { tool: e.name } }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('tool.call', ($, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: String(e.subject), subject: String(e.subject) } } : 'ran' }) as never)
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['other mod'] }))
    await $.session.start({ ...session, surface: 'terminal' })
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface: 'terminal', component: 'AbovePrompt', props: band })
    await $.turn.start({ text: 'go', turnId: 't-1' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: 'first' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'b', description: 'second' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'a', status: 'completed' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'b', status: 'in_progress' } as never)
    expect(String((await ui.find({ type: 'Text', text: /Claude/ }))?.text)).toBe('● Claude 1/2')
    expect(await ui.find({ type: 'Text', text: /^b$/ })).toBeTruthy()

    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'one', status: 'completed', activeForm: 'One' }, { content: 'two', status: 'completed', activeForm: 'Two' }, { content: 'three', status: 'pending', activeForm: 'Three' }] } as never)
    expect(String((await ui.find({ type: 'Text', text: /Claude/ }))?.text)).toBe('● Claude 2/3')
    await ui.unmount()
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
