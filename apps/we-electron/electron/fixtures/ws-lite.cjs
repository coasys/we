// The least of a WebSocket server the tests need to stand in for the executor's `/api/v1/ws`: the
// handshake's accept key, unmasking a client's text frames, and an unmasked text frame to send.
// No fragmentation, no binary frames, no ping: an RPC client sends none. A close frame ends the
// socket. CommonJS, so the fake executor can require it from any folder it is copied to.
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** The `Sec-WebSocket-Accept` for a client's `Sec-WebSocket-Key`. */
function wsAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

/** A server's text frame: never masked. */
function textFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Calls `onText` with each text frame the client sends on `socket`. */
function readFrames(socket, onText) {
  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 2) return;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        length = Number(buffered.readBigUInt64BE(2));
        at = 10;
      }
      const maskAt = at;
      if (masked) at += 4;
      if (buffered.length < at + length) return;
      const payload = Buffer.from(buffered.subarray(at, at + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffered[maskAt + (i % 4)];
      buffered = buffered.subarray(at + length);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x1) onText(payload.toString('utf8'));
    }
  });
  socket.on('error', () => {});
}

module.exports = { wsAccept, textFrame, readFrames };
