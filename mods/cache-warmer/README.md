# cache-warmer

Keeps a big session's prompt cache warm while you are away.

Every request writes the conversation to the prompt cache. Come back before the cache expires and the whole context is read back at a fraction of the price; come back after and it is re-sent at full cache-write price. A few minutes before the cache would lapse, while the session is idle, this mod makes one cheap, tool-less request over the transcript exactly as it was last sent, which reads the cached prefix back and restarts the cache's clock.

What it costs, by the price table the mods use, at a 400k-token Fable context:

| Event | Rough cost |
| --- | --- |
| One ping | about $0.10 |
| Coming back cold | about $4.90 more than coming back warm |

So the saving is real only if you come back to the session. When you are done with it, the pings are wasted, which is why there is a cap.

## Rules

- Pings only while no turn is running, `leadMinutes` (default 4) before the cache's `ttlMinutes` (default 60) are up.
- Stops after `maxHours` (default 4) of idle time. `maxHours` is really a cap on pings, `maxHours*60/ttlMinutes` of them (4 at the defaults), so a shorter `ttlMinutes` allows more pings in the same hours. Your next message starts a fresh run.
- Skips a context under `minTokens` (default 100k): too small to be worth it.
- If a ping is not served from the cache (under half the context read back), it stops for the run rather than paying full price again, and says so.
- If the cache already went cold before a ping was due, it does nothing: paying the write now or later costs the same.
- Does nothing in a headless `claude -p` run.

## What you see

Each ping drops one dim line into the transcript, `cache-warmer: pinged, 400k read from cache for ≈$0.10`, and the status line under the prompt reads `cache warm · 2 pings · ≈$0.20 · ≈$4.70 saved if you come back`. Your next turn clears it.

`/warmer` prints the state: minutes left on the cache, context size, pings and cost this run and this session, and why the last check pinged, skipped or stopped. `/warmer off` and `/warmer on` switch it.

## Alongside cache

Our [cache](../cache/README.md) mod restarts its countdown on a ping, so the two agree. The upstream cache-clock only sees a turn's own requests, so after a ping it says the cache went cold when it did not; `/warmer` has the real figure. The two mods do not interfere otherwise.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install cache-warmer --marketplace TylerKimbell/claude-mods
```

In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace** with `TylerKimbell/claude-mods`, then **Add plugin**.
