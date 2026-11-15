"""Settle latency of a fast lane drag in the :99 window: bursts of `n`
moves `step` px apart, `gap` ms between moves (faster than frames, so
frames queue), then the time from the last move until one screen row shows
the lane's border at the pointer. Usage: settle.py <edge_x> <trials> [n] [gap_ms] [step]"""
import sys, time, statistics
from latency import move, button
from xrow import row
edge, trials = int(sys.argv[1]), int(sys.argv[2])
n = int(sys.argv[3]) if len(sys.argv) > 3 else 20
gap = (float(sys.argv[4]) if len(sys.argv) > 4 else 2.0) / 1000
step = int(sys.argv[5]) if len(sys.argv) > 5 else 3
Y, ROW = 400, 600
def border(buf, x):
    best, at = -1, None
    for c in range(max(1, x - 40), min(1279, x + 40)):
        a, b = buf[c*4:c*4+3], buf[c*4+4:c*4+7]
        d = sum(abs(p - q) for p, q in zip(a, b))
        if d > best: best, at = d, c
    return at
move(edge, Y); time.sleep(0.3); button(True); time.sleep(0.2)
base = border(row(ROW), edge)  # where the border sits relative to the pointer
off = base - edge
x = edge; lat = []; unseen = 0
for t in range(trials):
    sign = 1 if t % 2 == 0 else -1
    for i in range(n):
        x += sign * step; move(x, Y); time.sleep(gap)
    t0 = time.perf_counter(); seen = None
    while time.perf_counter() - t0 < 0.5:
        b = border(row(ROW), x)
        if b is not None and abs(b - (x + off)) <= 1:
            seen = time.perf_counter() - t0; break
    if seen is None: unseen += 1
    else: lat.append(seen * 1000)
    time.sleep(0.15)
button(False)
lat.sort()
print(f"{trials} bursts of {n} moves every {gap*1000:.0f} ms: after the last move, edge on screen in median {statistics.median(lat):.1f} ms, p95 {lat[max(0,int(len(lat)*0.95)-1)]:.1f} ms, unseen {unseen}")
