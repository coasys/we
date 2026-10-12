/**
 * The status an executor rejection carries — 403, 408 — or `undefined` when it carries none.
 *
 * Read from the error's shape, never with `instanceof RpcError`. The client the app holds comes from
 * `@coasys/ad4m-connect`, which bundles its own copy of the SDK, so its `RpcError` is a different
 * class from the one `@coasys/ad4m` exports. An `instanceof` check against the imported class
 * compiles, passes every unit test that throws the imported class, and never matches a real
 * rejection: a timed-out unlock went on reading as a wrong password, and a user session's refused
 * model check as a broken model.
 */
export function rpcStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}
