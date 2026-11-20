/**
 * The harness link: the end the desktop app's harness build dials.
 *
 * A TCP listener on the loopback address. The app reads `COASYS_HARNESS_URL` and
 * `COASYS_HARNESS_TOKEN` at start, connects, and sends `{"hello":"we","token":…}` as its first
 * line; the link accepts the connection only with the token it gave that app, and closes any other.
 * After that each line is one JSON message: a command `{id, cmd, args}` from here, an answer
 * `{id, ok, result}` or `{id, ok: false, error}` from the app.
 *
 * Plain lines over TCP rather than a WebSocket: both ends are on this machine, and the app needs no
 * extra dependency for it.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { createInterface } from 'node:readline';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class HarnessLink {
  readonly token = randomBytes(24).toString('hex');
  private socket: Socket | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private waitingForApp: ((socket: Socket) => void)[] = [];
  /** Connections refused for a wrong token, for the report. */
  refused = 0;

  private constructor(
    private readonly server: Server,
    readonly port: number,
  ) {}

  static async listen(): Promise<HarnessLink> {
    let link!: HarnessLink;
    const server = createServer((socket) => link.accept(socket));
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (typeof address === 'object' && address) resolve(address.port);
        else reject(new Error('the harness link has no port'));
      });
    });
    link = new HarnessLink(server, port);
    return link;
  }

  /** What the app reads from `COASYS_HARNESS_URL`. */
  get url(): string {
    return `tcp://127.0.0.1:${this.port}`;
  }

  private accept(socket: Socket) {
    const lines = createInterface({ input: socket });
    let greeted = false;
    lines.on('line', (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      if (!greeted) {
        if (message.hello !== 'we' || message.token !== this.token || this.socket) {
          this.refused += 1;
          socket.destroy();
          return;
        }
        greeted = true;
        this.socket = socket;
        for (const waiter of this.waitingForApp.splice(0)) waiter(socket);
        return;
      }
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(String(message.error)));
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('the app closed the harness link'));
        this.pending.delete(id);
      }
    });
    socket.on('error', () => socket.destroy());
  }

  /** Waits until the app has connected with the right token. */
  connected(timeoutMs: number): Promise<void> {
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the app did not dial the harness link in ${timeoutMs / 1000} s`)),
        timeoutMs,
      );
      this.waitingForApp.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Sends one command and waits for its answer. */
  send<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error(`${cmd}: the app is not connected`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${cmd}: no answer in ${timeoutMs / 1000} s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      socket.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
  }

  async close(): Promise<void> {
    this.socket?.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
