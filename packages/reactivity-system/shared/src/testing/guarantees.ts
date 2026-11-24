/**
 * The port's guarantees as a test suite, run against every implementation.
 *
 * Each case runs once per *host*: the place a store's root is created. Under Solid the answer to
 * "when does this effect run" depends on what is already running when the root is made, so the
 * guarantees are checked from each place a store can be built — a root at module scope (how a store
 * outside the component tree is made), a root made while another is being built (one composition
 * root building several stores), a root made from inside an effect, and a root made after an `await`
 * (a boot sequence). An implementation adds its own hosts, such as a mounted component tree.
 */
import { describe, expect, it } from 'vitest';

import type { ReactivityPort } from '../index';

/** Builds `build`'s computations inside some owner and hands back how to end them. */
export type ReactivityHost = (port: ReactivityPort, build: () => void) => (() => void) | Promise<() => void>;

const last = <T>(list: T[]): T | undefined => list[list.length - 1];

export const DEFAULT_HOSTS: Record<string, ReactivityHost> = {
  'a root at module scope': (port, build) => port.root(build),

  'a root made while another root is being built': (port, build) => {
    let inner = () => {};
    const outer = port.root(() => {
      inner = port.root(build);
    });
    return () => {
      inner();
      outer();
    };
  },

  'a root made inside an effect': (port, build) => {
    let inner = () => {};
    const outer = port.root(() => {
      port.effect(() => {
        inner = port.untrack(() => port.root(build));
      });
    });
    return () => {
      inner();
      outer();
    };
  },

  'a root made after an await': async (port, build) => {
    await Promise.resolve();
    return port.root(build);
  },
};

/**
 * Register the suite for one implementation. `create` makes a port per case; an implementation
 * whose port is a singleton (Solid's) returns the same one each time.
 */
export function describeReactivityGuarantees(
  name: string,
  create: () => ReactivityPort,
  hosts: Record<string, ReactivityHost> = DEFAULT_HOSTS,
): void {
  describe(`ReactivityPort guarantees: ${name}`, () => {
    for (const [where, host] of Object.entries(hosts)) {
      describe(`from ${where}`, () => {
        describe('an effect runs after the update that triggered it', () => {
          it('has run by the time the root it was created in returns', async () => {
            const p = create();
            const log: number[] = [];
            const [a] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => log.push(a())));
            expect(log).toEqual([1]);
            dispose();
          });

          it('has re-run by the time a write returns', async () => {
            const p = create();
            const log: number[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => log.push(a())));
            setA(2);
            expect(last(log)).toBe(2);
            setA(3);
            expect(last(log)).toBe(3);
            dispose();
          });

          it('sees the write complete, with what derives from it current', async () => {
            const p = create();
            const seen: [number, number][] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => {
              const doubled = p.memo(() => a() * 2);
              p.effect(() => seen.push([a(), doubled()]));
            });
            setA(5);
            expect(last(seen)).toEqual([5, 10]);
            expect(seen.every(([value, twice]) => twice === value * 2)).toBe(true);
            dispose();
          });

          it('has seen a write made while its root was being built, by the time the root returns', async () => {
            const p = create();
            const log: number[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => {
              p.effect(() => log.push(a()));
              setA(2);
            });
            expect(last(log)).toBe(2);
            dispose();
          });

          it('runs, when woken by a write inside another effect, before the outer write returns', async () => {
            const p = create();
            const log: number[] = [];
            const [a, setA] = p.signal(1);
            const [b, setB] = p.signal(0);
            const dispose = await host(p, () => {
              p.effect(() => setB(a() * 10));
              p.effect(() => log.push(b()));
            });
            expect(last(log)).toBe(10);
            setA(2);
            expect(last(log)).toBe(20);
            dispose();
          });

          it('has re-run by the time a write made after an await returns', async () => {
            const p = create();
            const log: number[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => log.push(a())));
            await new Promise((resolve) => setTimeout(resolve, 0));
            setA(4);
            expect(last(log)).toBe(4);
            dispose();
          });
        });

        describe('batch defers effects to its end', () => {
          it('runs no effect while the batch is open, and every woken one when it closes', async () => {
            const p = create();
            const seen: [number, number][] = [];
            const [a, setA] = p.signal(1);
            const [b, setB] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => seen.push([a(), b()])));
            const before = seen.length;
            p.batch(() => {
              setA(2);
              expect(seen.length).toBe(before);
              setB(3);
              expect(seen.length).toBe(before);
            });
            expect(last(seen)).toEqual([2, 3]);
            expect(seen).not.toContainEqual([2, 1]);
            dispose();
          });

          it('holds effects to the end of the outermost batch', async () => {
            const p = create();
            const log: number[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => log.push(a())));
            const before = log.length;
            p.batch(() => {
              p.batch(() => setA(2));
              expect(log.length).toBe(before);
              setA(3);
            });
            expect(last(log)).toBe(3);
            expect(log).not.toContain(2);
            dispose();
          });

          it('holds an effect created inside it to its end', async () => {
            const p = create();
            const log: number[] = [];
            const [a] = p.signal(1);
            const dispose = await host(p, () => {
              p.batch(() => {
                p.effect(() => log.push(a()));
                expect(log).toEqual([]);
              });
            });
            expect(log).toEqual([1]);
            dispose();
          });

          it('returns what its function returns', () => {
            const p = create();
            expect(p.batch(() => 42)).toBe(42);
          });
        });

        describe('a memo read is always current', () => {
          it('right after a write', async () => {
            const p = create();
            const [a, setA] = p.signal(1);
            let doubled = () => 0;
            const dispose = await host(p, () => {
              doubled = p.memo(() => a() * 2);
            });
            setA(4);
            expect(doubled()).toBe(8);
            dispose();
          });

          it('inside a batch, through a chain of memos', async () => {
            const p = create();
            const [a, setA] = p.signal(1);
            let quadrupled = () => 0;
            const dispose = await host(p, () => {
              const doubled = p.memo(() => a() * 2);
              quadrupled = p.memo(() => doubled() * 2);
              p.effect(() => void quadrupled());
            });
            p.batch(() => {
              setA(3);
              expect(quadrupled()).toBe(12);
              setA(5);
              expect(quadrupled()).toBe(20);
            });
            dispose();
          });

          it('inside an effect that has just written its source', async () => {
            const p = create();
            const seen: number[] = [];
            const [a, setA] = p.signal(1);
            const [s, setS] = p.signal(0);
            const dispose = await host(p, () => {
              const doubled = p.memo(() => s() * 2);
              p.effect(() => {
                setS(a() + 1);
                seen.push(doubled());
              });
            });
            expect(last(seen)).toBe(4);
            setA(10);
            expect(last(seen)).toBe(22);
            dispose();
          });

          it('while its root is being built, after a write', async () => {
            const p = create();
            const seen: number[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => {
              const doubled = p.memo(() => a() * 2);
              seen.push(doubled());
              setA(7);
              seen.push(doubled());
            });
            expect(seen).toEqual([2, 14]);
            dispose();
          });

          it('read untracked', async () => {
            const p = create();
            const [a, setA] = p.signal(1);
            let doubled = () => 0;
            const dispose = await host(p, () => {
              doubled = p.memo(() => a() * 2);
            });
            setA(6);
            expect(p.untrack(doubled)).toBe(12);
            dispose();
          });

          it('keeps what it last held once its root is disposed', async () => {
            const p = create();
            const [a, setA] = p.signal(1);
            let doubled = () => 0;
            const dispose = await host(p, () => {
              doubled = p.memo(() => a() * 2);
            });
            expect(doubled()).toBe(2);
            dispose();
            setA(9);
            expect(doubled()).toBe(2);
          });
        });

        describe('ownership', () => {
          it('stops an effect when its root is disposed', async () => {
            const p = create();
            const log: number[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => log.push(a())));
            dispose();
            setA(2);
            expect(log).toEqual([1]);
          });

          it('runs a cleanup before an effect re-runs and when its root is disposed', async () => {
            const p = create();
            const log: string[] = [];
            const [a, setA] = p.signal(1);
            const dispose = await host(p, () => {
              p.onCleanup(() => log.push('root'));
              p.effect(() => {
                const value = a();
                p.onCleanup(() => log.push(`effect ${value}`));
              });
            });
            setA(2);
            expect(log).toEqual(['effect 1']);
            dispose();
            expect(log).toEqual(['effect 1', 'effect 2', 'root']);
          });

          it('does not make an effect depend on what it reads untracked', async () => {
            const p = create();
            const log: number[] = [];
            const [a] = p.signal(1);
            const [b, setB] = p.signal(1);
            const dispose = await host(p, () => p.effect(() => log.push(a() + p.untrack(b))));
            setB(5);
            expect(log).toEqual([2]);
            dispose();
          });
        });

        it('stores a function written to a signal as the value, never calling it', async () => {
          const p = create();
          const [fn, setFn] = p.signal<() => string>(() => 'first');
          const dispose = await host(p, () => {});
          setFn(() => 'second');
          expect(fn()()).toBe('second');
          dispose();
        });
      });
    }
  });
}
