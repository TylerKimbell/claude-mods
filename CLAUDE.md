# claude-mods

Tyler's Claude Code mods, as a plugin marketplace named `claude-mods`: one folder per mod under `mods/`, listed in `.claude-plugin/marketplace.json`.

- **Setting up a machine** ("install the mods", "set this laptop up", "same setup as my other machine"): follow `SETUP.md` step by step. Install order matters: usage-quota goes last, and step 7 checks it.
- **The CLI may not be on PATH.** The desktop app bundles it; `SETUP.md` step 2 says where.
- **Changing a mod**: edit it under `mods/<name>`, then `claude plugin validate mods/<name>` and `claude plugin test mods/<name>` before committing. Installed from this folder, a change reaches sessions on `/reload-plugins`.
- **Adding a mod**: copy `mods/_template`, add an entry to `.claude-plugin/marketplace.json` and a row to the README's table. Credit adapted code in `NOTICE`.
- **Mods that draw in the band above the prompt** are hidden by any mod above them that does not pass the draw down (usage-quota). The status line under the prompt and the spinner line are always visible.
