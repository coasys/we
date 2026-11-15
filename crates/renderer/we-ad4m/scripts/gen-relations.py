#!/usr/bin/env python3
"""Regenerate data/relations.json from packages/entities/src/manifest.

What the Rust adapter needs to know about each relation, read off the
manifest as the TS adapter and SDK do: entity -> relation ->
{ predicate, target, polymorphic, reverse }.

- `predicate`: what a `scope` drill-down's `parent` names
  (`resolveScopeToParent`); containment in AD4M's own spelling
  (`ad4m://has_child`, `containment.ts`).
- `polymorphic`: an include over it reads each member as the class it is
  (`resolvesPolymorphically`: declared, else untyped).
- `target`: the class an include's nested includes are resolved on.
- `reverse`: read backwards (`reverseOf`) — includable, never a scope.

WeNode's shared relations are folded into every WeNode entity.

    python3 crates/renderer/we-ad4m/scripts/gen-relations.py
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
MANIFEST = REPO / "packages/entities/src/manifest"
OUT = HERE.parent / "data/relations.json"
SKIP = {"types.ts", "defs.ts", "shared.ts", "index.ts", "base.ts"}
CONTAINMENT = "ad4m://has_child"
REL = re.compile(r"^\s*(\w+):\s*\{([^{}]*predicate:\s*('[^']*'|CONTAINMENT_PREDICATE)[^{}]*)\}", re.M)
TARGET = re.compile(r"target:\s*'([^']*)'")
POLY = re.compile(r"polymorphic:\s*(true|false)")


def relations(text):
    out = {}
    for name, body, pred in REL.findall(text):
        target = TARGET.search(body)
        target = target.group(1) if target else ""
        poly = POLY.search(body)
        out[name] = {
            "predicate": CONTAINMENT if pred == "CONTAINMENT_PREDICATE" else pred.strip("'"),
            "target": target,
            "polymorphic": (poly.group(1) == "true") if poly else target == "",
            "reverse": "reverseOf" in body,
        }
    return out


def block(text, start):
    """The `relations: { … }` object starting at `start`, braces balanced."""
    i = text.index("{", start)
    depth = 0
    for j in range(i, len(text)):
        depth += {"{": 1, "}": -1}.get(text[j], 0)
        if depth == 0:
            return text[i : j + 1]
    raise ValueError("unbalanced relations block")


shared_text = (MANIFEST / "shared.ts").read_text()
m = re.search(r"WE_NODE_RELATIONS[^=]*=\s*", shared_text)
we_node = relations(block(shared_text, m.end()))

table = {"WeNode": we_node}
for path in sorted(MANIFEST.glob("*.ts")):
    if path.name in SKIP or path.name.endswith(".test.ts"):
        continue
    text = path.read_text()
    own = {}
    m = re.search(r"\brelations:\s*", text)
    if m:
        own = relations(block(text, m.end()))
    if re.search(r"base:\s*'WeNode'", text):
        own = {**own, **{k: v for k, v in we_node.items() if k not in own}}
    table[path.stem] = dict(sorted(own.items()))

OUT.write_text(json.dumps(table, indent=2, sort_keys=True) + "\n")
print(f"wrote {OUT.relative_to(REPO)}: {len(table)} entities")
