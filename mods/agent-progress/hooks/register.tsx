// agent-progress: a bar above the prompt and an Agents pane for the subagents Claude starts.
// Based on Barncore's agent-watch, a fork of johnnyvizz's savvy-progress (both MIT), with the
// savvy-flow orchestration, the tier costumes and the localisation taken out, and a line added
// to each subagent's brief so it reports its own steps.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Bar, Panel } from '../types'

const PANE = 'agent-progress'
const STEP_TOOL = 'mcp__agent-progress__step'
export const FLUSH_MS = 5_000

const bar = atom({ plugin: 'agent-progress', key: 'bar' } as const, null as Bar | null)
const agents = atom({ plugin: 'agent-progress', key: 'agents' } as const, [] as AgentRun[])
const panel = atom({ plugin: 'agent-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  hasAutoOpened: false,
} as Panel)

const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
const FAILED = '#e5484d'
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

// The line appended to a subagent's brief when `askForSteps` is on.
export const STEP_NOTE =
  '\n\n(Progress reporting: right after you plan your work, call the `' +
  STEP_TOOL +
  '` tool with `total` (your steps, 3 to 8) and `done: 0`, then call it again as each step finishes with `done` and a short `note`. It is cheap and silent: it only draws a progress bar for the person.)'

// ---------------------------------------------------------------------------
// Numbers

// USD per million tokens: input, output, cache read, cache write. The engine reports
// tokens, not money, so the pane's cost is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string): [number, number, number, number] =>
  PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

const costOf = (model: string, u: Usage): number => {
  const [i, o, r, w] = priceOf(model)
  return (
    ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
  )
}

const sumOf = (u: Usage): number =>
  (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, tokens, time: list.length ? end - start : 0 }
}

const ratio = (b: Bar): number => (b.isFinished ? 1 : b.total ? b.done / b.total : 0)

const barLabel = (b: Bar): string => (b.isFinished ? 'Done' : `${b.done}/${b.total}`)

/** The run's own progress when it reports steps; a finished run is full; else null. */
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

const textBar = (fraction: number, width: number): string => {
  const filled = Math.round(width * Math.max(0, Math.min(1, fraction)))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// ---------------------------------------------------------------------------
// The band's row on the desktop: one SVG, since the desktop wraps sibling elements.

const H = 22
const BAR_H = 12

const rowSvg = (b: Bar, W: number): string => {
  const title = b.isFinished ? 'Subagents done' : `Subagents ${b.done}/${b.total}${b.running ? ` · ${b.running} running` : ''}`
  const titleW = Math.round(title.length * 7.2)
  const BAR_X = 16 + titleW + 12
  const BAR_W = Math.max(60, W - BAR_X - 48)
  const color = b.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(b))
  const runW = b.total ? Math.round((BAR_W * Math.min(b.total, b.done + b.running)) / b.total) : 0
  const percent = `${Math.round(ratio(b) * 100)}%`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"${b.isFinished || !b.running ? '' : ' class="live"'}/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<rect width="${runW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}" opacity="0.3"/>
<rect width="${fillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
</g>
<text class="m" x="${W - 4}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Pane helpers

async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: 'Agents' })
  return true
}

async function autoOpen($: EngineInterface): Promise<void> {
  const p = await read($, panel)
  if (p.hasAutoOpened) return
  await update($, panel, prev => ({ ...prev, hasAutoOpened: true }))
  void $.ui.open({ id: PANE, title: 'Agents' })
}

// ---------------------------------------------------------------------------
// Live numbers in batches: a state write redraws every mod on screen, so a subagent's
// per-request usage waits here and is written once per FLUSH_MS; the same tick moves the clocks.

type Pending = { model: string; effort?: string; contextTokens: number; tokens: number; costUsd: number; steps: number }
type Ticker = { pending: Map<string, Pending>; isTicking: boolean }

async function flush($: EngineInterface, t: Ticker): Promise<boolean> {
  if (t.pending.size === 0) return false
  const batch = new Map(t.pending)
  t.pending.clear()
  await update($, agents, list =>
    list.map(a => {
      const p = a.agentId ? batch.get(a.agentId) : undefined
      if (!p) return a
      return {
        ...a,
        model: p.model,
        effort: p.effort ?? a.effort,
        contextTokens: p.contextTokens,
        contextMax: windowOf(p.model),
        tokens: a.tokens + p.tokens,
        costUsd: a.costUsd + p.costUsd,
        steps: a.steps + p.steps,
      }
    }),
  )
  return true
}

async function tick($: EngineInterface, t: Ticker): Promise<void> {
  const wrote = await flush($, t)
  const list = await read($, agents)
  if (!list.some(a => a.status === 'running')) {
    t.isTicking = false
    return
  }
  if (!wrote) $.ui.invalidate('ui.render')
  $.clock.after(FLUSH_MS, () => {
    void tick($, t)
  })
}

function startTicking($: EngineInterface, t: Ticker): void {
  if (t.isTicking) return
  t.isTicking = true
  $.clock.after(FLUSH_MS, () => {
    void tick($, t)
  })
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  const ticker: Ticker = { pending: new Map(), isTicking: false }
  const shouldAutoOpen = () => options.autoOpen !== false
  const shouldAskForSteps = () => options.askForSteps !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'step',
      description:
        'For subagents: report progress on your own task to the Agents pane. ' +
        'Right after planning, call it with `total` (your steps, 3 to 8) and `done: 0`; call it again as each step finishes. ' +
        'Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'agents',
      description: 'Show or hide the Agents pane: running and finished subagents with model, progress, context, cost and time',
    })
    return started
  })

  on('command.run', { command: 'agents' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'Agents pane opened.' : 'Agents pane closed.' }
  })

  // A subagent's own progress: the call runs in its loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
      }),
    )
    return { result: 'ok' }
  })

  on('agent.spawn', async ($, e, next) => {
    // A fork inherits the parent's conversation whole; its prompt is left alone.
    const isFork = e.subagentType === 'fork'
    const started = await next(shouldAskForSteps() && !isFork && !e.prompt.includes(STEP_TOOL) ? { ...e, prompt: e.prompt + STEP_NOTE } : e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    await update($, agents, list => {
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-200)
    })
    await update($, bar, prev => {
      const base: Bar = prev && !prev.isFinished ? prev : { total: 0, done: 0, running: 0, isFinished: false }
      return { ...base, total: base.total + 1, running: base.running + 1 }
    })
    startTicking($, ticker)
    if (shouldAutoOpen()) await autoOpen($)
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    const held = ticker.pending.get(agentId)
    const tokens = sumOf(usage)
    ticker.pending.set(agentId, {
      model,
      effort: typeof e.effort === 'string' ? e.effort : held?.effort,
      contextTokens: tokens,
      tokens: (held?.tokens ?? 0) + tokens,
      costUsd: (held?.costUsd ?? 0) + costOf(model, usage),
      steps: (held?.steps ?? 0) + 1,
    })
    startTicking($, ticker)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      // The run's last requests land before it is marked done.
      await flush($, ticker)
      const at = await $.clock.now()
      const known = (await read($, agents)).some(a => a.agentId === agentId)
      await update($, agents, list =>
        list.map(a => {
          if (a.agentId !== agentId) return a
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? { model: e.usage.model || a.model, tokens: sumOf(e.usage), costUsd: costOf(e.usage.model || a.model, e.usage) }
              : {}),
          }
        }),
      )
      if (known) {
        await update($, bar, prev => {
          if (!prev || prev.isFinished) return prev
          const running = Math.max(0, prev.running - 1)
          const done = Math.min(prev.total, prev.done + 1)
          return running === 0 ? { ...prev, running, done, isFinished: true } : { ...prev, running, done }
        })
      }
    }
    return next(e)
  })

  // A finished bar has been seen once the person writes again.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') {
      const b = await read($, bar)
      if (b?.isFinished) await update($, bar, () => null)
    }
    return next(e)
  })

  // --- the Agents pane
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, agents)
    const p = await read($, panel)
    const at = Math.max(await $.clock.now(), ...list.map(a => a.startedAt), 0)
    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const t = totals(list, at)
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(24, cols - 30))

    const toggleCompact = (
      <Button key="compact" label={p.isCompact ? 'Expand' : 'Collapse'} plain onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))} />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} Finished · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )

    const row = (a: AgentRun) => {
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const color = a.status === 'failed' ? FAILED : a.status === 'done' ? DONE : ACCENT
      const glyph = a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'
      const model = a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={color}>{glyph}</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {a.type} · {model}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{textBar(ctx / 100, barW)}</Text> : <Text color={color}>{textBar(progress, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}ctx {ctx}% · {fmtTokens(a.tokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
            </Text>
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} tokens · {fmtTime(t.time)}
          </Text>
          {toggleCompact}
        </Box>
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...running, ...finished].map(a => (
              <Text key={a.id} color={a.status === 'failed' ? FAILED : a.status === 'done' ? DONE : ACCENT}>
                {a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'}{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
            {running.length > 0 && <Text dimColor>Running · {running.length}</Text>}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
          </Box>
        )}
      </Box>
    )
  })

  // --- the band above the prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, bar)
    if (b === null || e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Other mods' rows stay in the band; an empty Box when nothing sits beneath.
    const rest = await next(e).catch(() => Box({ children: [] }))
    const list = await read($, agents)
    const percent = `${Math.round(ratio(b) * 100)}%`
    const crew = <Button key="agent-progress-crew" label={`×${list.length}`} plain onPress={() => void togglePane($)} />
    const dismiss = <Button key="agent-progress-dismiss" label="✕" plain role="dismiss" onPress={() => update($, bar, () => null)} />
    const alt = `Subagents: ${barLabel(b)}, ${percent}`

    // The terminal draws the row in text; every other surface gets one SVG.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss and their gaps.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={rowSvg(b, width)} alt={alt} width={width} height={H} />
            {crew}
            {dismiss}
          </Box>
        </Box>
      )
    }

    const cols = e.props.bodyColumns || 80
    const width = Math.max(6, Math.min(40, cols - 44))
    const color = b.isFinished ? DONE : ACCENT
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" gap={2}>
          <Text color={color}>● Subagents</Text>
          <Text color={color}>{textBar(ratio(b), width)}</Text>
          <Text bold>{barLabel(b)}</Text>
          {b.running > 0 && !b.isFinished && <Text dimColor>{b.running} running</Text>}
          <Text dimColor>{percent}</Text>
          {crew}
          {dismiss}
        </Box>
      </Box>
    )
  })
}
