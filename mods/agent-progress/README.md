# agent-progress

A progress bar above the prompt for Claude's own work and for the subagents it starts, and an Agents pane with each one's model, step progress, context fill, estimated cost and elapsed time.

Based on [Barncore's agent-watch](https://github.com/Barncore/agent-watch), a fork of [johnnyvizz's savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress) (both MIT). The savvy-flow orchestration, the tier costumes and the Russian strings are taken out. One thing is added: each subagent's brief gets a line asking it to report its own steps, so its row shows a real progress bar.

## What you see

- **Claude's bar**, always there: `Claude 2/5`, one segment per step of Claude's task list, and the step under way. It follows the task tools as Claude calls them (the desktop app's plan and wrap-up, the CLI's TodoWrite, TaskCreate and TaskUpdate): finished steps are solid, the current one pulses. A turn with no task list runs a wave across the bar, then reads `Claude done`. Whatever it last read stays until the next turn.
- **The subagent bar**: `Subagents 2/5 · 3 running`, a bar, a percentage, a `×5` button that opens the pane, and `✕` to dismiss. The bar appears when the first subagent starts and reads Done when the last one finishes. A finished bar stays as it last read until the next subagent starts a fresh one, or until you dismiss it.
- **The pane**: totals at the top (estimated cost, tokens, time), then running and finished subagents. Each row has the task description, agent type, model and effort, a segmented bar (one segment per step the subagent reports, or a wave while one that reports none is running), and `ctx %`, tokens, cost and elapsed time. Collapse to a row of status glyphs.

Cost is an estimate from token counts and a built-in price table, not a bill.

## How subagents report steps

The mod registers a tool, `mcp__agent-progress__step`, that takes `done`, `total` and `note`. With `askForSteps` on (the default), every subagent's prompt gets a short appended note asking it to call that tool after planning and after each step. Forks are left alone. A subagent that never calls it still shows up, with a wave across its bar while it runs.

## Commands

- `/subagents` shows or hides the pane.

## Options

- `autoOpen` (default true): open the pane the first time a subagent starts in a session.
- `askForSteps` (default true): append the step-reporting note to each subagent's brief.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install agent-progress --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**.
