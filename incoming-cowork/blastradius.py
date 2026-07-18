#!/usr/bin/env python3
"""Blast radius — the one idea worth taking from code-review-graph, rebuilt lean.

code-review-graph (tirth8205) builds a Tree-sitter + SQLite knowledge graph of a codebase and
answers "given this change, what does it actually touch?" — callers, dependents, affected tests.
That question is the useful part. This is ~150 stdlib-only lines that answer it for Python:
no Tree-sitter, no SQLite, no daemon, no MCP server — just `ast`.

Why it's here: it answers three real questions cheaply — (1) which files must an AI actually
read to review a change (the token-reduction win), (2) what breaks if I edit this symbol
(dependency safety), (3) which high-traffic symbols have no test naming them (code health).
It also raises the care level on shared files: a symbol with many dependents is one you
coordinate on before editing — relevant after two sessions collided on run.py this week
(though the precise fix for concurrent edits is git + the doctrine's coordination note, not
this tool).

Scope, honestly: Python only, name-resolved (a call to `backtest` matches any def named
`backtest` — no full type resolution), direct-naming coverage (a symbol tested only
transitively reads as "no test names it"), one repo. Good enough to flag risk; not a compiler.

    python blastradius.py <root> <target>
      <target> = a file path (foo/bar.py) or a bare symbol name (backtest)
    python blastradius.py <root> --hotspots     # rank symbols by caller count × test gap
"""
from __future__ import annotations

import ast
import os
import sys
from collections import defaultdict


def _py_files(root: str):
    for dp, _, files in os.walk(root):
        if any(skip in dp for skip in ("__pycache__", ".git", ".pytest_cache", "node_modules")):
            continue
        for f in files:
            if f.endswith(".py"):
                yield os.path.join(dp, f)


def _is_test(path: str) -> bool:
    b = os.path.basename(path)
    return b.startswith("test_") or b.endswith("_test.py") or os.sep + "tests" + os.sep in path


def build_index(root: str):
    """defs: symbol -> [(file, qualname)]; refs: file -> {func_or_'<module>': set(names_used)}."""
    defs = defaultdict(list)      # simple name -> [(file, qualname)]
    refs = defaultdict(lambda: defaultdict(set))  # file -> scope -> {names used}
    file_defs = defaultdict(set)  # file -> {simple names defined here}

    for path in _py_files(root):
        try:
            tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
        except (SyntaxError, UnicodeDecodeError):
            continue
        rel = os.path.relpath(path, root)

        class Collector(ast.NodeVisitor):
            def __init__(self):
                self.scope = ["<module>"]

            def _record_defs(self, node, cls=None):
                name = node.name
                qual = f"{cls}.{name}" if cls else name
                defs[name].append((rel, qual))
                file_defs[rel].add(name)

            def visit_ClassDef(self, node):
                self._record_defs(node)
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        self._record_defs(item, cls=node.name)
                self.scope.append(node.name)
                self.generic_visit(node)
                self.scope.pop()

            def _visit_fn(self, node):
                if len(self.scope) == 1:            # top-level function (methods recorded above)
                    self._record_defs(node)
                self.scope.append(node.name)
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Call):
                        f = sub.func
                        nm = getattr(f, "id", None) or getattr(f, "attr", None)
                        if nm:
                            refs[rel][node.name].add(nm)
                    elif isinstance(sub, ast.Attribute):
                        refs[rel][node.name].add(sub.attr)
                    elif isinstance(sub, ast.Name):
                        refs[rel][node.name].add(sub.id)
                self.scope.pop()

            visit_FunctionDef = _visit_fn
            visit_AsyncFunctionDef = _visit_fn

        Collector().visit(tree)
        # module-level references (imports/usage outside any function)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                mod = getattr(node, "module", "") or ""
                for a in node.names:
                    refs[rel]["<module>"].add((a.name or "").split(".")[0])
                    if mod:
                        refs[rel]["<module>"].add(mod.split(".")[-1])
    return defs, refs, file_defs


def blast_radius(root: str, target: str):
    defs, refs, file_defs = build_index(root)

    # resolve target -> set of symbol names to trace
    if target.endswith(".py") or os.sep in target:
        rel = os.path.relpath(target, root) if os.path.isabs(target) else target
        rel = os.path.normpath(rel)
        syms = set(file_defs.get(rel, set()))
        label = f"file {rel} ({len(syms)} symbols)"
        origin_files = {rel}
    else:
        syms = {target}
        label = f"symbol '{target}'"
        origin_files = {f for f, _ in defs.get(target, [])}

    if not syms:
        print(f"No symbols found for target: {target}")
        return 2

    callers = defaultdict(set)   # file -> {functions that reference a target symbol}
    test_files = set()
    for f, scopes in refs.items():
        if f in origin_files:
            continue
        for scope, used in scopes.items():
            if used & syms:
                callers[f].add(scope)
                if _is_test(f):
                    test_files.add(f)

    nontest_callers = {f: s for f, s in callers.items() if not _is_test(f)}
    print(f"\nBLAST RADIUS — {label}   (root: {root})")
    print("=" * 66)
    print(f"defined in: {', '.join(sorted(origin_files)) or '(unknown)'}")

    print(f"\ndirect callers / dependents ({len(nontest_callers)} files):")
    for f in sorted(nontest_callers):
        scopes = sorted(x for x in nontest_callers[f] if x != "<module>")
        mod = " [imports]" if "<module>" in nontest_callers[f] else ""
        print(f"  {f}{mod}" + (f"  → {', '.join(scopes)}" if scopes else ""))

    print(f"\ntest coverage ({len(test_files)} test files reference it):")
    for f in sorted(test_files):
        print(f"  {f}")
    if not test_files:
        print("  ⚠️  NONE — changes here are unverified by any test that names it")

    risk = len(nontest_callers) * (1 if test_files else 3)
    band = "LOW" if risk <= 2 else "MEDIUM" if risk <= 6 else "HIGH"
    note = "" if test_files else "  (×3: no test names it)"
    print(f"\nrisk: {band} — {len(nontest_callers)} dependents{note}. "
          f"{'Coordinate before editing; another session may be here too.' if band != 'LOW' else 'Localised change.'}")
    return 0


def hotspots(root: str, top: int = 12):
    defs, refs, file_defs = build_index(root)
    ref_count = defaultdict(int)
    tested = defaultdict(bool)
    for f, scopes in refs.items():
        istest = _is_test(f)
        for used in scopes.values():
            for name in used:
                if name in defs:
                    ref_count[name] += 0 if istest else 1
                    if istest:
                        tested[name] = True
    rows = []
    for name, c in ref_count.items():
        if any(_is_test(f) for f, _ in defs[name]):
            continue
        rows.append((c * (1 if tested[name] else 3), c, tested[name], name))
    rows.sort(reverse=True)
    print(f"\nHOTSPOTS — most-depended-on symbols (risk = callers × test-gap), root: {root}")
    print("=" * 66)
    print(f"{'risk':>5}  {'callers':>7}  {'tested':>6}  symbol")
    for risk, c, t, name in rows[:top]:
        print(f"{risk:>5}  {c:>7}  {'yes' if t else 'NO ':>6}  {name}")
    return 0


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    root = sys.argv[1]
    if sys.argv[2] == "--hotspots":
        return hotspots(root)
    return blast_radius(root, sys.argv[2])


if __name__ == "__main__":
    sys.exit(main())
