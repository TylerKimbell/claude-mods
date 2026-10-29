// launch-codes: adapted from OneWave AI's launch-codes (MIT). Guards Bash and PowerShell
// commands and edits to .env files behind a code the person types, then a LAUNCH.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Alert, Phase } from '../types'
import { classify, classifyPowerShell, isCode, isProtectedFile, makeCode } from './classify'

const PANE = 'launch-codes'
const DEFAULT_CODE_SECONDS = 45

const alert = atom({ plugin: 'launch-codes', key: 'alert' } as const, null as Alert | null)
// Session state: survives /reload-plugins, starts false in every new session.
const off = atom({ plugin: 'launch-codes', key: 'isOff' } as const, false)

// The status line entry under the prompt, headed by the plugin's name (the app adds it):
// `launch-codes on` or `launch-codes off`.
const ON_STATUS = 'on'
const OFF_STATUS = 'off'
const statusOf = (isOff: boolean) => (isOff ? OFF_STATUS : ON_STATUS)
// Who may switch the guard off: the person, typing at a terminal (composer), through
// Remote Control (bridge), or in a host such as the desktop app (sdk). Never a
// notification, a schedule, another session, a channel, a plugin, or an origin the
// engine cannot attest.
export const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

const RED = '#e5484d'
const GOLD = '#c2a87e'
const PAPER = '#E8E2D6'
const INK = '#0a0606'

const random = (n: number) => {
  const box = new Uint32Array(1)
  crypto.getRandomValues(box)
  return box[0]! % n
}

const setPhase = ($: EngineInterface, phase: Phase) => update($, alert, a => (a ? { ...a, phase } : a))

const short = (text: string) => (text.length > 70 ? `${text.slice(0, 67)}...` : text)

type Verdict = { isLaunch: boolean; why: string }

/**
 * Runs the whole ceremony for one action and says whether it may go ahead.
 * Every wait is a `$` call (the ask dialog), so none of it spends the hook's budget.
 */
const ceremony = async ($: EngineInterface, tool: string, command: string, reason: string, isDemo: boolean, ttlMs: number): Promise<Verdict> => {
  const now = await $.clock.now()
  const code = makeCode(random)
  await update($, alert, () => ({
    tool,
    command,
    reason,
    code,
    startedAt: now,
    expiresAt: now + ttlMs,
    phase: 'code' as Phase,
    isDemo,
  }))
  await $.ui.open({ id: PANE, title: 'RED ALERT', rows: 14 })
  // Repaint once a second for the countdown.
  const tick = $.clock.every(1000, () => $.ui.invalidate('ui.render'))

  const finish = async (phase: Phase, verdict: Verdict) => {
    tick.cancel()
    await setPhase($, phase)
    $.clock.after(phase === 'launched' ? 1500 : 2500, () => {
      void $.ui.close({ id: PANE }).then(() => update($, alert, () => null))
    })
    return verdict
  }

  const what = tool === 'Edit' || tool === 'Write' ? `${tool} ${short(command)}` : short(command)

  try {
    const typed = await $.ui.ask(
      `Launch codes required: ${what}. Type the 4-character code from the RED ALERT pane under "Other" to arm it.`,
      { header: 'LAUNCH CODE', options: ['ABORT', 'ABORT and find a safer way'] },
    )
    if (!isCode(typed, code)) {
      const why = typed.startsWith('ABORT') ? 'the user pressed ABORT' : 'the launch code was wrong'
      return finish('aborted', { isLaunch: false, why })
    }
    if ((await $.clock.now()) > now + ttlMs) {
      return finish('aborted', { isLaunch: false, why: 'the launch code expired before it was entered' })
    }
    await setPhase($, 'armed')
    const fire = await $.ui.ask(`ARMED. Fire ${what}?`, { header: 'ARMED', options: ['LAUNCH', 'ABORT'] })
    if (fire !== 'LAUNCH') return finish('aborted', { isLaunch: false, why: 'the user pressed ABORT after arming' })
    return finish('launched', { isLaunch: true, why: 'launched' })
  } catch {
    return finish('aborted', { isLaunch: false, why: 'no one was there to enter the launch code' })
  }
}

const deny = (what: string, reason: string, why: string) => ({
  deny:
    `launch-codes: blocked \`${short(what)}\` (${reason}) because ${why}. ` +
    'Do not retry it or work around the check; tell the user what you wanted to do and ask, or find a safer way.',
})

export const register: Register = (on, options) => {
  const ttlMs = () => {
    const s = Number(options.codeSeconds)
    return (Number.isFinite(s) && s > 0 ? s : DEFAULT_CODE_SECONDS) * 1000
  }
  const isEnvGuarded = () => options.protectEnv !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'launch-codes',
      description: 'Launch codes for risky commands: /launch-codes [demo | test <command> | off | on]',
    })
    // The status line says whether the guard is on; after a reload a session that switched it off still says so.
    $.ui.status(statusOf(await read($, off)))
    return next(e)
  })

  // The entry is pinned again at each turn: one set while a session starts can land
  // before the app attaches.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) $.ui.status(statusOf(await read($, off)))
    return next(e)
  })

  // --- Bash
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (await read($, off)) return next(e)
    const danger = classify(e.command)
    if (!danger) return next(e)
    const verdict = await ceremony($, 'Bash', e.command, danger.reason, false, ttlMs())
    return verdict.isLaunch ? next(e) : deny(e.command, danger.reason, verdict.why)
  })
    // A hook that fails must not let the command through.
    .catch(($, e, next) => {
      if (next.called) return next(e)
      const danger = classify(e.command)
      return danger ? deny(e.command, danger.reason, 'the launch check failed') : { deny: 'launch-codes: the launch check failed; ask the user before retrying.' }
    })

  // --- PowerShell
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    if (await read($, off)) return next(e)
    const danger = classifyPowerShell(e.command)
    if (!danger) return next(e)
    const verdict = await ceremony($, 'PowerShell', e.command, danger.reason, false, ttlMs())
    return verdict.isLaunch ? next(e) : deny(e.command, danger.reason, verdict.why)
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const danger = classifyPowerShell(e.command)
    return danger ? deny(e.command, danger.reason, 'the launch check failed') : { deny: 'launch-codes: the launch check failed; ask the user before retrying.' }
  })

  // --- .env files
  const ENV_REASON = 'edits a .env file that may hold secrets'
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (await read($, off)) return next(e)
    if (!isEnvGuarded() || !isProtectedFile(e.file_path)) return next(e)
    const verdict = await ceremony($, 'Edit', e.file_path, ENV_REASON, false, ttlMs())
    return verdict.isLaunch ? next(e) : deny(e.file_path, ENV_REASON, verdict.why)
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    return isEnvGuarded() && isProtectedFile(e.file_path) ? deny(e.file_path, ENV_REASON, 'the launch check failed') : next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (await read($, off)) return next(e)
    if (!isEnvGuarded() || !isProtectedFile(e.file_path)) return next(e)
    const verdict = await ceremony($, 'Write', e.file_path, ENV_REASON, false, ttlMs())
    return verdict.isLaunch ? next(e) : deny(e.file_path, ENV_REASON, verdict.why)
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    return isEnvGuarded() && isProtectedFile(e.file_path) ? deny(e.file_path, ENV_REASON, 'the launch check failed') : next(e)
  })

  // --- /launch-codes
  on('command.run', { command: 'launch-codes' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off' || arg === 'on') {
      const from = e.origin?.kind ?? 'unknown'
      if (!PERSON_ORIGINS.has(from)) {
        return { text: `launch-codes: /launch-codes ${arg} only works when you type it yourself (this one came from ${from}). Nothing changed.` }
      }
      await update($, off, () => arg === 'off')
      $.ui.status(statusOf(arg === 'off'))
      return {
        text:
          arg === 'off'
            ? 'Launch codes OFF for this session: risky commands and .env edits run without a code. /launch-codes on turns the guard back on. New sessions start guarded.'
            : 'Launch codes on: risky commands and .env edits need a code again.',
      }
    }
    if (arg.startsWith('test ')) {
      const cmd = arg.slice(5)
      const danger = classify(cmd) ?? classifyPowerShell(cmd)
      return { text: danger ? `Needs launch codes: ${danger.reason}.` : 'Safe: runs without launch codes.' }
    }
    if (arg === 'demo' || arg === '') {
      const command = 'rm -rf ~/Projects/prod-backup && git push --force origin main'
      const verdict = await ceremony($, 'Bash', command, 'rm -rf on ~/Projects/prod-backup', true, ttlMs())
      return { text: verdict.isLaunch ? 'Demo: LAUNCHED. (Nothing ran, it was a demo.)' : `Demo: aborted, ${verdict.why}. Nothing ran.` }
    }
    return { text: 'Usage: /launch-codes demo | test <command> | off | on' }
  })

  // --- the pane
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const a = await read($, alert)
    const now = await $.clock.now()
    const width = Math.max(30, (e.props.bodyColumns || e.viewport?.columns || 80) - 2)
    if (!a) {
      return (
        <Box paddingX={1}>
          <Text dimColor>All quiet. Risky commands will raise the alarm here.</Text>
        </Box>
      )
    }

    const left = Math.max(0, Math.ceil((a.expiresAt - now) / 1000))
    const isFlash = Math.floor(now / 400) % 2 === 0
    const banner: Record<Phase, { text: string; color: string }> = {
      code: { text: 'LAUNCH CODES REQUIRED', color: RED },
      armed: { text: 'ARMED  -  CONFIRM LAUNCH', color: GOLD },
      launched: { text: 'LAUNCHED', color: GOLD },
      aborted: { text: 'ABORTED  -  NOTHING RAN', color: PAPER },
    }
    const head = banner[a.phase]
    const stripe = <Text color={RED}>{'/'.repeat(width)}</Text>

    return (
      <Box flexDirection="column" paddingX={1}>
        {stripe}
        <Box justifyContent="space-between" marginTop={1}>
          <Text bold backgroundColor={head.color} color={INK}>{` ${head.text} `}</Text>
          <Text dimColor>
            {a.isDemo ? 'DEMO  ' : ''}
            {a.phase === 'code' ? `code expires in ${left}s` : ''}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{a.tool === 'Edit' || a.tool === 'Write' ? `${a.tool.toUpperCase()} FILE` : `${a.tool.toUpperCase()} COMMAND`}</Text>
          <Text bold color={PAPER} wrap="wrap">
            {a.command}
          </Text>
          <Text color={RED}>{a.reason}</Text>
        </Box>
        {a.phase === 'code' && (
          <Box marginTop={1} gap={2}>
            <Text dimColor>LAUNCH CODE</Text>
            <Text bold color={isFlash ? GOLD : PAPER}>
              {a.code.split('').join('  ')}
            </Text>
          </Box>
        )}
        {a.phase === 'code' && <Text dimColor>Type it under "Other" in the dialog, then confirm LAUNCH. ABORT blocks it.</Text>}
        {a.phase === 'armed' && (
          <Text color={GOLD} bold>
            Code accepted. Choose LAUNCH to fire or ABORT to stand down.
          </Text>
        )}
        <Box marginTop={1}>{stripe}</Box>
      </Box>
    )
  })
}
