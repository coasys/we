/**
 * `crypto.randomUUID` for a non-secure context.
 *
 * WE is served over plain HTTP on a LAN or a tailnet during development and demos, and a browser
 * withholds `randomUUID` outside a secure context — while `getRandomValues`, which is the part that
 * has to be unguessable, is available everywhere. ad4m-connect calls `randomUUID` when it mints a
 * guest identity, so without this a guest link fails on exactly the deployments it is demonstrated
 * on.
 *
 * Its own module, imported first, because an `import` is hoisted above every statement in the
 * importing file: written inline at the top of the entry point this ran *after* all of that file's
 * imports had already been evaluated, which is not what its position implied.
 */
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = () => {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    // Version 4, RFC 4122 variant.
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
