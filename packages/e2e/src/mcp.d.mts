export interface McpSession {
  /** Every tool's name. */
  tools(): Promise<string[]>;
  /** A tool's text answer, parsed as JSON where it is JSON; throws on an error or an error result. */
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Opens an MCP session (streamable HTTP) as the account `token` signs for. */
export function mcpSession(url: string, token: string, options?: { clientName?: string }): Promise<McpSession>;
