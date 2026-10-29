import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const CATEGORIES = [
  { name: 'System prompt', tokens: 4_000, kind: 'used' },
  { name: 'System tools', tokens: 34_000, kind: 'used' },
  { name: 'MCP tools', tokens: 17_000, kind: 'used' },
  { name: 'Skills', tokens: 6_000, kind: 'used' },
  { name: 'Messages', tokens: 97_000, kind: 'used' },
  { name: 'Memory files', tokens: 1_000, kind: 'used' }, // 0.1%: hidden from the legend
  { name: 'Deferred tools', tokens: 50_000, kind: 'deferred', isDeferred: true },
  { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
  { name: 'Free space', tokens: 808_000, kind: 'free' },
].map(c => ({ color: 'text', isDeferred: false, ...c }))

function usage(rateLimits: SessionRateLimit[]): SessionUsage {
  return {
    startedAt: NOW - HOUR,
    context: {
      window: 1_000_000,
      tokens: 158_000,
      percent: 16,
      breakdown: {
        categories: CATEGORIES,
        totalTokens: 159_000,
        maxTokens: 1_000_000,
        rawMaxTokens: 1_000_000,
        percentage: 16,
      } as never,
    },
    rateLimits,
  }
}

const iso = (ms: number) => new Date(NOW + ms).toISOString()

function world(on: On, rateLimits: SessionRateLimit[], status: (string | undefined)[] = []) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage(rateLimits) }))
  answerRest(on, status)
}

// what the engine answers beneath the plugin, the plan's own hooks left to the test
function answerRestNoPlan(on: On) {
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
}

// no first-party login: the plan's usage endpoint is not asked
function noPlan(on: On) {
  on('session.authorize', () => ({ value: null }))
}

// what the engine answers beneath the plugin: its own (empty) band, the status line
function answerRest(on: On, status: (string | undefined)[]) {
  noPlan(on)
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
}

const MEASURE = { context: { window: 1_000_000, tokens: 158_000, percent: 16 }, rateLimits: [] }

// the % field is drawn afresh after every set, under a new key
async function fieldKey(ui: { find: (q: { type: 'Input' }) => Promise<{ props: { key?: string } } | undefined> }): Promise<string> {
  return String((await ui.find({ type: 'Input' }))?.props.key)
}

test('draws the context band: the summary beside the controls, the bar, the breakdown, and no plan windows', async ($, on) => {
  // the session reports both windows; this fork leaves them to the usage mod's status line
  world(on, [
    { kind: 'five_hour', percentUsed: 8, resetsAt: iso(3 * HOUR + 24 * MIN) },
    { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR + 7 * HOUR) },
  ])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: 'Context' })).toBeDefined()
    expect(await ui.find({ text: '16% used' })).toBeDefined()
    expect(await ui.find({ text: '809k free of 1M' })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
    // three groups on one row: Messages, Tools (34k + 17k), Other (4k + 6k + 1k), Other in grey
    expect(await ui.find({ text: 'Messages' })).toBeDefined()
    expect(await ui.find({ text: '96k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Tools' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '51k' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'Other' }))?.props.color).toBe('#8b90a0')
    expect(await ui.find({ type: 'Text', text: '11k' })).toBeDefined()
    expect(await ui.find({ text: 'Skills' })).toBeUndefined()
    // no plan windows, no forecast
    for (const gone of ['5 Hour', 'Weekly', '5H', 'W']) expect(await ui.find({ text: gone })).toBeUndefined()
    expect(await ui.find({ text: /^On track|^On pace|resets in/ })).toBeUndefined()
    // legend runs Messages, Tools, Other
    const names = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const order = ['Messages', 'Tools', 'Other'].map(n => names.indexOf(n))
    expect(order).toEqual([...order].sort((a, b) => a - b))

    // every flexGrow is finite, within the engine's limit, and never a raw token count
    const boxes = await ui.findAll({ type: 'Box' })
    for (const box of boxes) {
      const grow = box.props.flexGrow
      if (grow === undefined) continue
      expect(Number.isFinite(grow)).toBe(true)
      expect(grow as number).toBeLessThanOrEqual(10000)
      expect(grow as number).toBeGreaterThanOrEqual(1)
    }
    if (surface === 'desktop') {
      // one thin Svg bar, the context's (the auto compact switch is an Svg too: left out)
      const svgs = (await ui.findAll({ type: 'Svg' })).filter(svg => !/^Auto compact/.test(String(svg.props.alt)))
      expect(svgs).toHaveLength(1)
      expect(svgs[0]?.props.alt).toMatch(/^Context/)
      expect(svgs[0]?.props.height).toBe(7.5)
      expect(boxes.filter(b => typeof b.props.flexGrow === 'number')).toHaveLength(0)
    } else {
      // 4 bar segments: Messages, Tools, Other with the buffer as one grey run, free
      expect(boxes.filter(b => typeof b.props.flexGrow === 'number')).toHaveLength(4)
    }
    await ui.unmount()
  }
})

test('shows a refresh failure in the status line', async ($, on) => {
  const status: (string | undefined)[] = []
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ deny: 'no session' }))
  answerRest(on, status)
  await $.session.measure(MEASURE)
  expect(status).toContainEqual(expect.stringMatching(/^ctx-info: (?!ctx-info).*no session/))
})

test('the Compact button runs /compact', async ($, on) => {
  const ran: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(5 * 24 * HOUR) }]) }))
  answerRest(on, [])
  on('command.run', (_$, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'compact' })
    await clock.advance(1)
    await ui.unmount()
  }
  expect(ran).toEqual(['compact', 'compact'])
})

test('the exact /context count corrects the estimate, and Messages with it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  // the exact count: System tools 20k (estimate 34k), MCP tools 13k (estimate 17k)
  const exact = CATEGORIES.map(c =>
    c.name === 'System tools' ? { ...c, tokens: 20_000 } : c.name === 'MCP tools' ? { ...c, tokens: 13_000 } : c,
  )
  on('session.usage', (_$, e) => {
    const u = usage([])
    if (e.breakdown === 'full') (u.context.breakdown as { categories: unknown }).categories = exact
    return { value: u }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ctx-info' } }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(2_000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: PROPS })
    // Tools 20k + 13k, exact; Other 11k; Messages 158k - 33k - 11k = 114k
    expect(await ui.find({ type: 'Text', text: '33k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '11k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '114k' })).toBeDefined()
    await ui.unmount()
  }
})

test('after /compact, before any reply, the exact count is shown', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  // compacted: no reply yet, so no real total; the estimate says Messages 97k
  const exact = CATEGORIES.map(c => (c.name === 'Messages' ? { ...c, tokens: 23_000 } : c))
  on('session.usage', (_$, e) => {
    const u = usage([])
    delete (u.context as { tokens?: number }).tokens
    if (e.breakdown === 'full') (u.context.breakdown as { categories: unknown }).categories = exact
    return { value: u }
  })
  answerRest(on, [])
  await $.session.measure(MEASURE)
  await clock.advance(1)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: PROPS })
    // Messages 23k exact; used 23k + 51k + 11k = 85k; free 1M - 85k - 33k buffer
    expect(await ui.find({ type: 'Text', text: '23k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '882k free of 1M' })).toBeDefined()
    await ui.unmount()
  }
})

const TURN = { answer: 'done', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never

function startWorld(on: On, percentRef: { value: number; isCompacted?: boolean }, ran: string[], asked: string[] = [], answer = 'Compact now', seed: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, seed)
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    // just compacted: no reply yet, so no real total
    const tokens = percentRef.isCompacted ? undefined : percentRef.value * 10_000
    return { value: { ...u, context: { ...u.context, tokens, percent: percentRef.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ctx-info' } }))
  on('command.run', (_$, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  // auto compact compacts through the session, not by typing /compact
  on('session.compact', () => {
    ran.push('compact')
    return { skip: 'answered by the test' } as never
  })
  // $.ui.ask is a call of the AskUserQuestion tool: answered here as the dialog would
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    asked.push(question)
    return { result: { questions: [], answers: { [question]: answer } } } as never
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', () => ({ turnId: 't1' }))
  answerRest(on, [])
  return clock
}

test('the arrow collapses the band to the summary and the bar, and back', async ($, on) => {
  const percent = { value: 16 }
  startWorld(on, percent, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
    expect(await ui.find({ text: 'Messages' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    // the summary, the controls and the bar stay; the breakdown goes
    expect(await ui.find({ type: 'Button', label: '▲' })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    expect(await ui.find({ text: '16% used' })).toBeDefined()
    expect(await ui.find({ text: 'Messages' })).toBeUndefined()
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(svg => /^Context/.test(String(svg.props.alt)))).toBe(true)
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ text: 'Messages' })).toBeDefined()
    await ui.unmount()
  }
})

test('collapsed is one setting for every chat: another chat collapsing shows here within half a second', async ($, on) => {
  const shared: Record<string, unknown> = {}
  const clock = startWorld(on, { value: 16 }, [], [], 'Compact now', shared)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
  // the other chat's press, in the store all chats share
  shared.collapsed = true
  await clock.advance(500)
  expect(await ui.find({ type: 'Button', label: '▲' })).toBeDefined()
  shared.collapsed = false
  await clock.advance(500)
  expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
  await ui.unmount()
})

test('auto compact: the switch shows the field, and it compacts between turns once the context reaches the %', async ($, on) => {
  const percent = { value: 16 }
  const ran: string[] = []
  const clock = startWorld(on, percent, ran)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'auto' })
  expect((await ui.find({ type: 'Svg', alt: 'Auto compact on' }))).toBeDefined()
  // the field takes digits; the % sits beside it
  expect((await ui.find({ type: 'Input' }))?.props.submitLabel).not.toBe('set')
  // 100 becomes 99 with a note
  await ui.input({ key: await fieldKey(ui), text: '100' })
  expect(ran).toEqual([])
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('99')
  // below 15 becomes 15, each time; over 99 is 99 each time; blank is 30
  for (const [typed, shown] of [['5', '15'], ['0', '15'], ['14', '15'], ['100', '99'], ['250', '99'], ['', '30'], ['20', '20']]) {
    await ui.input({ key: await fieldKey(ui), text: typed })
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe(shown)
  }
  // digits only, 3 at most: letters, signs and pasted text are dropped as they arrive
  await ui.input({ key: await fieldKey(ui), text: '2a', kind: 'change' })
  expect(String((await ui.find({ type: 'Input' }))?.props.value).replace(/​/g, '')).toBe('2')
  await ui.input({ key: await fieldKey(ui), text: '2', kind: 'change' })
  await ui.input({ key: await fieldKey(ui), text: '2+', kind: 'change' })
  expect(String((await ui.find({ type: 'Input' }))?.props.value).replace(/​/g, '')).toBe('2')
  await ui.input({ key: await fieldKey(ui), text: 'fix the bug -25 now', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('25')
  await ui.input({ key: await fieldKey(ui), text: '123456', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('123')
  await ui.input({ key: await fieldKey(ui), text: '-25' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('25')
  await ui.input({ key: await fieldKey(ui), text: '20' })
  // typing sets nothing while it goes on; resting 2s counts as clicking away, once
  await ui.input({ key: await fieldKey(ui), text: '4', kind: 'change' })
  await clock.advance(1_500)
  await ui.input({ key: await fieldKey(ui), text: '45', kind: 'change' })
  await clock.advance(1_500)
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('20')
  await clock.advance(600)
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('45')
  // a press elsewhere in the band sets a draft at once
  await ui.input({ key: await fieldKey(ui), text: '7', kind: 'change' })
  await ui.press({ key: 'collapse' })
  await ui.press({ key: 'collapse' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('15')
  await ui.input({ key: await fieldKey(ui), text: '40' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('40')

  // past it mid-turn: nothing until the turn ends, then at once
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  percent.value = 45
  await clock.advance(3_000)
  expect(ran).toEqual([])
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])

  // the compaction left it still past the %: it does not loop on it
  await $.turn.complete(TURN)
  await clock.advance(3_600)
  expect(ran).toEqual(['compact'])

  // once under the % and past it again, it fires again
  percent.value = 20
  await clock.advance(3_000)
  percent.value = 41
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact', 'compact'])
  await ui.unmount()
})

test('auto compact set below the context asks in the band, and "Now" compacts', async ($, on) => {
  const percent = { value: 50 }
  const ran: string[] = []
  const asked: string[] = []
  const clock = startWorld(on, percent, ran, asked, 'Compact now')
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'auto' })
  await ui.input({ key: await fieldKey(ui), text: '40' })
  await clock.advance(1_100)
  // asked in the band, never through the chat's question dialog
  expect(asked).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Context is already at 50%, past 40%. Auto compact:' })).toBeDefined()
  expect(ran).toEqual([])
  await ui.press({ key: 'askNow' })
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  await ui.unmount()
})

test('"After my next compact" holds through a % flickering below, until a real compaction', async ($, on) => {
  const percent: { value: number; isCompacted?: boolean } = { value: 17 }
  const ran: string[] = []
  const clock = startWorld(on, percent, ran)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'auto' })
  await ui.input({ key: await fieldKey(ui), text: '19' })
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  await ui.input({ key: await fieldKey(ui), text: '17' })
  expect(await ui.find({ type: 'Text', text: /already at 17%, past 17%/ })).toBeDefined()
  // still asking: a dip below and back, then a turn's end, compacts nothing
  percent.value = 16.4
  await clock.advance(3_000)
  percent.value = 18
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual([])
  await ui.press({ key: 'askNext' })
  percent.value = 16.4
  await clock.advance(3_000)
  percent.value = 18
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual([])
  // the person's own compact: from then on it watches again
  percent.value = 5
  percent.isCompacted = true
  await clock.advance(3_000)
  percent.isCompacted = false
  percent.value = 18
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  await ui.unmount()
})

test('auto compact is per chat: another chat opens with it off, at 30%; turned on past it, it asks and waits', async ($, on) => {
  const percent: { value: number; isCompacted?: boolean } = { value: 35 }
  const ran: string[] = []
  // another chat has it on at 20%
  const clock = startWorld(on, percent, ran, [], 'Compact now', { 'autoCompact:other': { isOn: true, at: 20 } })
  on('session.id', () => ({ value: 'this' }) as never)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(3_000)
  expect(ran).toEqual([])

  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Svg', alt: 'Auto compact off' })).toBeDefined()
  await ui.press({ key: 'auto' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('30')
  expect(await ui.find({ type: 'Text', text: /already at 35%, past 30%/ })).toBeDefined()
  // left unanswered: as "after my next compact"
  await $.turn.complete(TURN)
  await clock.advance(3_000)
  expect(ran).toEqual([])
  percent.value = 5
  percent.isCompacted = true
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  percent.isCompacted = false
  percent.value = 31
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  await ui.unmount()
})

test('auto compact tries again while the turn is still winding down', async ($, on) => {
  const percent = { value: 16 }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { 'autoCompact:chat': { isOn: true, at: 40 } })
  let tries = 0
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: percent.value * 10_000, percent: percent.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ctx-info' } }))
  // the direct way refused once: /compact from then on, refused while the turn winds down, then run
  on('session.compact', () => {
    throw new Error('a turn is running')
  })
  on('command.run', () => {
    tries += 1
    if (tries < 3) throw new Error('a turn is running')
    return { text: '' }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  percent.value = 45
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  await clock.advance(2_000)
  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(tries).toBe(3)
})

test('a chat opened past the auto compact % compacts at once, as after an app restart', async ($, on) => {
  const percent = { value: 32 }
  const ran: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { 'autoCompact:chat': { isOn: true, at: 30 } })
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: percent.value * 10_000, percent: percent.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ctx-info' } }))
  on('session.compact', () => {
    ran.push('compact')
    percent.value = 8
    return { skip: 'answered by the test' } as never
  })
  on('ui.toast', () => ({ value: undefined }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
})

test('where the session cannot compact directly (the desktop app), auto compact types /compact', async ($, on) => {
  const percent = { value: 32 }
  const ran: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { 'autoCompact:chat': { isOn: true, at: 30 } })
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: percent.value * 10_000, percent: percent.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ctx-info' } }))
  on('session.compact', () => {
    throw new Error('$.session.compact: not available in a headless (-p / SDK) session yet')
  })
  on('command.run', (_$, e) => {
    ran.push(e.command)
    percent.value = 8
    return { text: '' }
  })
  on('ui.toast', () => ({ value: undefined }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(1_100)
  await clock.advance(2_000)
  expect(ran).toEqual(['compact'])
})

test('a narrow chat stacks the band, nothing cut off or dropped', async ($, on) => {
  startWorld(on, { value: 16 }, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 38 } })
    for (const text of ['Context', 'Messages', 'Tools', 'Other']) expect(await ui.find({ text })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ text: 'Context' })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
})

test('the desktop in light mode draws in the light palette', async ($, on) => {
  const clock = startWorld(on, { value: 16 }, [])
  on('env.get', (_$, e) => ({ value: (e as unknown as { name: string }).name === 'APPDATA' ? 'C:/AppData' : undefined }) as never)
  // the settings file is read only when its time changes
  let reads = 0
  let mtimeMs = 1
  on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs, isLink: false } }) as never)
  on('fs.read', () => (reads++, { value: JSON.stringify({ userThemeMode: 'light' }) }) as never)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // green text a shade deeper than the green bars, to read on the pale band
  expect((await ui.find({ type: 'Text', text: '16% used' }))?.props.color).toBe('#16a34a')
  const before = reads
  await clock.advance(10_000)
  expect(reads).toBe(before)
  mtimeMs = 2
  await clock.advance(2_000)
  expect(reads).toBe(before + 1)
  await ui.unmount()
})

test('the settings saved under an old plugin name are copied over once, never over newer ones', async ($, on) => {
  const clock = startWorld(on, { value: 10 }, [], [], 'Compact now', { collapsed: false })
  on('env.get', (_$, e) => ({ value: (e as unknown as { name: string }).name === 'HOME' ? '/home/me' : undefined }) as never)
  const listed: string[] = []
  // This mod's own store from when it was usage-quota wins over the upstream one, newer as that is.
  on('fs.list', (_$, e) => {
    listed.push(String((e as unknown as { path: string }).path))
    return {
      value: [
        { name: 'usage-quota_claude-mods-def456.json', kind: 'file', size: 10, mtimeMs: 1, isLink: false },
        { name: 'claude-code-usage-quota_claude-code-usage-quota-mod-abc123.json', kind: 'file', size: 10, mtimeMs: 2, isLink: false },
      ],
    } as never
  })
  on('fs.read', (_$, e) => {
    const at = String((e as unknown as { path: string }).path).includes('usage-quota_claude-mods-') ? 40 : 70
    return { value: JSON.stringify({ 'autoCompact:chat': { isOn: true, at }, collapsed: true }) } as never
  })
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(3_000)
  // the host gives the path in the platform's own form
  expect(listed).toEqual([expect.stringMatching(/home[\\/]me[\\/]\.claude[\\/]plugins[\\/]store$/)])
  const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Svg', alt: 'Auto compact on' })).toBeDefined()
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('40')
  // collapsed was already set here: kept as it is (expanded: the breakdown shows)
  expect(await ui.find({ text: 'Messages' })).toBeDefined()
  await ui.unmount()
})

test('Context turns amber from 50% and red from 80%', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const state = { percent: 49 }
  on('session.usage', () => {
    const u = usage([])
    return { value: { ...u, context: { ...u.context, percent: state.percent } } }
  })
  answerRest(on, [])
  for (const [percent, color] of [[49, '#4ade80'], [50, '#fbbf24'], [79, '#fbbf24'], [80, '#f87171']] as const) {
    state.percent = percent
    await clock.advance(1_000)
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect((await ui.find({ type: 'Text', text: `${percent}% used` }))?.props.color).toBe(color)
    await ui.unmount()
  }
})

test('passes the band on: a mod beneath draws under the context block', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage([]) }))
  noPlan(on)
  on('session.measure', () => ({ changed: [] }))
  on('ui.status', () => ({ value: undefined }))
  // the mod beneath this one in the band
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other band'] }) as never)
  await $.session.measure(MEASURE)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'ctx-info', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: '16% used' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'other band' })).toBeDefined()
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.indexOf('other band')).toBeGreaterThan(texts.indexOf('16% used'))
    await ui.unmount()
  }
})

test('never asks the usage endpoint: the plan windows live on the usage mod', async ($, on) => {
  const clock = startWorld(on, { value: 16 }, [])
  let fetches = 0
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } } as never
  })
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await $.session.measure(MEASURE)
  await clock.advance(10 * MIN)
  expect(fetches).toBe(0)
})
