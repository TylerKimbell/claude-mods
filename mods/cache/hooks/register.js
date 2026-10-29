// Fork of Ray Amjad's cache-clock 0.5.4 (MIT) in TylerKimbell/claude-mods: also restarts the clock on a mod's fork over the transcript.
// cache (the mod was cache-clock): a status line entry under the prompt that counts down until the prompt cache
// goes cold. The status line stays on screen when the desktop app's next-step card covers the
// band above the prompt; context use is usage-quota's band.

// Defaults, in minutes. Each can be changed with an environment variable.
const DEFAULT_MAIN_TTL_MIN = 60 // main session cache (matches what the transcripts record)
const DEFAULT_SUB_TTL_MIN = 5 // subagent cache
const DEFAULT_WARN_MIN = 5 // toast (and the onWarning action) when this much is left

const MIN = 60_000

// State shared by the hooks below
const cfg = { mainTtl: DEFAULT_MAIN_TTL_MIN * MIN, subTtl: DEFAULT_SUB_TTL_MIN * MIN, warn: DEFAULT_WARN_MIN * MIN, sound: false, pinned: false, onWarning: 'handoff', handoffDir: '' }
let mainAt = 0 // when the main session last sent a request (ms)
let subAt = 0 // when a subagent last sent one
let warned = false // toast already shown for this warm period
let wentCold = false // "went cold" already shown
let working = false // a turn is running
let handedOff = false // handoff done since the user last sent something
let transcript = null // path to this session's .jsonl
let headless = false // -p / SDK session: no band, so skip the transcript reads too

// Read a number of minutes from an env var, or keep the default
function minutes(value, fallback) {
  const n = parseFloat(value ?? '')
  return Number.isFinite(n) && n > 0 ? n * MIN : fallback
}

const ACTIONS = ['handoff', 'off']

// What the warning does: the env var, then the old CACHE_CLOCK_AUTO_HANDOFF=0, then the setting.
// The old 'compact' choice means 'off' now: Claude Code's own idle compaction does that job.
export function pickAction(envAction, envAutoHandoff, setting) {
  let action = envAction ?? (envAutoHandoff === '0' ? 'off' : setting)
  if (action === 'compact') action = 'off'
  return ACTIONS.includes(action) ? action : 'off'
}

async function loadConfig($, options) {
  const main = await $.env.get('CACHE_CLOCK_MAIN_TTL_MIN')
  cfg.mainTtl = minutes(main, DEFAULT_MAIN_TTL_MIN * MIN)
  cfg.pinned = main !== undefined // a value you set wins over the transcript
  cfg.subTtl = minutes(await $.env.get('CACHE_CLOCK_SUB_TTL_MIN'), DEFAULT_SUB_TTL_MIN * MIN)
  cfg.warn = minutes(await $.env.get('CACHE_CLOCK_WARN_MIN'), DEFAULT_WARN_MIN * MIN)
  cfg.sound = (await $.env.get('CACHE_CLOCK_SOUND')) === '1'
  cfg.handoffDir = (await $.env.get('CACHE_CLOCK_HANDOFF_DIR')) ?? ''
  // The plugin setting, unless an env var overrides it. CACHE_CLOCK_AUTO_HANDOFF=0 still means off.
  cfg.onWarning = pickAction(await $.env.get('CACHE_CLOCK_ON_WARNING'), await $.env.get('CACHE_CLOCK_AUTO_HANDOFF'), options?.onWarning)
}

// The real TTL: each assistant row in the transcript says which cache bucket
// it wrote to (ephemeral_1h or ephemeral_5m). Read the newest main-thread one.
async function readTtl($) {
  if (!transcript || cfg.pinned) return
  for (const row of (await lastRows($, transcript)).reverse()) {
    if (!row.includes('"cache_creation"')) continue
    let msg
    try { msg = JSON.parse(row) } catch { continue }
    if (msg.type !== 'assistant' || msg.isSidechain) continue
    const cc = msg.message?.usage?.cache_creation ?? {}
    if (cc.ephemeral_1h_input_tokens > 0) { cfg.mainTtl = 60 * MIN; return }
    if (cc.ephemeral_5m_input_tokens > 0) { cfg.mainTtl = 5 * MIN; return }
    // a pure cache read does not say which bucket; look further back
  }
}

// The transcript's last 300 rows. A long session's transcript is past the
// 4 MiB $.fs.read takes, so a command reads its end: `tail` on Mac and Linux,
// PowerShell on Windows, which has no tail (the path goes in an env var, not
// the script). If the command fails, $.fs.read is the last resort.
export function tailCommand(isWindows, path) {
  if (!isWindows) return [['tail', '-n', '300', path], {}]
  const script =
    '$r = New-Object IO.StreamReader((New-Object IO.FileStream($env:CACHE_CLOCK_FILE, "Open", "Read", "ReadWrite")), [Text.Encoding]::UTF8); ' +
    '$q = New-Object System.Collections.Generic.Queue[string]; ' +
    'while ($null -ne ($l = $r.ReadLine())) { $q.Enqueue($l); if ($q.Count -gt 300) { [void]$q.Dequeue() } }; ' +
    '$b = [Text.Encoding]::UTF8.GetBytes(($q -join "`n") + "`n"); [Console]::OpenStandardOutput().Write($b, 0, $b.Length)'
  return [['powershell', '-NoProfile', '-NonInteractive', '-Command', script], { env: { CACHE_CLOCK_FILE: path } }]
}
async function lastRows($, path) {
  try {
    const [argv, init] = tailCommand((await $.env.get('OS')) === 'Windows_NT', path)
    const r = await $.process.run(argv, init)
    if (r.exitCode === 0) return lastLines(r.stdout, 300)
  } catch {}
  return lastLines(await $.fs.read(path).catch(() => ''), 300)
}

// The last n lines of a file's text, CRLF or LF
export function lastLines(text, n) {
  const lines = String(text).split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-n)
}

// 47:05 or 3:09
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

// Everything the status line shows, as plain pieces so /cache can print it too
function snapshot(now) {
  const left = mainAt ? mainAt + cfg.mainTtl - now : 0
  const subLeft = subAt ? subAt + cfg.subTtl - now : 0
  // Colour: green, then yellow in the last quarter, red inside the warning window
  let color = 'green'
  if (!mainAt || left <= 0) color = 'gray'
  else if (left <= cfg.warn) color = 'red'
  else if (left <= cfg.mainTtl / 4) color = 'yellow'
  const ttl = (cfg.mainTtl >= 60 * MIN ? cfg.mainTtl / (60 * MIN) + 'h' : cfg.mainTtl / MIN + 'm') + ' ttl'
  const cache = !mainAt ? 'no request yet' : left > 0 ? clock(left) + ' left' : 'cold'
  const sub = subLeft > 0 ? 'sub ' + clock(subLeft) : null
  return { color, cache, ttl, sub, left }
}

// The status line entry and /cache's text: '◷ 59:43 left · sub 4:59 · 1h ttl'. The app heads the
// entry with the mod's name, `cache`, so the text itself says neither cache nor where the TTL came from.
export function statusLine(now) {
  const s = snapshot(now)
  return ['◷ ' + s.cache, s.sub, s.ttl].filter(Boolean).join(' · ')
}

// The handoff prompt. The marker lets prompt.submit tell it from the user's own prompts.
const HANDOFF_MARKER = 'cache-clock handoff'

// One note per session, so parallel sessions in one folder never overwrite
// each other's. It goes to CACHE_CLOCK_HANDOFF_DIR, else the project root
// (not the shell's current folder, which a `cd` can move into a nested repo).
export function handoffPath(dir, sessionId) {
  return dir.replace(/[\\/]+$/, '') + '/HANDOFF-' + String(sessionId).slice(0, 8) + '.md'
}
function handoffText(file) {
  return '(' + HANDOFF_MARKER + ') The prompt cache goes cold soon and the user has not replied. While the cache is still warm, write a short handoff note to ' + file + ': the goal, what is done, what is next, open questions, and the key files. Keep it brief, and write it even if the session has been short. Do nothing else. A fresh session will start from it if the user does not come back.'
}

// A main-session request just read or wrote the cache: a full TTL again
function restartMain(now) {
  mainAt = now
  warned = false
  wentCold = false
}

// /recap and /btw send the whole conversation to the model as a side request.
// It reads the main cache, so it keeps it warm, but it is no turn, so no
// turn.step fires for it (#15). Only a warm cache counts: a cold one the side
// request may not write back at the main TTL, so the band stays honest. A bare
// /btw asks nothing and sends nothing.
/** A fork's answer, as the model.fork event resolves it: restart the main clock when it was served from a warm cache. True when it did. */
export function forkRestart(now, r) {
  const v = r && typeof r === 'object' && 'value' in r ? r.value : r
  const read = v && v.isAnswered ? Number(v.usage && v.usage.cache_read_input_tokens) || 0 : 0
  if (read > 0 && mainAt && mainAt + cfg.mainTtl > now) {
    restartMain(now)
    return true
  }
  return false
}

/** For tests: the main clock as a turn's request would set it. */
export function setMainAt(now) {
  restartMain(now)
}

async function sideRequest($, e, next) {
  const now = await $.clock.now()
  const asks = e.command !== 'btw' || String(e.args ?? '').trim() !== ''
  if (asks && mainAt && mainAt + cfg.mainTtl > now) restartMain(now)
  return next(e)
}

// Once a second: warn near expiry, note when it goes cold, redraw the status line
async function tick($) {
  const s = snapshot(await $.clock.now())
  if (mainAt && s.left > 0 && s.left <= cfg.warn && !warned) {
    warned = true
    // Idle and nothing done since the user's last message: act while the cache is warm
    if (cfg.onWarning !== 'off' && !working && !handedOff) {
      handedOff = true
      const file = handoffPath(cfg.handoffDir || (await $.session.root()), await $.session.id())
      $.ui.toast('Prompt cache goes cold in ' + clock(s.left) + '. No reply, so Claude is writing ' + file.split(/[\\/]/).pop() + ' while it is warm.', { timeoutMs: 10_000 })
      $.prompt.submit({ text: handoffText(file) }).catch(() => {}) // waits for idle; don't await in the tick
    } else {
      $.ui.toast('Prompt cache goes cold in ' + clock(s.left) + '. Send something to keep it warm.', { timeoutMs: 10_000 })
    }
    if (cfg.sound) $.audio.play({ asset: 'sounds/cooling.wav' }).catch(() => {})
  }
  if (mainAt && s.left <= 0 && !wentCold) {
    wentCold = true
    $.ui.toast('Prompt cache is cold. The next message re-sends the whole context at full price.')
  }
  await pin($)
}

// Pin the line on the status line. The tick does it once a second; the turn hooks do it
// too, since a pin from outside a turn (after a reload, say) can land before the app shows it.
async function pin($) {
  $.ui.status(statusLine(await $.clock.now()))
}

export function register(on, options) {
  on('session.start', async ($, e, next) => {
    // Headless (-p, SDK): no status line, and the timer would submit handoff turns
    // or compact with nobody at the prompt. Do nothing.
    headless = e.isInteractive === false
    if (headless) return next(e)
    await loadConfig($, options)
    // classic.SessionStart fires before this, so the transcript path is known: read the TTL here
    await readTtl($).catch(() => undefined)
    await $.command.register({ name: 'cache', description: 'Print the prompt cache countdown' })
    $.clock.every(1000, () => tick($))
    await pin($)
    return next(e)
  })

  // On a resume, the session tells us how long ago the last answer was,
  // so the clock picks up where it left off. This fires before session.start, so
  // it can't tell a headless session yet: session.start does the TTL read.
  on('classic.SessionStart', async ($, e, next) => {
    transcript = e.transcript_path ?? transcript
    if (e.seconds_since_last_response != null) mainAt = (await $.clock.now()) - e.seconds_since_last_response * 1000
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e))) // never block the session on our error

  // Track whether a turn is running, so the warning action never queues behind one
  on('turn.start', async ($, e, next) => { working = true; await pin($); return next(e) })
  on('turn.complete', async ($, e, next) => { working = false; await pin($); return next(e) })

  // A prompt from the user (not our own handoff) re-arms the warning action
  on('prompt.submit', async ($, e, next) => {
    if (!String(e.text ?? '').includes(HANDOFF_MARKER)) handedOff = false
    return next(e)
  })

  // Every request to the model refreshes its cache: restart the right clock
  on('turn.step', async function* ($, e, next) {
    const now = await $.clock.now()
    if (e.agentId) subAt = now
    else restartMain(now)
    await pin($)
    yield* next(e)
  })

  // /recap and /btw: a side request that keeps the main cache warm
  // (a hook that fails is skipped and the command still runs)
  on('command.run', { command: 'recap' }, sideRequest)
  on('command.run', { command: 'btw' }, sideRequest)

  // A fork over the transcript (cache-warmer's ping, or any mod's) reads the main
  // cache like a side request does, and no turn.step fires for it either. Restart
  // the clock once the answer shows it was served from cache; a miss on a cold
  // cache is left alone for the same reason a cold side request is.
  on('model.fork', async ($, e, next) => {
    const r = await next(e)
    forkRestart(await $.clock.now(), r)
    return r
  })

  // After each turn, check which TTL the API actually used
  on('classic.Stop', async ($, e, next) => {
    transcript = e.transcript_path ?? transcript
    if (!headless) await readTtl($)
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('command.run', { command: 'cache' }, async ($) => {
    await readTtl($)
    return { text: statusLine(await $.clock.now()) }
  })
}
