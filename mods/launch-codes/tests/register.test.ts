import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Alert } from '../types'

type World = { asks: string[]; answers: string[]; alert: Alert | null; ran: string[]; lines: (string | undefined)[] }

// The engine beneath the mod: the command registers, panes open and close, the ask
// dialog answers from a queue, and a tool call that reaches the bottom runs.
function world(on: On, answers: string[]): World {
  const w: World = { asks: [], answers, alert: null, ran: [], lines: [] }
  on('ui.status', ($, e) => {
    w.lines.push((e as unknown as { text?: string }).text)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('state.set', ($, e, next) => {
    const write = e as unknown as { plugin: string; key: string; value: unknown }
    if (write.plugin === 'launch-codes' && write.key === 'alert') w.alert = write.value as Alert | null
    return next(e)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: {} }))
  // `$.ui.ask` is an AskUserQuestion tool call beneath the plugin; its result carries
  // `answers` keyed by the question's text.
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const questions = (e as unknown as { questions: { question: string }[] }).questions
      const q = questions[0]?.question ?? ''
      w.asks.push(q)
      const a = w.answers.shift() ?? 'ABORT'
      // `CODE` stands for whatever code the mod drew.
      const answer = a === 'CODE' ? (w.alert?.code ?? '') : a
      return { result: { questions, answers: { [q]: answer } } }
    }
    w.ran.push(String((e as unknown as { command?: string; file_path?: string }).command ?? (e as unknown as { file_path?: string }).file_path))
    return { result: 'ran' }
  })
  return w
}

const session = { cwd: '/', surface: 'desktop', isInteractive: true } as const

describe('launch-codes', () => {
  test('a safe command runs without a ceremony', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, [])
    await $.session.start(session)
    const out = await $.tool.call({ tool: 'Bash', command: 'ls -la' })
    expect(out.deny).toBe(undefined)
    expect(w.asks.length).toBe(0)
    expect(w.ran).toEqual(['ls -la'])
  })

  test('ABORT in the dialog denies the command and tells the model not to retry', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, ['ABORT'])
    await $.session.start(session)
    const out = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
    expect(typeof out.deny).toBe('string')
    expect(String(out.deny)).toContain('Do not retry')
    expect(w.ran).toEqual([])
    expect(w.asks.length).toBe(1)
  })

  test('the right code then LAUNCH lets the command run', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, ['CODE', 'LAUNCH'])
    await $.session.start(session)
    const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf ./important' })
    expect(out.deny).toBe(undefined)
    expect(w.ran).toEqual(['rm -rf ./important'])
    expect(w.asks.length).toBe(2)
  })

  test('a wrong code denies', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, ['ZZZZ'])
    await $.session.start(session)
    const out = await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD~1' })
    expect(String(out.deny)).toContain('wrong')
    expect(w.ran).toEqual([])
  })

  test('PowerShell is guarded too', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, ['ABORT'])
    await $.session.start(session)
    const out = await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse -Force C:\\work' })
    expect(typeof out.deny).toBe('string')
    const ok = await $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem' })
    expect(ok.deny).toBe(undefined)
    expect(w.ran).toEqual(['Get-ChildItem'])
  })

  test('.env edits need codes; .env.example does not', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, ['ABORT'])
    await $.session.start(session)
    const blocked = await $.tool.call({ tool: 'Edit', file_path: '/app/.env', old_string: 'A=1', new_string: 'A=2' })
    expect(typeof blocked.deny).toBe('string')
    const fine = await $.tool.call({ tool: 'Write', file_path: '/app/.env.example', content: 'A=' })
    expect(fine.deny).toBe(undefined)
    expect(w.ran).toEqual(['/app/.env.example'])
  })

  for (const kind of ['composer', 'sdk', 'bridge'] as const) {
    test(`/launch-codes off typed by the person (${kind}) skips the checks for the session; on brings them back`, async ($, on) => {
      mock.clock(on, { now: 1_000_000 })
      const w = world(on, ['ABORT'])
      await $.session.start(session)
      const out = await $.command.run({ command: 'launch-codes', args: 'off', origin: { kind } } as never)
      expect(String(out.text)).toContain('OFF for this session')
      expect(String(w.lines[w.lines.length - 1])).toContain('launch-codes OFF')
      // Risky commands and .env edits now run with no dialog.
      expect((await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })).deny).toBe(undefined)
      expect((await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse -Force C:\\work' })).deny).toBe(undefined)
      expect((await $.tool.call({ tool: 'Edit', file_path: '/app/.env', old_string: 'A=1', new_string: 'A=2' })).deny).toBe(undefined)
      expect(w.asks.length).toBe(0)
      // The reminder is pinned again at each turn.
      w.lines.length = 0
      await $.turn.start({ text: 'go', turnId: 't1' })
      expect(String(w.lines[w.lines.length - 1])).toContain('launch-codes OFF')
      // On again: the guard asks, and ABORT blocks.
      await $.command.run({ command: 'launch-codes', args: 'on', origin: { kind } } as never)
      expect(w.lines[w.lines.length - 1]).toBe(undefined)
      expect(typeof (await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })).deny).toBe('string')
      expect(w.asks.length).toBe(1)
    })
  }

  for (const origin of [{ kind: 'plugin', name: 'some-mod' }, { kind: 'peer' }, { kind: 'scheduled-trigger' }, { kind: 'task-notification' }, { kind: 'unclassified' }]) {
    test(`/launch-codes off from ${origin.kind} is refused and the guard stays on`, async ($, on) => {
      mock.clock(on, { now: 1_000_000 })
      const w = world(on, ['ABORT'])
      await $.session.start(session)
      const out = await $.command.run({ command: 'launch-codes', args: 'off', origin } as never)
      expect(String(out.text)).toContain('only works when you type it yourself')
      expect(typeof (await $.tool.call({ tool: 'Bash', command: 'rm -rf ./important' })).deny).toBe('string')
      expect(w.ran).toEqual([])
    })
  }

  test('/launch-codes test says which commands need codes', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    world(on, [])
    await $.session.start(session)
    const risky = await $.command.run({ command: 'launch-codes', args: 'test git push --force' })
    expect(String(risky.text)).toContain('Needs launch codes')
    const safe = await $.command.run({ command: 'launch-codes', args: 'test git status' })
    expect(String(safe.text)).toContain('Safe')
  })
})
