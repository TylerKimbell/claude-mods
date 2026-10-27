export type Phase = 'code' | 'armed' | 'launched' | 'aborted'

export type Alert = {
  /** Which tool asked: Bash, PowerShell, Edit, Write. */
  tool: string
  /** The command, or the file path for an edit. */
  command: string
  reason: string
  code: string
  startedAt: number
  expiresAt: number
  phase: Phase
  isDemo: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'launch-codes': {
      alert: Alert | null
      /** /launch-codes off: the checks are skipped for the rest of this session. */
      isOff: boolean
    }
  }
}
