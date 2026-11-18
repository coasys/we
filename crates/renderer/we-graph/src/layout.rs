//! Positions for a graph that has already been built.
//!
//! `force` follows `packages/graph-system/layouts/src/force.ts` and the
//! d3-force 3 forces that file turns on: many-body charge −220, link
//! distance (default 90, the space view passes 130), centre strength 0.05,
//! collide radius 28. Link strength and bias are d3's defaults
//! (`1 / min(degree)` and `degree(source) / (degree(source) + degree(target))`).
//! Velocity keeps 0.6 each tick (`velocityDecay` 0.4). The schedule is one
//! tick, then three ticks until the count passes 220. The jitter is a fixed
//! xorshift, not `Math.random`. The charge is all-pairs, not Barnes-Hut, so
//! pixels are not the same as a browser. The three views do not pass a
//! containment map, so the containment force is not applied. Node and edge
//! identity is the gate.
//!
//! `tree` places roots on the left and breadth-first levels to the right.
//! It does not run the barycentre sweeps in `deterministic.ts`.

#[derive(Debug, Clone, Copy)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

pub struct LayoutNode<'a> {
    pub id: &'a str,
}

pub struct LayoutEdge<'a> {
    pub source: &'a str,
    pub target: &'a str,
}

/// Force layout. `distance` is the link length (the space view passes 130).
pub fn force(
    nodes: &[LayoutNode<'_>],
    edges: &[LayoutEdge<'_>],
    width: f32,
    height: f32,
    distance: f32,
) -> Vec<(String, Point)> {
    if nodes.is_empty() {
        return Vec::new();
    }
    // f64 matches d3's number. f32 overflows on the schema graph.
    let charge = -220.0_f64;
    let centre = 0.05_f64;
    let collide_r = 28.0_f64;
    let distance = f64::from(distance);
    let width = f64::from(width);
    let height = f64::from(height);
    let alpha_decay = 1.0 - 0.001_f64.powf(1.0 / 300.0);
    let mut rng = XorShift(0xE16A_11CE);
    let mut pos: Vec<DPoint> = (0..nodes.len())
        .map(|_| DPoint {
            x: width / 2.0 + (rng.next_unit() - 0.5) * 60.0,
            y: height / 2.0 + (rng.next_unit() - 0.5) * 60.0,
        })
        .collect();
    let mut vel = vec![DPoint { x: 0.0, y: 0.0 }; nodes.len()];
    let index: std::collections::HashMap<&str, usize> =
        nodes.iter().enumerate().map(|(i, n)| (n.id, i)).collect();
    let links: Vec<(usize, usize)> = edges
        .iter()
        .filter_map(|e| {
            let a = *index.get(e.source)?;
            let b = *index.get(e.target)?;
            (a != b).then_some((a, b))
        })
        .collect();
    let mut degree = vec![0_u32; nodes.len()];
    for &(a, b) in &links {
        degree[a] += 1;
        degree[b] += 1;
    }
    let link_meta: Vec<(f64, f64)> = links
        .iter()
        .map(|&(a, b)| {
            let da = f64::from(degree[a]);
            let db = f64::from(degree[b]);
            let strength = 1.0 / da.min(db);
            let bias = da / (da + db);
            (strength, bias)
        })
        .collect();

    let mut alpha = 1.0_f64;
    let tick = |alpha: f64, pos: &mut [DPoint], vel: &mut [DPoint], rng: &mut XorShift| {
        let n = pos.len();
        // Many-body, all pairs. d3 softens distances under 1.
        for i in 0..n {
            for j in (i + 1)..n {
                let mut dx = pos[j].x - pos[i].x;
                let mut dy = pos[j].y - pos[i].y;
                let mut l = dx * dx + dy * dy;
                if dx == 0.0 {
                    dx = jiggle(rng);
                    l += dx * dx;
                }
                if dy == 0.0 {
                    dy = jiggle(rng);
                    l += dy * dy;
                }
                if l < 1.0 {
                    l = l.sqrt();
                }
                let w = charge * alpha / l;
                vel[i].x += dx * w;
                vel[i].y += dy * w;
                vel[j].x -= dx * w;
                vel[j].y -= dy * w;
            }
        }
        // Links. Strength and bias are d3's defaults.
        for (k, &(a, b)) in links.iter().enumerate() {
            let (strength, bias) = link_meta[k];
            let mut x = pos[b].x + vel[b].x - pos[a].x - vel[a].x;
            let mut y = pos[b].y + vel[b].y - pos[a].y - vel[a].y;
            if x == 0.0 {
                x = jiggle(rng);
            }
            if y == 0.0 {
                y = jiggle(rng);
            }
            let len = (x * x + y * y).sqrt();
            let scale = (len - distance) / len * alpha * strength;
            x *= scale;
            y *= scale;
            vel[b].x -= x * bias;
            vel[b].y -= y * bias;
            vel[a].x += x * (1.0 - bias);
            vel[a].y += y * (1.0 - bias);
        }
        // Centre moves the cloud. It does not pull each node on its own.
        let mut sx = 0.0;
        let mut sy = 0.0;
        for p in pos.iter() {
            sx += p.x;
            sy += p.y;
        }
        let count = pos.len() as f64;
        sx = (sx / count - width / 2.0) * centre;
        sy = (sy / count - height / 2.0) * centre;
        for p in pos.iter_mut() {
            p.x -= sx;
            p.y -= sy;
        }
        // Collide, one pass, equal radii.
        let r = collide_r * 2.0;
        let r2 = r * r;
        for i in 0..n {
            for j in (i + 1)..n {
                let mut x = pos[i].x + vel[i].x - pos[j].x - vel[j].x;
                let mut y = pos[i].y + vel[i].y - pos[j].y - vel[j].y;
                let mut l2 = x * x + y * y;
                if l2 >= r2 {
                    continue;
                }
                if x == 0.0 {
                    x = jiggle(rng);
                    l2 += x * x;
                }
                if y == 0.0 {
                    y = jiggle(rng);
                    l2 += y * y;
                }
                let dist = l2.sqrt();
                let mag = (r - dist) / dist;
                x *= mag;
                y *= mag;
                // Equal radii → weight 0.5.
                vel[i].x += x * 0.5;
                vel[i].y += y * 0.5;
                vel[j].x -= x * 0.5;
                vel[j].y -= y * 0.5;
            }
        }
        // Internal decay is 0.6 when the public velocityDecay is 0.4.
        for i in 0..n {
            vel[i].x *= 0.6;
            vel[i].y *= 0.6;
            pos[i].x += vel[i].x;
            pos[i].y += vel[i].y;
        }
    };

    // One tick, then three per step, until the count passes 220.
    let step = |alpha: &mut f64, pos: &mut [DPoint], vel: &mut [DPoint], rng: &mut XorShift| {
        *alpha += (0.0 - *alpha) * alpha_decay;
        tick(*alpha, pos, vel, rng);
    };
    step(&mut alpha, &mut pos, &mut vel, &mut rng);
    let mut ticks = 0;
    while ticks < 220 {
        for _ in 0..3 {
            step(&mut alpha, &mut pos, &mut vel, &mut rng);
        }
        ticks += 3;
    }
    nodes
        .iter()
        .zip(pos)
        .map(|(n, p)| {
            (
                n.id.to_string(),
                Point {
                    x: p.x as f32,
                    y: p.y as f32,
                },
            )
        })
        .collect()
}

#[derive(Clone, Copy)]
struct DPoint {
    x: f64,
    y: f64,
}

fn jiggle(rng: &mut XorShift) -> f64 {
    (rng.next_unit() - 0.5) * 1.0e-6
}

/// Tree, direction right, `levelGap` between columns. Sibling gap 36.
pub fn tree(
    nodes: &[LayoutNode<'_>],
    edges: &[LayoutEdge<'_>],
    level_gap: f32,
) -> Vec<(String, Point)> {
    if nodes.is_empty() {
        return Vec::new();
    }
    let targets: std::collections::HashSet<&str> = edges.iter().map(|e| e.target).collect();
    let mut roots: Vec<&str> = nodes
        .iter()
        .map(|n| n.id)
        .filter(|id| !targets.contains(id))
        .collect();
    if roots.is_empty() {
        roots.push(nodes[0].id);
    }
    let mut children: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
    for edge in edges {
        children.entry(edge.source).or_default().push(edge.target);
    }
    let mut depth: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut queue = roots.clone();
    for id in &roots {
        depth.insert(*id, 0);
    }
    let mut head = 0;
    while head < queue.len() {
        let id = queue[head];
        head += 1;
        let next = depth[id] + 1;
        for child in children.get(id).into_iter().flatten() {
            if depth.contains_key(child) {
                continue;
            }
            depth.insert(child, next);
            queue.push(child);
        }
    }
    let max_depth = depth.values().copied().max().unwrap_or(0);
    for node in nodes {
        depth.entry(node.id).or_insert(max_depth + 1);
    }
    let mut levels: std::collections::BTreeMap<usize, Vec<&str>> =
        std::collections::BTreeMap::new();
    for node in nodes {
        levels.entry(depth[node.id]).or_default().push(node.id);
    }
    let sibling = 36.0_f32;
    let mut out = Vec::with_capacity(nodes.len());
    for (level, row) in &levels {
        for (i, id) in row.iter().enumerate() {
            out.push((
                (*id).to_string(),
                Point {
                    x: *level as f32 * level_gap,
                    y: i as f32 * sibling,
                },
            ));
        }
    }
    out
}

struct XorShift(u64);

impl XorShift {
    fn next_unit(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x % 10_000) as f64 / 10_000.0
    }
}
