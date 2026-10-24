export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  /** The engine's agent id, or the Agent tool call's id when none was given. */
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  /** The last request's whole input: how full the subagent's context is. */
  contextTokens: number
  contextMax: number
  /** Tokens across every request. */
  tokens: number
  costUsd: number
  /** Model requests seen. */
  steps: number
  /** Self-reported through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

/** The band's bar: one burst of subagents, from the first spawn until all finish. */
export type Bar = {
  total: number
  done: number
  running: number
  isFinished: boolean
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  hasAutoOpened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-progress': {
      bar: Bar | null
      agents: AgentRun[]
      panel: Panel
    }
  }
}
