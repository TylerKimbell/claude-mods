# claude-mods

Mods for Claude Code: a context band above the prompt, cache and usage readings in the status line under it, and an Agents pane. Claude Code calls mods plugins, so the menus and commands below say "plugin".

## Mods

In install order, the order [SETUP.md](SETUP.md) uses:

| Mod | What it does |
| --- | --- |
| [`agent-progress`](mods/agent-progress/README.md) | A progress bar above the prompt for Claude's work and the subagents it starts. An Agents pane shows each one's model, step progress, context, estimated cost, and time. `/subagents` opens and closes the pane. |
| [`cache-warmer`](mods/cache-warmer/README.md) | Keeps a big session's prompt cache warm while you are away. A few minutes before the cache expires, it sends one cheap request over the cached transcript. It stops after 4 idle hours and skips sessions under 100k tokens. `/warmer` shows the pings, their cost, and what a cold return would have cost. |
| [`cache`](mods/cache/README.md) | `cache ◷ 59:43 left · 1h ttl` in the status line: a countdown until the prompt cache goes cold. `/cache` prints it. |
| [`usage`](mods/usage/README.md) | `usage 5h 10% 3:40pm · Weekly 2% · $91.49 left` in the status line: the plan's 5-hour window with its reset time, the weekly window, and your purchased credit balance. `/credits` adds both reset countdowns and this month's spend. |
| [`ctx-info`](mods/ctx-info/README.md) | The context band above the prompt: context use split into Messages, Tools, and Other, a Compact button, and an Auto compact switch for the session. `/ctx-info` turns the band off and on. |

`cache` and `ctx-info` are forks of other authors' mods. Each mod's README lists what changed, and [NOTICE](NOTICE) credits the originals.

### Mods we install from elsewhere

[filetree](https://github.com/data-goblin/claude-code-filetree) is not in this repo, but SETUP.md installs it with the rest. It adds a live file tree beside the chat, where files shimmer as Claude reads, writes, and commits them. Read its source before you install it.

```bash
claude plugin install filetree --marketplace data-goblin/claude-code-filetree
```

## Install the mods

Both ways need Claude Code 2.1.287 or later. Mods run only in Claude Code, and each install is for one machine: repeat it on every machine where you want the mods.

### From the Claude desktop app

1. Switch to **Code** in the desktop app.
2. Open **Plugins**.
3. Scroll to the bottom, to the **On your computer** section, and add the marketplace `TylerKimbell/claude-mods` there.
4. Choose the mods you want from that marketplace.
5. Start a new session, or run `/reload-plugins` in an open one.

Don't add the marketplace under **Customize > Plugins**, on claude.ai or in the desktop app's chat. The marketplace syncs there, but none of its mods are offered to add.

### From the Claude Code command line

At the prompt of a terminal `claude` session:

```
/plugin install <mod> --marketplace TylerKimbell/claude-mods
```

From a shell:

```bash
claude plugin install <mod> --marketplace TylerKimbell/claude-mods
```

`/plugin` does not run in the desktop app. Use the steps above there.

### After installing

- **Install each mod one way only.** A mod added twice, from two marketplaces or two routes, can draw its reading twice.
- **Leave out the originals.** Don't add Ray Amjad's cache-clock or Anant Raghunath's usage-quota alongside `cache` and `ctx-info`. Each pair draws its reading twice.
- **Updates** come from this repo's default branch. Update the marketplace where you added it, then run `/reload-plugins`.

### Same setup on a new machine

SETUP.md installs every mod in this repo and filetree, in the order that lays out the status line, and then checks the result. Clone this repo, open Claude Code in the folder, and say:

> Follow SETUP.md to install all the mods on this machine.

## Develop a mod

A mod folder holds these files:

```
mods/<name>/
  .claude-plugin/plugin.json   name, version, description
  hooks/hooks.json             { "modules": ["./register.ts"] }
  hooks/register.ts            export const register: Register = (on) => { ... }
  types/index.d.ts             (optional) $.state contract
  tests/*.test.ts              (optional) run by `claude plugin test`
```

Use `register.tsx` instead of `register.ts` if the mod draws with JSX.

To load a mod in every local session while you work on it, add its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Separate the paths with `;` on Windows. You can also add this checkout as a folder marketplace, which Claude Code reads live:

```bash
claude plugin marketplace add <path to this checkout>
claude plugin install <mod>@claude-mods
```

Before you commit, check the mod:

```bash
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

On each push and pull request, CI validates every mod and the marketplace manifest (`claude plugin validate .`), and runs the tests of every mod that has a test file.

## Add a mod to the marketplace

1. Copy `mods/_template` to `mods/<name>`. Set `name` and `description` in `.claude-plugin/plugin.json`.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<name>"`.
3. Add a row to the Mods table in this README.
4. If the mod adapts someone else's code, credit it in [NOTICE](NOTICE).
5. Run `claude plugin validate` and `claude plugin test` on the mod.
