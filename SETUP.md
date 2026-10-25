# Set up a machine

This puts Tyler's full mod setup on a machine: the five mods in this repo plus two from other authors, in the order the band above the prompt needs. It is written for Claude Code to follow. Open Claude Code in this folder and say:

> Follow SETUP.md to install all the mods on this machine.

Every step is safe to run again on a machine that already has some of this installed.

## What gets installed

| # | Plugin id | From | What it is |
| --- | --- | --- | --- |
| 1 | `filetree@claude-code-filetree` | data-goblin/claude-code-filetree | Live file tree pane |
| 2 | `agent-progress@claude-mods` | this repo | Working row, subagent bar, Agents pane |
| 3 | `cache-clock@claude-mods` | this repo | Cache countdown and context in the band (our fork) |
| 4 | `cache-warmer@claude-mods` | this repo | Keeps big sessions' cache warm while idle |
| 5 | `launch-codes@claude-mods` | this repo | Code-and-LAUNCH guard on risky commands and .env edits |
| 6 | `usage-credits@claude-mods` | this repo | Credits left, on the status line |
| 7 | `usage-quota@claude-code-usage-quota-mod` | anantraghunath/claude-code-usage-quota-mod | 5-hour and weekly meters, context, Compact |

Do **not** install these, on purpose:

- `cache-clock@claude-code-mods` (Ray Amjad's original). Ours in `mods/cache-clock` replaces it. Having both draws two countdowns.
- next-steps (spends tokens every turn) and secret-box (not needed).

## The one rule that matters: usage-quota goes last

Mods load in install order, and the band above the prompt is drawn in that order: each mod draws its row and passes the rest down. usage-quota draws its block and does not pass the draw down, so any mod installed after it loses its band row (cache-clock's countdown, agent-progress's bars). So usage-quota is installed last, and if anything is installed after it later, usage-quota is uninstalled with `--keep-data` and reinstalled to move it back to the end. Step 7 checks this.

## Steps

### 1. Check what is needed

- Claude Code 2.1.287 or later. `claude --version`, or step 2's path, prints it.
- Signed in to Claude with a subscription. usage-quota and usage-credits read the plan's usage; with an API key they show nothing.
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

Then, before installing anything:

- If `cache-clock@claude-code-mods` is installed, remove it: `claude plugin uninstall cache-clock@claude-code-mods`.
- If `usage-quota@claude-code-usage-quota-mod` is installed, remove it for now, keeping its saved settings: `claude plugin uninstall usage-quota@claude-code-usage-quota-mod --keep-data`. Step 6 puts it back last.

### 4. Add the three marketplaces

Skip any that `marketplace list` already shows.

```bash
claude plugin marketplace add "<absolute path of this folder>"
claude plugin marketplace add data-goblin/claude-code-filetree
claude plugin marketplace add anantraghunath/claude-code-usage-quota-mod
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
claude plugin install usage-quota@claude-code-usage-quota-mod --scope user
```

### 7. Check the load order

A headless run loads every plugin and logs the order, even without a login. usage-quota must have the highest environment number.

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
hooks module usage-quota@claude-code-usage-quota-mod loaded (worker, environment 7
```

The middle five may be in any order. If usage-quota is not last, or a line is missing, repeat step 6 after `claude plugin uninstall usage-quota@claude-code-usage-quota-mod --keep-data`, and install whatever is missing before it.

### 8. Load them and check them

Restart the desktop app, or start a new session (in an open session, `/reload-plugins`). Then, in that session:

| Type | Expect |
| --- | --- |
| `/launch-codes test git push --force` | `Needs launch codes: git push --force rewrites remote history.` |
| `/credits` | `Usage credits: $… left of $… · …% used` |
| `/warmer` | `Cache warmer on · …` |
| `/cache-clock` | the countdown line as text |
| `/agents` | the Agents pane opens |

And on screen, after sending any message:

- The band above the prompt starts with cache-clock's `◷ cache 59:… left · ctx …` line, then usage-quota's block, then agent-progress's `Last turn · …` row.
- The status line under the prompt reads `usage-credits  Credits $… left of $… · …%`.
- The spinner line while Claude works ends with `· N tool calls · <last tool>`.
- A Files tab (filetree) sits beside the chat.

The first time a new mod loads, the desktop app may ask whether to allow it. Allow it.

## Later

- **Updating this repo's mods**: `git pull` in this folder, then `/reload-plugins` in open sessions.
- **Updating the other two**: `claude plugin marketplace update <marketplace>` then `claude plugin update <id>`, then re-run step 7.
- **Adding another mod**: install it, then move usage-quota back to last (step 3's uninstall with `--keep-data`, then step 6), then step 7.
- **Removing everything**: `claude plugin uninstall <id>` for each id in the table.
