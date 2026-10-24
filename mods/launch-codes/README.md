# launch-codes

Risky commands need launch codes. When Claude is about to run something destructive, a RED ALERT pane opens with a 4-character code, and a dialog asks you to type it. Then one more confirmation: LAUNCH or ABORT. ABORT, a wrong code, an expired code, or a closed dialog all block the command, and the model is told not to retry or work around it.

Adapted from [OneWave AI's launch-codes](https://github.com/OneWave-AI/claude-code-mods/tree/main/launch-codes) (MIT): the siren and hazard animation are gone, PowerShell and `.env` guards are added.

## What needs codes

Bash:
- `rm -rf` outside build folders and temp (node_modules, dist, .next, coverage, /tmp and friends run freely)
- `git push --force` (and `+branch`), `git reset --hard`, `git clean -fd`, `git branch -D`
- `DROP` / `TRUNCATE` through psql, mysql, sqlite3 and other live SQL clients; `supabase db reset`
- `vercel --prod`
- `chmod -R 777`
- `curl ... | sh` and other downloaded scripts piped into a shell

PowerShell:
- `Remove-Item -Recurse -Force` (and `rm`, `rd /s /q`, `del /s /q`) outside build folders and temp
- the same git, SQL, supabase and vercel rules
- `Format-Volume`, `Clear-Disk`, `diskpart`, `format X:`
- `Restart-Computer`, `Stop-Computer`, `shutdown /r`
- `irm ... | iex` and other downloaded scripts piped into `Invoke-Expression`
- deleting registry keys

Files (option `protectEnv`, on by default):
- `Edit` or `Write` to `.env`, `.env.local`, `.env.production` and so on. `.env.example` and `.env.sample` are free.

## Commands

- `/launch-codes test <command>` says whether a command would need codes.
- `/launch-codes demo` runs the ceremony on a placeholder command. Nothing runs.

## Options

- `protectEnv` (default true): guard `.env` files.
- `codeSeconds` (default 45): how long a code stays valid.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install launch-codes --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**.
