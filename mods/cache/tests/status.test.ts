import { expect, mock, test } from 'claude-code/testing'

import { forkRestart, handoffPath, lastLines, pickAction, setMainAt, tailCommand } from '../hooks/register'

// The countdown is a status line entry under the prompt, pinned once a second by the tick
test('each tick pins the countdown on the status line', async ($, on) => {
  mock.store(on, {})
  mock.env(on, {})
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  const lines: unknown[] = []
  on('ui.status', (_$, e: any) => { lines.push(e.text); return { value: undefined } as never })
  await $.session.start({ cwd: '/nowhere', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  expect(String(lines[lines.length - 1])).toBe('◷ no request yet · 1h ttl')
})

const MIN = 60_000
// The status line's first piece, '◷ 10:00 left', read through /cache (the same text)
// so it comes from the module the harness loaded, not this file's import of it
async function cachePiece($: any) {
  return String((await $.command.run({ command: 'cache', args: '' })).text).split(' · ')[0]
}

for (const [command, args] of [['recap', ''], ['btw', 'what word did you reply with?']]) {
  test(`/${command} restarts the main cache clock, though no turn.step fires for it (#15)`, async ($, on) => {
    let now = 1_000_000
    on('clock.now', () => ({ value: now }))
      on('turn.step', async function* (_$, e) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any })
    on('command.run', () => ({ text: 'side answer' }))

    // Before any main request there is nothing cached to keep warm
    await $.command.run({ command, args } as any)
    expect(await cachePiece($)).toBe('◷ no request yet')

    // A main turn starts the hour; 50 minutes later 10 are left
    const step = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)
    for await (const _ of step);
    now += 50 * MIN
    expect(await cachePiece($)).toBe('◷ 10:00 left')

    // The side request reads the cache: a full hour again
    await $.command.run({ command, args } as any)
    expect(await cachePiece($)).toBe('◷ 60:00 left')
  })
}

test('a side request on a cold cache, or a bare /btw, leaves the clock alone', async ($, on) => {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('turn.step', async function* (_$, e) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any })
  on('command.run', () => ({ text: 'ok' }))
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)
  for await (const _ of step);
  now += 50 * MIN
  await $.command.run({ command: 'btw', args: '  ' } as any)
  expect(await cachePiece($)).toBe('◷ 10:00 left')
  now += 20 * MIN
  await $.command.run({ command: 'recap', args: '' } as any)
  expect(await cachePiece($)).toBe('◷ cold')
})

// A mod's fork over the transcript (cache-warmer's ping) reads the main cache like a side request does
test('a fork served from a warm cache restarts the main clock; a miss or a cold cache leaves it alone', async () => {
  const MIN = 60_000
  const served = (n: number) => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: n, cache_creation_input_tokens: 0 } } })
  setMainAt(1_000_000)
  // 50 minutes in, served from cache: a full hour again
  expect(forkRestart(1_000_000 + 50 * MIN, served(400_000))).toBe(true)
  // a miss (nothing read back) leaves the clock where it was
  expect(forkRestart(1_000_000 + 55 * MIN, served(0))).toBe(false)
  // a failed fork leaves it alone
  expect(forkRestart(1_000_000 + 55 * MIN, { value: { isAnswered: false, reason: 'api-error' } })).toBe(false)
  // the cache already lapsed: a fork then is a cold write, not a warm read
  setMainAt(1_000_000)
  expect(forkRestart(1_000_000 + 61 * MIN, served(400_000))).toBe(false)
})

test('another command leaves the cache clock alone', async ($, on) => {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('turn.step', async function* (_$, e) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any })
  on('command.run', () => ({ text: 'ok' }))
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)
  for await (const _ of step);
  now += 50 * MIN
  await $.command.run({ command: 'cost', args: '' } as any)
  expect(await cachePiece($)).toBe('◷ 10:00 left')
})

test('the warning action comes from the env var, then the old switch, then the setting', async () => {
  expect(pickAction(undefined, undefined, undefined)).toBe('off')
  expect(pickAction(undefined, undefined, 'off')).toBe('off')
  expect(pickAction(undefined, '0', 'handoff')).toBe('off')
  expect(pickAction('handoff', '0', 'off')).toBe('handoff')
  // compact is gone (Claude Code's idle compaction does it); an old saved value means off
  expect(pickAction(undefined, undefined, 'compact')).toBe('off')
  expect(pickAction('compact', undefined, 'handoff')).toBe('off')
  expect(pickAction('nonsense', undefined, undefined)).toBe('off')
})

test('each session gets its own handoff note', async () => {
  expect(handoffPath('/w/proj', '1a2b3c4d-5e6f-7a8b-9c0d-ef0123456789')).toBe('/w/proj/HANDOFF-1a2b3c4d.md')
  expect(handoffPath('/w/notes/', '9f8e7d6c-0000')).toBe('/w/notes/HANDOFF-9f8e7d6c.md')
})

test('a Windows handoff folder with a trailing backslash gets one separator', async () => {
  expect(handoffPath('C:\\proj\\', '1a2b3c4d-0000')).toBe('C:\\proj/HANDOFF-1a2b3c4d.md')
})

test('lastLines takes the end of LF and CRLF text, like tail -n', async () => {
  expect(lastLines('a\nb\nc\n', 2)).toEqual(['b', 'c'])
  expect(lastLines('a\r\nb\r\nc\r\n', 2)).toEqual(['b', 'c'])
  expect(lastLines('a\nb', 5)).toEqual(['a', 'b'])
  expect(lastLines('', 3)).toEqual([])
})

test('tail reads the end on Mac and Linux; PowerShell on Windows, with the path in an env var', async () => {
  expect(tailCommand(false, '/t/s.jsonl')).toEqual([['tail', '-n', '300', '/t/s.jsonl'], {}])
  const path = "C:\\Users\\U\\.claude\\projects\\p\\a'b.jsonl"
  const [argv, init] = tailCommand(true, path)
  expect(argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  expect(argv[4]).not.toContain(path)
  expect(init).toEqual({ env: { CACHE_CLOCK_FILE: path } })
})

// Headless (-p, SDK): no timer and no /cache command. The timer is
// what would submit handoff turns, so it must not exist without a person.
test('headless session starts no timer and no command', async ($, on) => {
  mock.store(on, {})
  mock.env(on, {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let timers = 0
  let commands = 0
  on('clock.every', () => { timers += 1; return { value: undefined } as never })
  on('command.register', () => { commands += 1; return { value: undefined } as never })
  await $.session.start({ cwd: '/nowhere', surface: 'terminal', isInteractive: false })
  expect(timers).toBe(0)
  expect(commands).toBe(0)
})

// Positive control: the same probes fire in an interactive session, so the
// headless test above cannot pass just because the event names are wrong.
test('interactive session starts the timer and the command', async ($, on) => {
  mock.store(on, {})
  mock.env(on, {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { context: 0 } }) as never)
  let timers = 0
  let commands = 0
  on('clock.every', () => { timers += 1; return { value: undefined } as never })
  on('command.register', () => { commands += 1; return { value: undefined } as never })
  await $.session.start({ cwd: '/nowhere', surface: 'terminal', isInteractive: true })
  expect(timers).toBe(1)
  expect(commands).toBe(1)
})

// classic.SessionStart fires before session.start, so it must not read the
// transcript itself: in a headless session that read is a wasted tail/PowerShell spawn
for (const isInteractive of [false, true]) {
  test(`${isInteractive ? 'interactive' : 'headless'} session ${isInteractive ? 'reads' : 'never reads'} the transcript at start`, async ($: any, on) => {
    mock.store(on, {})
    mock.env(on, {})
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('clock.every', () => ({ value: undefined }) as never)
    on('clock.now', () => ({ value: 1_000_000 }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    let runs = 0
    on('process.run', () => { runs += 1; return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
    on('classic.SessionStart', () => ({}) as never)
    await $.classic.SessionStart({ transcript_path: '/nowhere/t.jsonl' })
    await $.session.start({ cwd: '/nowhere', surface: 'terminal', isInteractive })
    expect(runs).toBe(isInteractive ? 1 : 0)
  })
}
