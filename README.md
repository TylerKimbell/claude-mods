# tam-mods

Claude Code mods we build and share. One repository, one marketplace, one folder per mod under `mods/`.

## Install a mod

At the prompt of a terminal `claude` session:

```
/plugin install <mod> --marketplace <owner>/<repo>
```

From a shell:

```
claude plugin install <mod> --marketplace <owner>/<repo>
```

In the Claude desktop app (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `<owner>/<repo>`, then **Add plugin**. New sessions load it; in an open session run `/reload-plugins`.

Requires Claude Code 2.1.287 or later. A private repo installs only for people who can read it on GitHub and have a git credential for github.com on their machine.

## Mods

| Mod | What it does |
| --- | --- |
| `mod-template` | Starter folder to copy for a new mod. |

## Develop a mod

Each mod folder holds three files:

```
mods/<name>/
  .claude-plugin/plugin.json   name, version, description
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           export const register: Register = (on) => { ... }
  types/index.d.ts             (optional) $.state contract
  *.test.ts                    (optional) run by `claude plugin test`
```

Load a mod in every local session while developing by adding its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (paths separated by `;` on Windows). Or add this checkout as a folder marketplace, which is read live:

```
claude plugin marketplace add <path to this checkout>
claude plugin install <mod>@tam-mods
```

Check a mod before committing:

```
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

## Add a mod to the marketplace

1. Copy `mods/_template` to `mods/<name>` and set `name` in `plugin.json`.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<name>"`.
3. Add a row to the table above.
