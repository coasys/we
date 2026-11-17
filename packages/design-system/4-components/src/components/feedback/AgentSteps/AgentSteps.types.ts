/** A step as a chat reads it: the shape both a backend's replies and a surface's own carry. */
export interface AgentStep {
  tool: string;
  /** The thing the call aimed at, named for the reader — a record, the space it went into. */
  target?: string;
  outcome: 'running' | 'ok' | 'error' | 'stopped';
  error?: string;
  /** The call changed something rather than only read — marked in orange after the fact. */
  wrote?: boolean;
  /** The backend refused the call outright — a capability the conversation does not hold. */
  refused?: boolean;
  /** A short digest of what came back — "3 results", "2 found". */
  summary?: string;
}

export interface AgentStepsProps {
  steps: AgentStep[];
  /** The reply these steps served is still running: the list stays open and running steps spin. */
  running: boolean;
}
