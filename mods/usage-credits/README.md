# usage-credits

Your usage credits in the status line under the prompt: the credit balance you have bought, and this month's spend against your monthly limit. These are the credits Fable 5.1 and anything past your plan limits draw on, separate from the 5-hour and weekly plan windows that usage-quota tracks.

```
usage-credits  Credits $91.49 left · month $93.84 of $100 limit
```

The two numbers are different limits, and either can stop credit use:

- **Balance** ($91.49 left): what you have bought and not spent, as the billing page's Usage credits section shows it.
- **Monthly limit** ($93.84 of $100): the most credits that may be spent in a calendar month. Once it is reached, credits stop being spent until next month, whatever the balance. The toasts at 80% and 95% are about this limit.

If the balance cannot be read, the line falls back to the monthly limit alone: `Credits $6.16 left of $100 · 94%`.

With the `showBand` option on, a row is drawn above the prompt as well: `◆ Credits $57.51 left of $100 · 42% used`, green under the warn level, amber above it, red from 95% or once the limit is reached, with a dim note when the last refresh failed or the reading is stale. It is off by default because the band is shared and usage-quota hides every mod seated beneath it there.

## Where the numbers come from

The same account endpoints the app reads, through the session's own Claude login. The mod asks the engine for a credential handle and the engine attaches the credential; the mod never sees the token.

- `api/oauth/usage`: the `extra_usage` block, monthly limit and used credits in cents (falling back to the `spend` block).
- `api/oauth/profile`, once per session: the organization's id, which the balance is filed under.
- `api/oauth/organizations/<id>/prepaid/credits`: the balance, `amount` in cents.

Nothing is sent anywhere but Anthropic.

It refreshes at session start, every `pollMinutes` (default 5), and after each of Claude's turns at most once a minute, since spend moves after a turn. The last reading is kept across sessions, so the row shows at once and the fresh number replaces it.

Only Claude subscriptions have usage credits. With an API key or a gateway there is nothing to show and the row stays off.

## Commands

- `/credits` refreshes now and prints the balance.
- `/credits hide` and `/credits show` toggle the band row when `showBand` is on. The `✕` on the row hides it too.

## Options

- `pollMinutes` (default 5): how often to refresh.
- `warnAt` (default 80): a toast once usage crosses this percent, and another at 95.
- `showBand` (default false): also draw the row above the prompt.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install usage-credits --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**.
