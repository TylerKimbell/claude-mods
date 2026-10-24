# usage-credits

Your usage credits above the prompt: dollars left of the monthly limit and percent used. This is the pool Fable 5.1 draws on, and the one the claude.ai usage page shows as credits, separate from the 5-hour and weekly plan windows that usage-quota tracks.

```
◆ Credits $57.51 left of $100 · 42% used
```

Green under the warn level, amber above it, red from 95% or once the limit is reached. A dim note follows the row when the last refresh failed or the reading is stale.

## Where the numbers come from

The same account endpoint the app's usage page reads, through the session's own Claude login. The mod asks the engine for a credential handle and the engine attaches the credential; the mod never sees the token. It reads the `extra_usage` block (monthly limit and used credits, in cents) and falls back to the `spend` block. Nothing is sent anywhere else.

It refreshes at session start, every `pollMinutes` (default 5), and after each of Claude's turns at most once a minute, since spend moves after a turn. The last reading is kept across sessions, so the row shows at once and the fresh number replaces it.

Only Claude subscriptions have usage credits. With an API key or a gateway there is nothing to show and the row stays off.

## Commands

- `/credits` refreshes now and prints the balance.
- `/credits hide` and `/credits show` toggle the row. The `✕` on the row hides it too.

## Options

- `pollMinutes` (default 5): how often to refresh.
- `warnAt` (default 80): a toast once usage crosses this percent, and another at 95.

## Sharing the band

The band above the prompt is shared with other mods. usage-quota draws it without passing the draw down while it is on, so any mod seated beneath it there is hidden. If this row does not appear while usage-quota is on, `/credits` still answers, and the row shows whenever the band is open.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install usage-credits --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**.
