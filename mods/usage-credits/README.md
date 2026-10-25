# usage-credits

Your usage credits in the status line under the prompt: the dollars you have left. These are the credits Fable 5.1 and anything past your plan limits draw on, separate from the 5-hour and weekly plan windows that usage-quota tracks.

```
usage-credits  Credits $91.49 left
```

That is your purchased balance, as the billing page's Usage credits section shows it. The line adds a flag only when something stops credits being spent: `· monthly limit reached` if you have a monthly spend limit and hit it, `· credits off` if usage credits are switched off.

`/credits` prints the longer form, with this month's spend: `$91.49 left · no monthly limit, $93.84 spent this month`, or `· this month $93.84 of $100 monthly limit (94%)` when a limit is set. The 80% and 95% toasts only fire when a monthly limit is set.

If the balance cannot be read, the line falls back to what a monthly limit still allows: `Credits $6.16 left of $100 · 94%`. The balance and the monthly-limit figures are read separately, so a refusal from one endpoint does not hold back the other.

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
