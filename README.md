# claude-mods

Claude Code mods we build and share. One repository, one marketplace, one folder per mod under `mods/`.

## Same setup on a new machine

Clone this repo, open Claude Code in the folder, and say:

> Follow SETUP.md to install all the mods on this machine.

[SETUP.md](SETUP.md) installs every mod below plus filetree and usage-quota, in the order the band needs, and checks the result.

## Install a mod

At the prompt of a terminal `claude` session:

```
/plugin install <mod> --marketplace TylerKimbell/claude-mods
```

From a shell:

```
claude plugin install <mod> --marketplace TylerKimbell/claude-mods
```

In the Claude desktop app (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**. New sessions load it; in an open session run `/reload-plugins`.

Requires Claude Code 2.1.287 or later. A private repo installs only for people who can read it on GitHub and have a git credential for github.com on their machine.

## Mods

| Mod | What it does |
| --- | --- |
| [`agent-progress`](mods/agent-progress/README.md) | A progress bar above the prompt for the subagents Claude starts, and an Agents pane with each one's model, step progress, context, estimated cost and time. `/agents` toggles the pane. |
| [`cache-clock`](mods/cache-clock/README.md) | One line above the prompt: context used and a countdown until the prompt cache goes cold. A fork of Ray Amjad's cache-clock that also restarts the clock on cache-warmer's pings, with the handoff note off by default. |
| [`cache-warmer`](mods/cache-warmer/README.md) | Keeps a big session's prompt cache warm while you are away: a cheap tool-less request over the cached transcript a few minutes before expiry, once per cache lifetime, capped at 4 idle hours and skipped under 100k tokens. `/warmer` shows pings, cost and what a cold return would have cost. |
| [`launch-codes`](mods/launch-codes/README.md) | Risky Bash and PowerShell commands (rm -rf, force push, reset --hard, DROP TABLE, curl piped into sh, disk formats) and `.env` edits need a 4-character code typed by you, then a LAUNCH. `/launch-codes test <command>` checks a command. |
| [`usage-credits`](mods/usage-credits/README.md) | Usage credits, the pool Fable draws on, in the status line under the prompt: `Credits $57.51 left of $100 · 42%`, refreshed from your account every few minutes, with a toast as it runs low. `/credits` prints it; an option adds a band row too. |
| `mod-template` | Starter folder to copy for a new mod. |

## Mods we install from elsewhere

Not in this repo, but part of the standard setup:

| Mod | Install |
| --- | --- |
| [filetree](https://github.com/data-goblin/claude-code-filetree): live file tree, files shimmer as Claude reads, writes and commits | `claude plugin install filetree --marketplace data-goblin/claude-code-filetree` |
| [usage-quota](https://github.com/anantraghunath/claude-code-usage-quota-mod): 5-hour and weekly plan usage with a forecast, polled every 2 minutes | `claude plugin install usage-quota --marketplace anantraghunath/claude-code-usage-quota-mod` |

Read a mod's source before installing it.

### Install usage-quota last

Mods load in the order they were installed, and the band above the prompt is drawn in that order: each mod draws its row and passes the rest down. usage-quota draws its block without passing the draw down, so every mod installed after it loses its band row (cache-clock's countdown, agent-progress's bars). Install usage-quota after everything else. If it is already installed, uninstall and reinstall it to move it to the end.

## Develop a mod

Each mod folder holds three files:

```
mods/<name>/
  .claude-plugin/plugin.json   name, version, description
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           export const register: Register = (on) => { ... }
  types/index.d.ts             (optional) $.state contract
  *.test.ts                    (optional) run by `claude plugin test`
```

Load a mod in every local session while developing by adding its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (paths separated by `;` on Windows). Or add this checkout as a folder marketplace, which is read live:

```
claude plugin marketplace add <path to this checkout>
claude plugin install <mod>@claude-mods
```

Check a mod before committing:

```
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

## Add a mod to the marketplace

1. Copy `mods/_template` to `mods/<name>` and set `name` in `plugin.json`.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<name>"`.
3. Add a row to the table above.
