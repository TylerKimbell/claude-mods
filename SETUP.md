# Set up a machine

This puts Tyler's full mod setup on a machine: the six mods in this repo plus filetree from another author. It is written for Claude Code to follow. Open Claude Code in this folder and say:

> Follow SETUP.md to install all the mods on this machine.

Every step is safe to run again on a machine that already has some of this installed.

## What gets installed

| # | Plugin id | From | What it is |
| --- | --- | --- | --- |
| 1 | `filetree@claude-code-filetree` | data-goblin/claude-code-filetree | Live file tree pane |
| 2 | `agent-progress@claude-mods` | this repo | Subagent bar and Agents pane |
| 3 | `cache-clock@claude-mods` | this repo | Cache countdown and context in the band (our fork) |
| 4 | `cache-warmer@claude-mods` | this repo | Keeps big sessions' cache warm while idle |
| 5 | `launch-codes@claude-mods` | this repo | Code-and-LAUNCH guard on risky commands and .env edits |
| 6 | `usage-credits@claude-mods` | this repo | 5-hour and weekly use and credits left, on the status line |
| 7 | `usage-quota@claude-mods` | this repo | The context band: context use, Compact, Auto compact (our fork) |

Do **not** install these, on purpose:

- `cache-clock@claude-code-mods` (Ray Amjad's original). Ours in `mods/cache-clock` replaces it. Both together draw two countdowns.
- `usage-quota@claude-code-usage-quota-mod` (Anant Raghunath's original). Ours in `mods/usage-quota` replaces it. The original also draws the 5-hour and weekly meters, polls the usage endpoint every two minutes (which gets refused with 429s), and hides every band row installed after it.
- next-steps (spends tokens every turn) and secret-box (not needed).

## Install order

Mods load in install order, and the band above the prompt is drawn in that order: the first mod's row on top, each passing the rest down. Every mod here passes the draw down, so the order hides nothing; it only sets the layout. usage-quota goes last so the context band sits right above the prompt, with cache-clock's line at the top of the band. Step 7 checks it.

## Steps

### 1. Check what is needed

- Claude Code 2.1.287 or later. `claude --version`, or step 2's path, prints it.
- Signed in to Claude with a subscription. usage-credits reads the plan's usage and your credit balance; with an API key it shows nothing.
- Git, and read access to TylerKimbell/claude-mods (this folder is a clone, so that is already true).
- Mods do not load in WSL sessions of the desktop app. Use a native Windows, macOS or Linux session.

### 2. Find the `claude` CLI

Try `claude --version`. If it is not found, the machine probably has only the desktop app, which bundles the CLI without putting it on PATH. Find it and use its full path for every `claude` command below:

- Windows: `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe`. Pick the highest version: `ls -d "$APPDATA"/Claude/claude-code/*/*/claude.exe | sort -V | tail -1` in Git Bash.
- macOS or Linux: search the desktop app's support folder for a `claude-code/<version>/.../claude` executable, or install the CLI.

Below, `claude` means that command or path. In Git Bash, `CLAUDE="<path>"` and `"$CLAUDE"` works.

### 3. See what is already here

```bash
claude plugin list --json
claude plugin marketplace list --json
```

Then, before installing anything, remove the originals our forks replace, if they are installed:

```bash
claude plugin uninstall cache-clock@claude-code-mods
claude plugin uninstall usage-quota@claude-code-usage-quota-mod
```

### 4. Add the two marketplaces

Skip any that `marketplace list` already shows.

```bash
claude plugin marketplace add "<absolute path of this folder>"
claude plugin marketplace add data-goblin/claude-code-filetree
```

The first one adds this clone as a folder marketplace named `claude-mods`. Plugins from it are read straight from the folder, so a `git pull` here plus `/reload-plugins` in a session is all an update needs. If `claude-mods` is already added from GitHub (`TylerKimbell/claude-mods`) instead, that works too; updates then go through `claude plugin marketplace update claude-mods` and `claude plugin update <id>`.

### 5. Install the six, in this order

Skip any that step 3 showed as installed.

```bash
claude plugin install filetree@claude-code-filetree --scope user
claude plugin install agent-progress@claude-mods --scope user
claude plugin install cache-clock@claude-mods --scope user
claude plugin install cache-warmer@claude-mods --scope user
claude plugin install launch-codes@claude-mods --scope user
claude plugin install usage-credits@claude-mods --scope user
```

Messages about userConfig options not being set are expected: every mod's defaults are the setup. Nothing needs configuring.

### 6. Install usage-quota last

```bash
claude plugin install usage-quota@claude-mods --scope user
```

### 7. Check the load order

A headless run loads every plugin and logs the order, even without a login.

```bash
T="${TMPDIR:-$TEMP}"
claude -p --debug-file "$T/mods-order.log" "hi" < /dev/null > /dev/null 2>&1
grep -o "hooks module [a-z-]*@[a-z-]* loaded (worker, environment [0-9]*" "$T/mods-order.log"
rm "$T/mods-order.log"
```

`claude plugin list` sorts by name, so it cannot show the order; this can. Expect seven lines, usage-quota last:

```
hooks module filetree@claude-code-filetree loaded (worker, environment 1
hooks module agent-progress@claude-mods loaded (worker, environment 2
hooks module cache-clock@claude-mods loaded (worker, environment 3
hooks module cache-warmer@claude-mods loaded (worker, environment 4
hooks module launch-codes@claude-mods loaded (worker, environment 5
hooks module usage-credits@claude-mods loaded (worker, environment 6
hooks module usage-quota@claude-mods loaded (worker, environment 7
```

The middle five may be in any order. If a line is missing, install that mod. If usage-quota is not last, nothing is hidden, but the context band is not at the bottom of the band: `claude plugin uninstall usage-quota@claude-mods` then step 6 moves it there. Any line naming `claude-code-mods` or `claude-code-usage-quota-mod` is an original that step 3 should have removed.

### 8. Load them and check them

Restart the desktop app, or start a new session (in an open session, `/reload-plugins`). Then, in that session:

| Type | Expect |
| --- | --- |
| `/launch-codes test git push --force` | `Needs launch codes: git push --force rewrites remote history.` |
| `/credits` | `Plan: 5-hour …% (resets in …) · weekly …% (resets in …)`, then `Usage credits: $… left · …` |
| `/warmer` | `Cache warmer on · …` |
| `/cache-clock` | the countdown line as text |
| `/quota` | `Context band off.`, and again to turn it back on |
| `/agents` | the Agents pane opens |

And on screen, after sending any message:

- The band above the prompt has cache-clock's `◷ cache 59:… left · ctx …` line on top, then the context band: `Context …% used  …k free of 1M` with Auto compact, Compact and ▼ beside it, the context bar, and a `Messages · Tools · Other` row. agent-progress's subagent bar joins the band whenever Claude runs subagents.
- The status line under the prompt reads `usage-credits  5h …% · Weekly …% · Credits $… left`.
- A Files tab (filetree) sits beside the chat.

The first time a new mod loads, the desktop app may ask whether to allow it. Allow it.

## Later

- **Updating this repo's mods**: `git pull` in this folder, then `/reload-plugins` in open sessions.
- **Updating filetree**: `claude plugin marketplace update claude-code-filetree` then `claude plugin update filetree@claude-code-filetree`.
- **Adding another mod**: install it. To keep the context band at the bottom of the band, reinstall usage-quota afterwards (uninstall, then step 6) and check with step 7.
- **Removing everything**: `claude plugin uninstall <id>` for each id in the table.
