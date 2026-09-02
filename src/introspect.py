#!/usr/bin/env python3
"""Extract API documentation from Python source and emit it as JSON.

Reads source with :mod:`ast` rather than importing it. That choice is deliberate and it
is the main thing separating this from most Python autodoc tooling:

* Importing a module runs it. A docs build that imports the project it documents inherits
  every import-time side effect the project has, and a project that reads configuration
  at import time cannot be documented at all without supplying that configuration.
* Importing requires the project's dependencies to be installed and importable in
  whatever interpreter the docs build happens to use. Parsing requires only the source.
* An import failure in one module takes out the whole run in ways that are tedious to
  attribute. A parse failure is local to one file and names the file.

The cost is that anything only knowable at runtime is invisible here: dynamically
attached attributes, values computed by decorators, members inherited from a base class
in another module. For documenting hand-written docstrings, which is what this is for,
that trade is worth taking.

Usage:
    introspect.py --root <project root> --module <dotted.name> [--module ...]

Emits a single JSON object on stdout: ``{"modules": [...]}``. Exits non-zero, with the
reason on stderr, if any requested module cannot be located or parsed.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

#: Dunder names worth documenting when they carry a docstring. Everything else starting
#: with an underscore is treated as private and skipped, which matches what a reader of
#: the public API wants to see.
_PUBLIC_DUNDERS = frozenset({"__init__", "__call__", "__enter__", "__exit__", "__aenter__", "__aexit__"})


def _is_public(name: str) -> bool:
    """Whether a member name should appear in the generated reference."""
    if name in _PUBLIC_DUNDERS:
        return True
    return not name.startswith("_")


def _clean(doc: str | None) -> str:
    """Normalize a docstring's indentation without reflowing its content."""
    if not doc:
        return ""
    return _dedent(doc).strip()


def _dedent(doc: str) -> str:
    """Strip the common leading whitespace from every line after the first.

    ``inspect.cleandoc`` does this, but importing :mod:`inspect` here would invite the
    reflex to use the rest of it, and the rule is short enough to state outright: the
    first line is already flush, so it is excluded from the common-prefix calculation.
    """
    lines = doc.expandtabs().splitlines()
    if not lines:
        return ""
    rest = [line for line in lines[1:] if line.strip()]
    indent = min((len(line) - len(line.lstrip()) for line in rest), default=0)
    out = [lines[0].strip()]
    out.extend(line[indent:].rstrip() if len(line) > indent else line.strip() for line in lines[1:])
    return "\n".join(out)


def _signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    """Render a function's signature the way it appears in source, annotations included."""
    args = node.args
    parts: list[str] = []

    positional = args.posonlyargs + args.args
    defaults: list[ast.expr | None] = [None] * (len(positional) - len(args.defaults))
    defaults += list(args.defaults)

    for index, arg in enumerate(positional):
        parts.append(_render_arg(arg, defaults[index]))
        if args.posonlyargs and index == len(args.posonlyargs) - 1:
            parts.append("/")

    if args.vararg is not None:
        parts.append("*" + _render_arg(args.vararg, None))
    elif args.kwonlyargs:
        parts.append("*")

    for arg, default in zip(args.kwonlyargs, args.kw_defaults, strict=True):
        parts.append(_render_arg(arg, default))

    if args.kwarg is not None:
        parts.append("**" + _render_arg(args.kwarg, None))

    rendered = f"({', '.join(parts)})"
    if node.returns is not None:
        rendered += f" -> {ast.unparse(node.returns)}"
    return rendered


def _render_arg(arg: ast.arg, default: ast.expr | None) -> str:
    """Render one parameter, with its annotation and default if it has them."""
    text = arg.arg
    if arg.annotation is not None:
        text += f": {ast.unparse(arg.annotation)}"
    if default is not None:
        text += f" = {ast.unparse(default)}" if arg.annotation is not None else f"={ast.unparse(default)}"
    return text


def _function(node: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, Any]:
    """Describe one function or method."""
    return {
        "name": node.name,
        "signature": _signature(node),
        "doc": _clean(ast.get_docstring(node)),
        "is_async": isinstance(node, ast.AsyncFunctionDef),
        "decorators": [ast.unparse(d) for d in node.decorator_list],
    }


def _class(node: ast.ClassDef) -> dict[str, Any]:
    """Describe one class and its public methods."""
    methods = [
        _function(child)
        for child in node.body
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef) and _is_public(child.name)
    ]
    attributes = []
    for child in node.body:
        if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
            if not _is_public(child.target.id):
                continue
            attributes.append(
                {
                    "name": child.target.id,
                    "annotation": ast.unparse(child.annotation),
                    "default": ast.unparse(child.value) if child.value is not None else "",
                }
            )
    return {
        "name": node.name,
        "bases": [ast.unparse(base) for base in node.bases],
        "doc": _clean(ast.get_docstring(node)),
        "decorators": [ast.unparse(d) for d in node.decorator_list],
        "methods": methods,
        "attributes": attributes,
    }


def _module_constants(tree: ast.Module) -> list[dict[str, Any]]:
    """Describe module-level assignments that read as public constants.

    Only upper-case names are treated as constants. A module-level lower-case binding is
    usually a singleton or a private helper, and listing those as API surface is noise.
    """
    constants = []
    for node in tree.body:
        targets: list[str] = []
        annotation = ""
        value = ""
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            targets = [node.target.id]
            annotation = ast.unparse(node.annotation)
            value = ast.unparse(node.value) if node.value is not None else ""
        elif isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = ast.unparse(node.value)
        for name in targets:
            if name.isupper() and _is_public(name):
                constants.append({"name": name, "annotation": annotation, "value": value})
    return constants


def _locate(root: Path, dotted: str) -> Path:
    """Find the source file for a dotted module name under ``root``.

    Both layouts are supported without configuration: a ``src/`` layout and a package
    sitting directly at the project root. A package resolves to its ``__init__.py``.
    """
    relative = Path(*dotted.split("."))
    for base in (root / "src", root):
        for candidate in (base / relative.with_suffix(".py"), base / relative / "__init__.py"):
            if candidate.is_file():
                return candidate
    raise FileNotFoundError(
        f"no source found for module {dotted!r} under {root} "
        f"(looked for {relative}.py and {relative}/__init__.py, in ./src and ./)"
    )


def describe(root: Path, dotted: str) -> dict[str, Any]:
    """Parse one module and return its public API as a plain dictionary."""
    path = _locate(root, dotted)
    source = path.read_text(encoding="utf8")
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as err:
        raise SyntaxError(f"{path}: {err}") from err

    functions = [
        _function(node)
        for node in tree.body
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and _is_public(node.name)
    ]
    classes = [_class(node) for node in tree.body if isinstance(node, ast.ClassDef) and _is_public(node.name)]

    return {
        "module": dotted,
        "source": str(path.relative_to(root)),
        "overview": _clean(ast.get_docstring(tree)),
        "constants": _module_constants(tree),
        "classes": classes,
        "functions": functions,
    }


def main(argv: list[str] | None = None) -> int:
    """Parse every requested module and print one JSON document."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="project root to resolve modules against")
    parser.add_argument("--module", action="append", default=[], help="dotted module name; repeatable")
    args = parser.parse_args(argv)

    if not args.module:
        print("introspect.py: no --module given, nothing to document", file=sys.stderr)
        return 2

    modules = []
    for dotted in args.module:
        try:
            modules.append(describe(args.root.resolve(), dotted))
        except (FileNotFoundError, SyntaxError, OSError) as err:
            print(f"introspect.py: {err}", file=sys.stderr)
            return 1

    json.dump({"modules": modules}, sys.stdout, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
