# usage-quota (fork): the context band

A compact band above the prompt for the context window:

```
Context  48% used  490k free of 1M          ○ Auto compact   [ Compact ]  ▼
████████████████████▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
Messages 419k   Tools 39k   Other 18k
```

- **Context**: how full the window is (amber from 50%, red from 80%), what is free, and a bar split into Messages, Tools and Other.
- **Compact** runs `/compact` in one click.
- **Auto compact** compacts between turns once the context reaches your % (30% by default, 15 to 99), never mid-reply. Each session keeps its own setting; a new session starts with it off. If the context is already past your % when you turn it on, it asks: compact now, or after your next compaction.
- **▼ / ▲** collapses the band to the summary row and the bar. The setting is shared by every session.
- `/quota` turns the band off and on.

This is a fork of [Anant Raghunath's usage-quota](https://github.com/anantraghunath/claude-code-usage-quota-mod) 0.1.6 (MIT). The changes:

- **No 5-hour or weekly meters, and no forecast.** [usage](../usage/README.md) shows the two windows on the status line under the prompt instead, so the band is three rows rather than ten.
- **No polling of the usage endpoint.** The original asked it every two minutes for the meters; the endpoint rate-limits, and the usage mod reads it too.
- **The band is passed on.** The original drew its block without handing the band to the mods beneath it, so any mod installed after it lost its band row. This one draws its block and then the rows beneath it, so install order no longer hides anything.

Install this one instead of the original, not alongside it.

## Where the numbers come from

All local: `$.session.usage()` for the window and its breakdown, the free estimate every 3 seconds, corrected every 2 minutes by the exact `/context` count (which costs no tokens). It reads the desktop app's `config.json` and, on Windows, `reg query` for the light or dark theme. No network requests.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install usage-quota --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**. Uninstall `usage-quota@claude-code-usage-quota-mod` first if it is installed.
