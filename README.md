# claude-mods

Claude Code mods we build and share. One repository, one marketplace, one folder per mod under `mods/`.

## Install the mods

Add them to your claude.ai account. They then show up in Claude Code on every machine you sign in on, with no install on each one:

1. On [claude.ai](https://claude.ai/customize/plugins), or in the Claude desktop app, open **Customize > Plugins**.
2. Choose **Add > Add marketplace** and enter `TylerKimbell/claude-mods`. If the repo is private, connect GitHub when the dialog asks and give the Claude GitHub App access to it.
3. Open each mod you want and select **Add**.

These are mods, so they only run in Claude Code. Chat on claude.ai and Cowork ignore them. Claude Code downloads them the next time you start a session signed in with that claude.ai account (Claude Code 2.1.273 or later). Run `/reload-plugins` in an open session to load them. They are listed as `<mod>@synced` in `/plugin` and `claude plugin list`. A session signed in with an API key or token does not get them.

- **Updates:** select **Check for updates** on the marketplace in **Customize > Plugins**, or turn on **Sync automatically**.
- **Turning off or removing:** to turn a mod off on one machine, run `claude plugin disable <mod>@synced`. To remove it everywhere, remove it on claude.ai.
- **Don't install it twice:** if a mod is also installed in Claude Code from a marketplace, that copy loads and the synced one doesn't. Pick one way to install each mod.
- **Status line order:** [SETUP.md](SETUP.md)'s install order applies to installs made in Claude Code. We haven't checked what order synced mods load in.
- **The originals our forks replace:** the same rule as in SETUP.md applies. Don't add Ray Amjad's cache-clock or Anant Raghunath's usage-quota on claude.ai alongside `cache` and `ctx-info`.

### From Claude Code instead

Installs made this way stay on that one machine and aren't added to your claude.ai account.

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

### Same setup on a new machine, from Claude Code

Clone this repo, open Claude Code in the folder, and say:

> Follow SETUP.md to install all the mods on this machine.

[SETUP.md](SETUP.md) installs every mod below plus filetree, in the order that lays the status line out, and checks the result.

## Mods

| Mod | What it does |
| --- | --- |
| [`agent-progress`](mods/agent-progress/README.md) | A progress bar above the prompt for Claude's own work and the subagents it starts, and an Agents pane with each one's model, step progress, context, estimated cost and time. `/subagents` toggles the pane. |
| [`cache`](mods/cache/README.md) | `cache ◷ 59:43 left · 1h ttl` in the status line under the prompt: a countdown until the prompt cache goes cold. A fork of Ray Amjad's cache-clock that also restarts the clock on cache-warmer's pings, with the handoff note off by default, moved out of the band and renamed to keep the entry short. `/cache` prints it. |
| [`cache-warmer`](mods/cache-warmer/README.md) | Keeps a big session's prompt cache warm while you are away: a cheap tool-less request over the cached transcript a few minutes before expiry, once per cache lifetime, capped at 4 idle hours and skipped under 100k tokens. `/warmer` shows pings, cost and what a cold return would have cost. |
| [`launch-codes`](mods/launch-codes/README.md) | Risky Bash and PowerShell commands (rm -rf, force push, reset --hard, DROP TABLE, curl piped into sh, disk formats) and `.env` edits need a 4-character code typed by you, then a LAUNCH. `/launch-codes test <command>` checks a command; `/launch-codes off` and `on`, typed by you, switch it off and on for the current session; the status line says which. |
| [`usage`](mods/usage/README.md) | `usage 5h 10% · Weekly 2% · $91.49 left` in the status line under the prompt: the plan's two windows from the session after every reply and your purchased credit balance from your account. `/credits` adds the reset times and this month's spend. |
| [`ctx-info`](mods/ctx-info/README.md) | The context band above the prompt: context use and its Messages, Tools and Other breakdown, one-click Compact and per-session Auto compact, in three rows. A fork of Anant Raghunath's usage-quota without the 5-hour and weekly meters or the polling, and one that passes the band on. `/ctx-info` toggles it. |
| `mod-template` | Starter folder to copy for a new mod. |

## Mods we install from elsewhere

Not in this repo, but part of the standard setup:

| Mod | Install |
| --- | --- |
| [filetree](https://github.com/data-goblin/claude-code-filetree): live file tree, files shimmer as Claude reads, writes and commits | `claude plugin install filetree --marketplace data-goblin/claude-code-filetree` |

Read a mod's source before installing it.

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
