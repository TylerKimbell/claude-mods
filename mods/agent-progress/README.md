# agent-progress

A progress bar above the prompt for the subagents Claude starts, and an Agents pane with each one's model, step progress, context fill, estimated cost and elapsed time.

Based on [Barncore's agent-watch](https://github.com/Barncore/agent-watch), a fork of [johnnyvizz's savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress) (both MIT). The savvy-flow orchestration, the tier costumes and the Russian strings are taken out. One thing is added: each subagent's brief gets a line asking it to report its own steps, so its row shows a real progress bar rather than a context-fill fallback.

## What you see

Only subagents. Claude's own turn is left to the app, whose spinner line already says what it is doing and for how long.

- **The subagent bar**: `Subagents 2/5 · 3 running`, a bar, a percentage, a `×5` button that opens the pane, and `✕` to dismiss. The bar appears when the first subagent starts and reads Done when the last one finishes. It clears when you send your next prompt.
- **The pane**: totals at the top (estimated cost, tokens, time), then running and finished subagents. Each row has the task description, agent type, model and effort, a progress bar (the subagent's own steps when it reports them, otherwise its context fill in grey), and `ctx %`, tokens, cost and elapsed time. Collapse to a row of status glyphs.

Cost is an estimate from token counts and a built-in price table, not a bill.

## How subagents report steps

The mod registers a tool, `mcp__agent-progress__step`, that takes `done`, `total` and `note`. With `askForSteps` on (the default), every subagent's prompt gets a short appended note asking it to call that tool after planning and after each step. Forks are left alone. A subagent that never calls it still shows up, with its context fill as the bar.

## Commands

- `/agents` shows or hides the pane.

## Options

- `autoOpen` (default true): open the pane the first time a subagent starts in a session.
- `askForSteps` (default true): append the step-reporting note to each subagent's brief.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install agent-progress --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**.
