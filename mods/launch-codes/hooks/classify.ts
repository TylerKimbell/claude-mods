/**
 * Which commands need launch codes. Pure: a command string in, a reason (or null) out.
 * The Bash classifier is adapted from OneWave AI's launch-codes (MIT); the PowerShell
 * classifier and the protected-file check are ours.
 */

export type Danger = { kind: string; reason: string }

type Token = { op: string } | { word: string }

/** Splits a shell line into words and operators, honoring quotes and backslashes. */
export const tokenize = (line: string): Token[] => {
  const out: Token[] = []
  let word = ''
  let hasWord = false
  const flush = () => {
    if (hasWord) out.push({ word })
    word = ''
    hasWord = false
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      word += line.slice(i + 1, end === -1 ? line.length : end)
      hasWord = true
      i = end === -1 ? line.length : end
    } else if (c === '"') {
      let j = i + 1
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) j++
        word += line[j]
        j++
      }
      hasWord = true
      i = j
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[i + 1]
      hasWord = true
      i++
    } else if (c === ' ' || c === '\t') {
      flush()
    } else if (c === '\n' || c === ';') {
      flush()
      out.push({ op: ';' })
    } else if (c === '&' || c === '|') {
      flush()
      const pair = line[i + 1] === c
      out.push({ op: pair ? c + c : c })
      if (pair) i++
    } else if (c === '(' || c === ')') {
      flush()
      out.push({ op: c })
    } else {
      word += c
      hasWord = true
    }
  }
  flush()
  return out
}

type Simple = { words: string[]; pipedFrom: string | null }

const WRAPPERS = new Set(['sudo', 'time', 'command', 'exec', 'nohup', 'env', 'npx', 'bunx', 'xargs', 'doas'])

/** The program a command really runs, past sudo, env assignments and npx. */
const program = (words: string[]) => {
  let i = 0
  while (i < words.length) {
    const w = words[i]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w) || (w.startsWith('-') && i > 0)) {
      i++
      continue
    }
    if ((w === 'pnpm' || w === 'yarn' || w === 'bun') && words[i + 1] === 'dlx') {
      i += 2
      continue
    }
    break
  }
  return { name: (words[i] ?? '').split('/').pop() ?? '', args: words.slice(i + 1) }
}

const simples = (tokens: Token[]): Simple[] => {
  const out: Simple[] = []
  let words: string[] = []
  let pipedFrom: string | null = null
  const end = (op: string) => {
    if (words.length) {
      const name = program(words).name
      out.push({ words, pipedFrom })
      pipedFrom = op === '|' ? name : null
    } else if (op !== '|') {
      pipedFrom = null
    }
    words = []
  }
  for (const t of tokens) {
    if ('op' in t) end(t.op)
    else words.push(t.word)
  }
  end(';')
  return out
}

// Build output and caches: deleting these is routine.
const SAFE_RM = /(^|[\\/])(node_modules|\.next|dist|build|out|tmp|\.turbo|\.cache|coverage|__pycache__|\.venv|target)([\\/]|$)/i
const SAFE_RM_ROOT = /^(\/tmp\/|\/private\/tmp\/|\$TMPDIR|\$env:TE?MP|%TE?MP%|\/var\/folders\/|[A-Za-z]:[\\/]Users[\\/][^\\/]+[\\/]AppData[\\/]Local[\\/]Temp[\\/])/i

export const isSafeRmTarget = (path: string) => SAFE_RM.test(path) || SAFE_RM_ROOT.test(path)

const rmDanger = (args: string[]): Danger | null => {
  let recursive = false
  let force = false
  const targets: string[] = []
  let isEndOfFlags = false
  for (const a of args) {
    if (!isEndOfFlags && a === '--') {
      isEndOfFlags = true
    } else if (!isEndOfFlags && a.startsWith('--')) {
      if (a === '--recursive') recursive = true
      if (a === '--force') force = true
    } else if (!isEndOfFlags && a.startsWith('-') && a.length > 1) {
      if (/[rR]/.test(a)) recursive = true
      if (/f/.test(a)) force = true
    } else {
      targets.push(a)
    }
  }
  if (!recursive || !force || targets.length === 0) return null
  const risky = targets.filter(t => !isSafeRmTarget(t))
  if (risky.length === 0) return null
  return { kind: 'rm', reason: `rm -rf on ${risky.slice(0, 3).join(' ')}` }
}

const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'duckdb', 'clickhouse-client', 'pgcli', 'mycli', 'mysqlsh'])
const SQL_DROP = /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?["`\w])/i
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish'])
const FETCHERS = new Set(['curl', 'wget'])

const gitDanger = (args: string[]): Danger | null => {
  // git's own options come before the subcommand; -C and -c take a value.
  let at = 0
  while (at < args.length && args[at]!.startsWith('-')) at += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[at]!) ? 2 : 1
  const sub = args[at]
  if (sub === 'push') {
    const rest = args.slice(at + 1)
    const isForce = rest.some(a => a === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || /^\+\S/.test(a))
    if (isForce) return { kind: 'git-push-force', reason: 'git push --force rewrites remote history' }
  }
  if (sub === 'reset' && args.includes('--hard')) {
    return { kind: 'git-reset-hard', reason: 'git reset --hard throws away uncommitted work' }
  }
  if (sub === 'clean' && args.some(a => /^-[a-zA-Z]*f/.test(a)) && args.some(a => /^-[a-zA-Z]*[dx]/.test(a))) {
    return { kind: 'git-clean', reason: 'git clean -fd deletes untracked files' }
  }
  if (sub === 'branch' && args.includes('-D')) {
    return { kind: 'git-branch-delete', reason: 'git branch -D discards a branch without merging' }
  }
  return null
}

/** The first dangerous thing a Bash `command` does, or null when it is safe to run unasked. */
export const classify = (command: string): Danger | null => {
  const tokens = tokenize(command)
  const list = simples(tokens)
  for (const s of list) {
    const { name, args } = program(s.words)
    const joined = args.join(' ')

    if (name === 'rm') {
      const d = rmDanger(args)
      if (d) return d
    }

    if (name === 'git') {
      const d = gitDanger(args)
      if (d) return d
    }

    // A heredoc's body lands in commands of its own, so then the whole line counts.
    const sql = args.some(a => a.startsWith('<<')) ? command : joined
    if (SQL_CLIENTS.has(name) && SQL_DROP.test(sql)) {
      return { kind: 'sql-drop', reason: 'DROP / TRUNCATE through a live SQL client' }
    }

    if (name === 'supabase') {
      if (args[0] === 'db' && args[1] === 'reset') {
        return { kind: 'supabase-reset', reason: 'supabase db reset wipes the database' }
      }
      if (SQL_DROP.test(joined)) return { kind: 'sql-drop', reason: 'DROP / TRUNCATE through supabase' }
    }

    if (name === 'vercel' && args.some(a => a === '--prod' || a === '--production')) {
      return { kind: 'vercel-prod', reason: 'vercel --prod ships to production' }
    }

    if (name === 'chmod' && args.some(a => /^-[a-zA-Z]*R/.test(a) || a === '--recursive') && args.some(a => /^0?777$/.test(a) || a === 'a+rwx')) {
      return { kind: 'chmod-777', reason: 'chmod -R 777 opens every file to everyone' }
    }

    if (SHELLS.has(name) && s.pipedFrom && FETCHERS.has(s.pipedFrom)) {
      return { kind: 'curl-sh', reason: `${s.pipedFrom} piped straight into ${name}` }
    }
    if (SHELLS.has(name) && args.some(a => /\$\(\s*(curl|wget)\b/.test(a))) {
      return { kind: 'curl-sh', reason: `${name} running a downloaded script` }
    }
  }
  // bash <(curl ...): the tokenizer splits the parens off, so look at the raw line.
  if (/\b(sh|bash|zsh)\s+<\(\s*(curl|wget)\b/.test(command)) {
    return { kind: 'curl-sh', reason: 'shell running a downloaded script' }
  }
  return null
}

// ---------------------------------------------------------------------------
// PowerShell. Statements split on ; | newline; each is read on its own.

const PS_RM = /^(?:Remove-Item|rm|ri|del|erase|rd|rmdir)\b(.*)$/i
const PS_REMOTE_EXEC = /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:iex|Invoke-Expression)\b|\b(?:iex|Invoke-Expression)\s*\(?\s*(?:\(?\s*(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|New-Object\s+Net\.WebClient))/i
const PS_DISK = /\b(?:Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition|diskpart)\b|\bformat\s+[A-Za-z]:/i
const PS_POWER = /\b(?:Stop-Computer|Restart-Computer|shutdown(?:\.exe)?\s+(?:\/[rsp]|-[rsp])\b)/i
const PS_REGISTRY_RM = /\b(?:Remove-Item|Remove-ItemProperty|rm|ri|del)\b[^;|]*\b(?:HKLM|HKCU|HKCR|HKU|HKCC):/i

const psStatements = (command: string): string[] =>
  command
    .split(/[\n;|]|&&|\|\|/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^(?:&\s*|\.\s*)/, ''))

const psRmDanger = (rest: string): Danger | null => {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  let recurse = false
  let force = false
  const targets: string[] = []
  for (const p of parts) {
    const flag = p.toLowerCase()
    if (flag.startsWith('-')) {
      if (/^-r(ecurse)?$/.test(flag) || /^-rec/.test(flag)) recurse = true
      if (/^-fo(rce)?$/.test(flag)) force = true
      if (/^-(path|literalpath)$/.test(flag)) continue
    } else if (/^\/[sq]$/i.test(p)) {
      if (flag === '/s') recurse = true
      if (flag === '/q') force = true
    } else {
      // PowerShell takes several paths separated by commas.
      for (const t of p.split(',')) {
        const clean = t.replace(/^["']|["']$/g, '').trim()
        if (clean) targets.push(clean)
      }
    }
  }
  if (!recurse || !force || targets.length === 0) return null
  const risky = targets.filter(t => !isSafeRmTarget(t))
  if (risky.length === 0) return null
  return { kind: 'rm', reason: `recursive forced delete of ${risky.slice(0, 3).join(' ')}` }
}

// `Get-ChildItem | Remove-Item -Recurse -Force`: the targets come down the pipe.
const PS_PIPED_RM = /\|\s*(?:Remove-Item|rm|ri|del|erase|rd|rmdir)\b([^;|\n]*)/gi

const pipedRmDanger = (command: string): Danger | null => {
  for (const m of command.matchAll(PS_PIPED_RM)) {
    const flags = (m[1] ?? '').toLowerCase()
    const recurse = /(^|\s)-r(ecurse)?\b|(^|\s)-rec\w*|(^|\s)\/s\b/.test(flags)
    const force = /(^|\s)-fo(rce)?\b|(^|\s)\/q\b/.test(flags)
    if (recurse && force) return { kind: 'rm', reason: 'recursive forced delete of piped items' }
  }
  return null
}

/** The first dangerous thing a PowerShell `command` does, or null. */
export const classifyPowerShell = (command: string): Danger | null => {
  if (PS_REMOTE_EXEC.test(command)) return { kind: 'curl-sh', reason: 'downloaded script piped into Invoke-Expression' }
  const piped = pipedRmDanger(command)
  if (piped) return piped
  if (PS_DISK.test(command)) return { kind: 'disk', reason: 'formats or clears a disk or partition' }
  if (PS_POWER.test(command)) return { kind: 'power', reason: 'shuts down or restarts the computer' }
  if (PS_REGISTRY_RM.test(command)) return { kind: 'registry', reason: 'deletes registry keys' }
  for (const s of psStatements(command)) {
    const rm = PS_RM.exec(s)
    if (rm) {
      const d = psRmDanger(rm[1] ?? '')
      if (d) return d
    }
    const git = /^git\s+(.*)$/i.exec(s)
    if (git) {
      const d = gitDanger((git[1] ?? '').split(/\s+/).filter(Boolean))
      if (d) return d
    }
    if (/^(?:npx\s+)?supabase\s+db\s+reset\b/i.test(s)) return { kind: 'supabase-reset', reason: 'supabase db reset wipes the database' }
    if (/^(?:npx\s+)?vercel\b.*\s--(?:prod|production)\b/i.test(s)) return { kind: 'vercel-prod', reason: 'vercel --prod ships to production' }
    const sqlClient = /^(psql|mysql|mysqlsh|sqlcmd|sqlite3|duckdb)\b/i.exec(s)
    if (sqlClient && SQL_DROP.test(s)) return { kind: 'sql-drop', reason: 'DROP / TRUNCATE through a live SQL client' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Files whose edits need codes.

/** `.env`, `.env.local`, `.env.production`; never `.env.example` or `.env.sample`. */
export const isProtectedFile = (path: string): boolean => {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  if (!/^\.env(\..+)?$/.test(name)) return false
  return !/\.(example|sample|template|dist)$/i.test(name)
}

const CODE_ALPHABET = 'ACDEFHJKMNPRTVWXY3479'

/** A 4-character launch code from unambiguous letters and digits. */
export const makeCode = (random: (n: number) => number) =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[random(CODE_ALPHABET.length)]!).join('')

/** Whether what the person typed matches the code: case and spaces don't matter. */
export const isCode = (typed: string, code: string) => typed.replace(/[\s-]/g, '').toUpperCase() === code
