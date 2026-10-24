# Claude Code mods: research and shortlist

Date: 2026-10-24

A mod is a Claude Code plugin with a hooks module (`hooks/register.tsx`) that can draw panes, bands above the prompt, status lines and toasts, and hook tool calls, prompts and subagent events. Mods run in the terminal and in the desktop app's Code tab (desktop from 2.1.286). They cannot import npm packages. The desktop app does not load mods in WSL sessions.

## 1. The two you remembered

### Progress bar for subagents: savvy-progress and its forks

| Mod | Repo | What it does | License |
| --- | --- | --- | --- |
| savvy-progress | [JohnnyVizz/claude-kit](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress) | Bar above the prompt (flow title, phase, tasks done/planned) plus an agents panel (`/agents-info`) listing running, finished and planned subagents with model, effort, progress, context, estimated cost, elapsed time. The bar depends on the author's savvy-flow skill reporting through two MCP tools (`progress` and `step`); the panel works with any subagent. | MIT |
| agent-watch | [Barncore/agent-watch](https://github.com/Barncore/agent-watch) | Fork of savvy-progress that shows the bar for any subagent (finished / started, percent, button to the panel). Shares the band with other mods. Hooks: session start, agent spawn, Agent tool call, turn steps and completion, prompt submit. Keeps data in session state only, no files or network. | MIT |
| savvy-progress (fork) | [Solutionmax/savvy-progress](https://github.com/Solutionmax/savvy-progress) | Same idea plus turn and session cost in the bar. | not checked |
| swarm | [OneWave-AI/claude-code-mods](https://github.com/OneWave-AI/claude-code-mods) | Live map of subagents and agent teams: who spawned whom, what each is doing (`/swarm`). | MIT |
| flightdeck | [scasella/claude-flightdeck](https://github.com/scasella/claude-flightdeck) | Dashboard: context, cost, every permission check as a colored cell, subagents as cards or swimlanes. Observe only. | not checked |

Install agent-watch (terminal):

```
claude plugin marketplace add Barncore/agent-watch
claude plugin install agent-watch@agent-watch --scope user
```

Build note: agent-watch is the right base for our own version. It drops the savvy-flow dependency, so progress comes from engine events (agent spawn, turn steps, Agent tool results) rather than a skill that has to call a reporting tool. Both are MIT, so copying and editing is fine as long as the copyright notice stays.

### Live file tree

| Mod | Repo | What it does | Notes |
| --- | --- | --- | --- |
| filetree | [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) | IDE-style tree. Files Claude reads shimmer purple, writes orange, commits green. Git status colors, branch and ahead/behind in the header, diff view, "follow Claude" scrolling, search, keyboard nav, git/GitHub buttons in the footer. | Most complete. MIT. Needs 2.1.287+. Docks automatically in the desktop app. Tested on Windows. |
| live-files | [yaqzans/claude-code-live-file-explorer](https://github.com/yaqzans/claude-code-live-file-explorer) | Desktop-first pane marking Added (green), Modified (blue), Deleted (grey, struck through), refreshed every couple of seconds. Remembers writes across compaction. Opens files in the app viewer. Skips node_modules, .venv, .git. | MIT. Needs 2.1.304+. Windows-aware (uses PowerShell for transcript search). |
| file-tree | [CosminBd/claude-file-tree](https://github.com/CosminBd/claude-file-tree) | Changed files in color, diffs, syntax-highlighted previews, rendered Markdown, "follow edits" mode. | not checked |
| pulse-file-tree | [its-coughfee/pulse-file-tree](https://github.com/its-coughfee/pulse-file-tree) | Sidebar tree where files Claude just edited pulse until the next turn. | not checked |

Install filetree (terminal):

```
claude plugin marketplace add data-goblin/claude-code-filetree
claude plugin install filetree@claude-code-filetree
```

Build note: filetree is probably worth installing as is rather than rebuilding. If we want our own, live-files is the smaller, desktop-focused base (single hooks module, Windows-aware).

## 2. Other mods worth a look, by category

Monitoring and cost
- burn-meter ([OneWave-AI/claude-code-mods](https://github.com/OneWave-AI/claude-code-mods)): live session cost above the prompt with plan-limit bars.
- cache-clock ([ray-amjad/claude-code-mods](https://github.com/ray-amjad/claude-code-mods)): one-line band with context usage and a countdown to prompt-cache expiry.
- context ring + usage meter ([AntonyWiles/claude-desktop-mods](https://github.com/AntonyWiles/claude-desktop-mods)): built for Windows desktop. A ring that fills as context fills, plan percentage and cost in the band. One plugin bundles several features behind options.

Git and project workflow
- git bar (AntonyWiles): Commit (Haiku writes the message) and Push buttons, branch picker, diff count above the prompt.
- task-board ([MarcoCarnevali/claude-code-mods](https://github.com/MarcoCarnevali/claude-code-mods)): To do / Doing / Done pane fed by Claude's todo list and approved plans; you can add cards; Claude can move them.
- github-issues (MarcoCarnevali): pane listing a repo's issues with filter, search and a "Work on it" button. Needs gh.
- vercel-deploy-status (ray-amjad): deploy queue under the prompt with phase and elapsed time.

Guards and safety (good for a shared team setup)
- launch-codes (OneWave): one-time code before risky Bash like rm -rf or force push.
- secret-box (ray-amjad): Claude uses secrets without seeing them; keys go to .env, Claude gets a placeholder, commits of .env are blocked. Includes transcript-redactor.
- prompt-bouncer (ray-amjad): catches vague prompts and suggests the project's own term before Claude sees them.

Prompting and navigation
- next-steps (Thariq Shihipar, bundled in AntonyWiles): up to three suggested next prompts after each turn, press 1-3 to insert.
- decision-tree (ray-amjad): when Claude ends with a question, lays the options out in a pane and lets you explore each in a forked session.
- diagram-pane (ray-amjad): pins diagrams Claude draws to a pane with a live map of the work.
- prompt-rail (in the awesome list): strip of past prompts to jump back to.
- prismantis ([NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis)): renders tables, code, Mermaid and charts in the transcript. Adds about 190 tokens per prompt.
- terminal-browser: a browser pane beside the conversation, for previewing sites.

Agents
- agent-narrator (OneWave): plain-English description of each agent step plus a time-saved counter.
- agent-race (OneWave): several sessions on one task on a shared scoreboard.

Memory
- memory-fork (ray-amjad): updates auto-memory in the background after each turn using Haiku.
- dream-pass (ray-amjad): merges duplicate memory entries, fixes stale ones, with backup and undo.

Fun
- code-pet, boss-fight, session-wrapped, inner-monologue, sportscaster (OneWave).

Catalog
- [karanb192/awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods): scheduled GitHub scan of 6,000+ mods, each validated with `claude plugin validate`, with access scope shown (files, network, processes). Has a `mod-finder` mod: describe a task, get mods. Full list at mods.aidojo.si. Not an official directory; read source before installing anything.
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official): Anthropic's directory.

## 3. Shortlist to build or adapt

Ranked by how much it would help a team working in the desktop app on Windows.

1. **Agent progress** (own version, based on agent-watch). Band above the prompt with subagents finished / started and a pane with per-agent model, context, cost and time. Drop the savvy-flow dependency. Add a per-agent progress bar driven by the agent's own step reports if we want granularity.
2. **Live file tree**. Install filetree first. If we want ours, start from live-files and add shimmer on read/write the way filetree does.
3. **Task board** (adapt MarcoCarnevali's). Fed by Claude's todo list; good for handing work between people.
4. **Git bar** (adapt AntonyWiles). Commit and push buttons with a generated message. The AntonyWiles repo is Windows-first, so it is the closest match to our setup.
5. **Guard mod** (adapt launch-codes or secret-box). One shared rule set for risky commands and .env handling across everyone's sessions.
6. **Next steps** (adapt). Cheap, useful, and a good first mod to learn the band API.

All of the above are MIT except where marked, so copy, rename and keep the original notice.

## 4. How to organize and share them

Recommendation: one GitHub repository that is itself a marketplace, with one folder per mod under `mods/`. This is the pattern the three largest community collections use (OneWave, ray-amjad, MarcoCarnevali).

Why one repo rather than one per mod:
- One `.claude-plugin/marketplace.json` lists every mod. Anyone installs any single mod with one line: `/plugin install <mod> --marketplace <owner>/<repo>`.
- Adding the checkout as a folder marketplace loads the mods live from the working copy during development (no reinstall, just `/reload-plugins`).
- One place for the README, license, secret scanning and CI validation.
- Separate repos only make sense if different mods need different visibility (public vs private).

Install paths for teammates:
- Terminal: `/plugin install <mod> --marketplace <owner>/<repo>` (Claude Code 2.1.275+).
- Desktop app: + next to the prompt, Plugins, Add marketplace, enter `<owner>/<repo>`, Add plugin. Mods installed at user scope from a terminal also load in the desktop app's local sessions.
- A private repo works, but each teammate needs read access on GitHub and a git credential for github.com on their machine (gh auth login, then gh auth setup-git).

Development on each machine:
- `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, folders separated by `;` on Windows, loads a mod in every session including the desktop app.
- `claude plugin validate mods/<name>` and `claude plugin test mods/<name>` before committing.

This repository is that layout: marketplace.json, README with install and dev instructions, and a `mods/_template` starter mod.

## Sources

- https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress
- https://github.com/Barncore/agent-watch
- https://github.com/Solutionmax/savvy-progress
- https://github.com/data-goblin/claude-code-filetree
- https://github.com/yaqzans/claude-code-live-file-explorer
- https://github.com/CosminBd/claude-file-tree
- https://github.com/its-coughfee/pulse-file-tree
- https://github.com/OneWave-AI/claude-code-mods
- https://github.com/ray-amjad/claude-code-mods
- https://github.com/MarcoCarnevali/claude-code-mods
- https://github.com/AntonyWiles/claude-desktop-mods
- https://github.com/karanb192/awesome-claude-code-mods
- https://github.com/scasella/claude-flightdeck
- https://github.com/anthropics/claude-plugins-official
- https://code.claude.com/docs/en/plugins/mods/interface
- https://dev.to/nakadadev/how-to-distribute-and-install-a-claude-code-mod-with-marketplacejson-and-plugin-install-1gka

## 5. Decisions so far (2026-10-24)

Not building yet. Agreed shortlist:

1. Agent progress: own version based on agent-watch, no savvy-flow dependency, optional per-agent step bar.
2. Live file tree: install filetree first; own version from live-files only if needed.
3. Guard: adapt launch-codes. secret-box not needed now.
4. Next steps: adapt. See token-cost note below.
5. cache-clock: liked. Note its default `onWarning: handoff` writes a HANDOFF-<id>.md into the project root when the cache is about to go cold; set it to `off` for a team install.
6. Usage tracking: pick one of the mods below, or build one on the engine's own data.

### What "band" means

The band is the AbovePrompt render site: the strip between the transcript and the prompt box, in both the terminal and the desktop app. A mod draws there by hooking `ui.render` with `{ component: 'AbovePrompt' }` and returning a tree of Box, Text and Button elements. The hook sees `hasSurvey` (yield to it), `isWorking` (a turn is running) and how many rows it may take. Several mods share the band; each adds its own rows. It is the cheapest place to draw: no pane to open or manage, no state needed beyond what you show.

### next-steps token cost

Yes, it costs tokens. After every turn whose answer is at least 80 characters (`minAnswerChars`), it calls `$.model.fork` with the whole conversation plus a fixed instruction and, by default, a list of the session's skills and commands (`suggestSkills`, up to about 2,500 tokens). The fork rides the prompt cache, so the conversation part is billed at cache-read rates, but it is still one extra model call per turn and counts toward the 5-hour and weekly windows. It does not pick a cheaper model. Ways to make ours cheaper: run it on Haiku, raise `minAnswerChars`, turn `suggestSkills` off, or make it on-demand (a button or command) instead of every turn.

### Usage-tracking mods compared

The engine gives mods the account's rate limits directly: `$.session.usage()` returns `rateLimits` with `kind` (`five_hour`, `seven_day`), `percentUsed` and `resetsAt`, and the `session.measure` event fires each time those figures move. So a usage mod needs no network call and no tokens. The one limit: the figures come from this session's last API response, so an idle session goes stale and usage from other sessions shows up only after the next reply here.

| Mod | Where numbers come from | Shows | Notes |
| --- | --- | --- | --- |
| [usage-counter (Hadi5yed)](https://github.com/Hadi5yed/claude-usage-counter) | engine rate-limit data, no network | 5h and weekly with reset countdowns, context fill, toasts at 80% and 90% | Optional Windows taskbar companion that shows the two percentages as tray icons. MIT. |
| [usage-quota (anantraghunath)](https://github.com/anantraghunath/claude-code-usage-quota-mod) | polls Anthropic's OAuth usage endpoint every 2 min, credential attached by the engine | 5h and weekly for the whole account even while idle, forecast of running out before reset, context, Compact button, auto-compact | Only network contact is Anthropic. Pro or Max. MIT. |
| [usage-meter (rodrigocamargo)](https://github.com/rodrigocamargo/usage-meter) | engine rate-limit data | docked pane with two colored bars and reset times | Terminal pane needs 144 columns; desktop docks. MIT. |
| [session-meter (plopaur)](https://github.com/plopaur/claude-mod-session-meter) | engine data | rate limits plus context, session cost and turn timing in one band | not checked |
| [desktop-mods usage meter (AntonyWiles)](https://github.com/AntonyWiles/claude-desktop-mods) | a Python collector running as a hidden scheduled task | plan percentage, tokens, API-equivalent cost | Heavier install (Python 3.9+, scheduled task). Windows-first. MIT. |
| [claude-usage-meter (Murtadha-Najem)](https://github.com/Murtadha-Najem/claude-usage-meter) | runs a test request on first use to learn the plan tier | per-request and per-conversation attribution | README contains text addressed to AI assistants. Treat with care; read the source before installing. |

Recommendation: usage-quota if the goal is "never open settings to check usage", because it stays fresh while idle and warns ahead of a reset. usage-counter if we want zero network calls, and its taskbar companion fits a Windows team. If we build our own, start from `$.session.usage()` and `session.measure` (zero cost), then add the 2-minute OAuth poll from usage-quota for whole-account freshness.

### Final list (2026-10-24)

Build or adapt in our repo:
1. agent-progress (own, based on agent-watch)
2. launch-codes (adapt)
3. file tree (own, based on live-files) only if filetree falls short

Install as is:
- filetree (data-goblin/claude-code-filetree)
- cache-clock (ray-amjad/claude-code-mods), with onWarning set to off
- usage-quota (anantraghunath/claude-code-usage-quota-mod)

Dropped: next-steps (one model call per turn), secret-box (not needed now).

Still open: GitHub owner and repo name, public or private, and build order.
