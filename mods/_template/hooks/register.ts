import type { Register } from 'claude-code'

// Smallest useful mod: a status-line note when a Bash command fails.
// Replace the body with the mod you are building. See the plugin-authoring
// skill (/plugin-authoring) for panes, bands, commands and state.
export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const failed = ran.deny === undefined && ran.isError === true
    $.ui.status(failed ? `failed: ${e.command.slice(0, 40)}` : undefined)
    return ran
  })
}
