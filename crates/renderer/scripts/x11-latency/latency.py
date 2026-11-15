"""Input-to-screen latency of a lane drag in the :99 window.

Holds the button on the tree lane's edge and moves the pointer in steps of
`step` px every `gap` ms with XTest; after each move, polls one row of the
screen until it changes and records how long that took. Prints the median
and p95 over the moves. Usage: latency.py <edge_x> <moves> <gap_ms> [step]
"""
import ctypes, ctypes.util, sys, time, statistics
from xrow import X, d, row
Xt = ctypes.cdll.LoadLibrary(ctypes.util.find_library('Xtst'))
Xt.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
Xt.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
X.XFlush.argtypes = [ctypes.c_void_p]; X.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
def move(x, y):
    Xt.XTestFakeMotionEvent(d, -1, x, y, 0); X.XSync(d, 0)
def button(down):
    Xt.XTestFakeButtonEvent(d, 1, 1 if down else 0, 0); X.XSync(d, 0)
if __name__ == "__main__":
    edge, moves, gap = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3]) / 1000
    step = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    Y, ROW = 400, 600
    move(edge, Y); time.sleep(0.3); button(True); time.sleep(0.2)
    lat = []; missed = 0
    x = edge
    for i in range(moves):
        before = row(ROW)
        x += step if (i // 40) % 2 == 0 else -step
        t0 = time.perf_counter(); move(x, Y)
        seen = None
        while time.perf_counter() - t0 < 0.25:
            if row(ROW) != before:
                seen = time.perf_counter() - t0; break
        if seen is None: missed += 1
        else: lat.append(seen * 1000)
        rest = gap - (time.perf_counter() - t0)
        if rest > 0: time.sleep(rest)
    button(False)
    lat.sort()
    print(f"moves {moves} gap {gap*1000:.0f}ms: latency median {statistics.median(lat):.1f} ms, p95 {lat[int(len(lat)*0.95)-1]:.1f} ms, max {lat[-1]:.1f}, unseen {missed}")
