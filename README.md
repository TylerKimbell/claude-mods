# claude-mods

Claude Code mods we build and share. One repository, one marketplace, one folder per mod under `mods/`.

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
| [`launch-codes`](mods/launch-codes/README.md) | Risky Bash and PowerShell commands (rm -rf, force push, reset --hard, DROP TABLE, curl piped into sh, disk formats) and `.env` edits need a 4-character code typed by you, then a LAUNCH. `/launch-codes test <command>` checks a command. |
| `mod-template` | Starter folder to copy for a new mod. |

## Mods we install from elsewhere

Not in this repo, but part of the standard setup:

| Mod | Install |
| --- | --- |
| [filetree](https://github.com/data-goblin/claude-code-filetree): live file tree, files shimmer as Claude reads, writes and commits | `claude plugin install filetree --marketplace data-goblin/claude-code-filetree` |
| [cache-clock](https://github.com/ray-amjad/claude-code-mods): context fill and a countdown to prompt-cache expiry in the band | `claude plugin install cache-clock --marketplace ray-amjad/claude-code-mods`, then set its `onWarning` option to `off` |
| [usage-quota](https://github.com/anantraghunath/claude-code-usage-quota-mod): 5-hour and weekly plan usage with a forecast, polled every 2 minutes | `claude plugin install usage-quota --marketplace anantraghunath/claude-code-usage-quota-mod` |

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
