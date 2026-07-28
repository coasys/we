import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * An MCP (Model Context Protocol) server an AI assistant can be granted access
 * to. The AD4M backend is responsible for connecting to it; this record only
 * stores the connection descriptor.
 *
 * `transport` is one of 'stdio' | 'sse' | 'http' | 'websocket'.
 * `url` is used for network transports (sse/http/websocket); `command` for
 * 'stdio'. `auth` holds an optional JSON-encoded auth descriptor (e.g. a bearer
 * token or header map) — kept as an opaque string so the shape stays open.
 * Lives in the personal (we-root) perspective.
 */
@Model({ name: 'McpServer' })
export class McpServer extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://mcp_server' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://transport' })
  transport: string = 'stdio';

  @Property({ through: 'we://url' })
  url: string = '';

  @Property({ through: 'we://command' })
  command: string = '';

  @Property({ through: 'we://auth' })
  auth: string = '';
}
