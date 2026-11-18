/**
 * The Acorn project lifecycle port — the mount/template/interact operations an
 * Acorn project's open sequence needs that the generic {@link DatasetLifecyclePort}
 * does not name.
 *
 * Optional on {@link BackendPorts} for the reason every capability port there is
 * optional: a backend that cannot mount a language onto a dataset simply omits it,
 * and every call site degrades instead of being refused. The in-memory backend the
 * offline tier runs on is that backend — the Acorn module registers on it by
 * contract, so nothing module-side may presume this port exists.
 *
 * The operations are AD4M's `perspective.mount`/`mounts`/`unmount`,
 * `language.applyTemplateLocal` and `expression.interact`, keyed by dataset id
 * rather than backend handle so a caller never interprets one. What they mean —
 * that a mount installs the language's foreign SDNA into the dataset, that a
 * templated language address is a function of the base bundle and the seed, that
 * `interact` runs one of the mounted language's declared interactions — is the
 * backend's business; the caller sequences them and reads the answers.
 */
export interface AcornLifecyclePort {
  /**
   * Apply a language's template locally and return the resulting language's
   * address — the AD4M `language.applyTemplateLocal` RPC. For Acorn this writes
   * the project seed into the base bundle, so the same `(source, seed)` pair
   * always produces the same address.
   */
  applyTemplateLocal(sourceLanguageHash: string, templateData: Record<string, unknown>): Promise<{ address: string }>;
  /**
   * Mount a language on a dataset — the executor mirrors the language's cell into
   * the dataset and installs its shapes. Resolves once the executor accepted the
   * mount; the data it syncs arrives later.
   */
  mount(datasetId: string, languageAddress: string): Promise<boolean>;
  /** The language addresses mounted on a dataset — empty for an unmounted one. */
  mounts(datasetId: string): Promise<string[]>;
  /** Remove a mount — the dataset keeps what synced; the mirror stops. */
  unmount(datasetId: string, languageAddress: string): Promise<boolean>;
  /**
   * Run one of a mounted language's declared interactions —
   * `expression.interact(<lang>://project, { name: 'whoami' })` and friends.
   * The wire result is a JSON string or null; the port returns it parsed, so a
   * caller sees the interaction's value rather than its encoding.
   */
  interact(url: string, call: { name: string; parameters?: object }): Promise<unknown>;
  /**
   * End whatever the port opened — sockets, timers — when the session it rides
   * on ends. Optional because a port backed by short-lived calls has nothing to
   * release; callers invoke it through the optional chain (`port.dispose?.()`).
   */
  dispose?: () => void;
}
