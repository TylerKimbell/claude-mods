# claude-mods

Mods for Claude Code: a context band above the prompt, cache and usage readings in the status line under it, an Agents pane, and a guard on risky commands. Claude Code calls mods plugins, so the menus and commands below say "plugin".

## Mods

In install order, the order [SETUP.md](SETUP.md) uses:

| Mod | What it does |
| --- | --- |
| [`agent-progress`](mods/agent-progress/README.md) | A progress bar above the prompt for Claude's work and the subagents it starts. An Agents pane shows each one's model, step progress, context, estimated cost, and time. `/subagents` opens and closes the pane. |
| [`cache-warmer`](mods/cache-warmer/README.md) | Keeps a big session's prompt cache warm while you are away. A few minutes before the cache expires, it sends one cheap request over the cached transcript. It stops after 4 idle hours and skips sessions under 100k tokens. `/warmer` shows the pings, their cost, and what a cold return would have cost. |
| [`cache`](mods/cache/README.md) | `cache ◷ 59:43 left · 1h ttl` in the status line: a countdown until the prompt cache goes cold. `/cache` prints it. |
| [`launch-codes`](mods/launch-codes/README.md) | Risky Bash and PowerShell commands and `.env` edits need a 4-character code that you type, then a LAUNCH. Risky commands include `rm -rf`, force pushes, `reset --hard`, `DROP TABLE`, and `curl` piped into `sh`. The status line shows whether it is on. `/launch-codes test <command>` checks a command. |
| [`usage`](mods/usage/README.md) | `usage 5h 10% 3:40pm · Weekly 2% · $91.49 left` in the status line: the plan's 5-hour window with its reset time, the weekly window, and your purchased credit balance. `/credits` adds both reset countdowns and this month's spend. |
| [`ctx-info`](mods/ctx-info/README.md) | The context band above the prompt: context use split into Messages, Tools, and Other, a Compact button, and an Auto compact switch for the session. `/ctx-info` turns the band off and on. |

`cache` and `ctx-info` are forks of other authors' mods. Each mod's README lists what changed, and [NOTICE](NOTICE) credits the originals.

### Mods we install from elsewhere

[filetree](https://github.com/data-goblin/claude-code-filetree) is not in this repo, but SETUP.md installs it with the rest. It adds a live file tree beside the chat, where files shimmer as Claude reads, writes, and commits them. Read its source before you install it.

```bash
claude plugin install filetree --marketplace data-goblin/claude-code-filetree
```

## Install the mods

All three ways need Claude Code 2.1.287 or later.

### From claude.ai, for every machine

Mods you add to your claude.ai account load in Claude Code on every machine where you sign in with that account.

1. On [claude.ai](https://claude.ai/customize/plugins), or in the Claude desktop app, open **Customize > Plugins**.
2. Choose **Add > Add marketplace** and enter `TylerKimbell/claude-mods`.
3. Open each mod you want and select **Add**.
4. Start a new Claude Code session, or run `/reload-plugins` in an open one.

Know these limits:

- Mods run only in Claude Code. Chat on claude.ai and Cowork ignore them.
- A session signed in with an API key or a token does not get synced mods.
- `/plugin` and `claude plugin list` show synced mods as `<mod>@synced`.

To manage synced mods:

- **Update them:** select **Check for updates** on the marketplace in **Customize > Plugins**, or turn on **Sync automatically**.
- **Turn one off on one machine:** run `claude plugin disable <mod>@synced`.
- **Remove one everywhere:** remove it on claude.ai.
- **Install each mod one way only:** if Claude Code also has a mod from a marketplace, that copy loads and the synced copy does not.
- **Leave out the originals:** don't add Ray Amjad's cache-clock or Anant Raghunath's usage-quota alongside `cache` and `ctx-info`. Each pair draws its reading twice.

SETUP.md's install order covers installs made in Claude Code. The load order of synced mods is untested, so their status line entries can sit in a different order.

### From Claude Code, for one machine

Mods installed this way stay on this machine and are not added to your claude.ai account.

At the prompt of a terminal `claude` session:

```
/plugin install <mod> --marketplace TylerKimbell/claude-mods
```

From a shell:

```bash
claude plugin install <mod> --marketplace TylerKimbell/claude-mods
```

### From the Claude desktop app, for one machine

`/plugin` does not run in the desktop app. Use the menu instead:

1. Click **+** next to the prompt box, then **Plugins**.
2. Choose **Add marketplace** and enter `TylerKimbell/claude-mods`.
3. Choose **Add plugin** for each mod you want.
4. Start a new session, or run `/reload-plugins` in an open one.

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

## Add a mod to the marketplace

1. Copy `mods/_template` to `mods/<name>`. Set `name` and `description` in `.claude-plugin/plugin.json`.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<name>"`.
3. Add a row to the Mods table in this README.
4. If the mod adapts someone else's code, credit it in [NOTICE](NOTICE).
5. Run `claude plugin validate` and `claude plugin test` on the mod.
