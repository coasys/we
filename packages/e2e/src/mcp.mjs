/**
 * An agent over the executor's MCP endpoint: the streamable-HTTP handshake (`initialize`, the
 * session header, `notifications/initialized`) and then `tools/list` and `tools/call` under one
 * account's token. The same client an MCP host speaks, written out so a test needs no SDK.
 */

/** The first JSON-RPC message in a response, whether it came as JSON or as server-sent events. */
async function readRpc(response) {
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split('\n')) {
      const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.jsonrpc) {
          await reader.cancel();
          return parsed;
        }
      } catch {
        // A partial line; the rest is still arriving.
      }
    }
    if (done) throw new Error(`MCP answered without a JSON-RPC message: ${buffer}`);
  }
}

/**
 * Opens an MCP session as the account `token` signs for. Resolves with `tools()` (every tool's name)
 * and `call(name, args)`, which answers the tool's text — parsed as JSON where it is JSON — and
 * throws on a JSON-RPC error or a tool result marked as one.
 */
export async function mcpSession(url, token, { clientName = 'we-e2e' } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  let id = 0;
  const init = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++id,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: clientName, version: '1' } },
    }),
  });
  const session = init.headers.get('mcp-session-id') ?? '';
  const hello = await readRpc(init);
  if (hello.error) throw new Error(`MCP initialize: ${hello.error.message}`);
  const withSession = { ...headers, 'Mcp-Session-Id': session };
  await fetch(url, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const rpc = async (method, params) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: withSession,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const answer = await readRpc(response);
    if (answer.error) throw new Error(`${method}: ${answer.error.message}`);
    return answer.result;
  };

  return {
    async tools() {
      const result = await rpc('tools/list', {});
      return (result?.tools ?? []).map((tool) => tool.name);
    },
    async call(name, args) {
      const result = await rpc('tools/call', { name, arguments: args });
      const text = (result?.content ?? []).map((part) => part.text ?? '').join('');
      if (result?.isError) throw new Error(`${name}: ${text}`);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
}
