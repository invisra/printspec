import argparse
import json
import sys
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
from pathlib import Path

from .bom import bom_to_csv, bom_to_markdown, bom_to_supplier_order_list, extract_bom
from .bundle import create_bundle, write_bundle_to_directory, write_bundle_to_zip
from .forms import get_part_family_form_metadata, list_part_families
from .generators import generate_cadquery, generate_openscad
from .validate import validate_printspec


def _version():
    try:
        return package_version("printspec")
    except PackageNotFoundError:
        return "0.2.0"


def _load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf8"))
    except FileNotFoundError as e:
        raise SystemExit(f"error: unable to read JSON: {path}: read error: {e}")
    except OSError as e:
        raise SystemExit(f"error: unable to read JSON: {path}: read error: {e}")
    except json.JSONDecodeError as e:
        raise SystemExit(f"error: unable to read JSON: {path}: parse error: {e}")


def _write(text, output=None):
    if output:
        Path(output).write_text(text, encoding="utf8")
    else:
        print(text)


def _validate(spec):
    r = validate_printspec(spec)
    if r["valid"]:
        print("valid")
        return 0
    print("invalid", file=sys.stderr)
    for e in r["errors"]:
        print(f"- {e}", file=sys.stderr)
    return 1


def _generate(args, fn):
    spec = _load(args.file)
    r = validate_printspec(spec)
    if not r["valid"]:
        for e in r["errors"][:3]:
            print(f"error: {e}", file=sys.stderr)
        return 1
    g = fn(spec)
    if not g.get("supported"):
        print("error: " + g.get("message", "unsupported"), file=sys.stderr)
        return 1
    for w in g.get("warnings") or []:
        print("warning: " + w, file=sys.stderr)
    _write(g["code"], args.output)
    return 0


def _bom(args):
    spec = _load(args.file)
    bom = extract_bom(spec)
    text = {
        "markdown": bom_to_markdown,
        "csv": bom_to_csv,
        "supplier-list": bom_to_supplier_order_list,
    }[args.format](bom)
    _write(text, args.output)
    return 0


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(1, f"{self.prog}: error: {message}\n")


def main(argv=None):
    p = _Parser(
        prog="printspec",
        description="Validate printspec files and generate OpenSCAD, CadQuery, or BOM output.",
    )
    p.add_argument("--version", action="store_true", help="show printspec version and exit")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("version", help="show printspec version")
    v = sub.add_parser("validate", help="validate a printspec JSON file")
    v.add_argument("file")
    for name in ("to-openscad", "to-cadquery"):
        g = sub.add_parser(name, help=f"generate {name.removeprefix('to-')} output")
        g.add_argument("file")
        g.add_argument("--output")
    b = sub.add_parser("bom", help="extract a bill of materials")
    b.add_argument("file")
    b.add_argument("--format", choices=["markdown", "csv", "supplier-list"], default="markdown")
    b.add_argument("--output")
    bu = sub.add_parser("bundle", help="export a deterministic source bundle")
    bu.add_argument("file")
    bu.add_argument("--output")
    bu.add_argument("--overwrite", action="store_true")
    bu.add_argument("--no-openscad", action="store_true")
    bu.add_argument("--no-cadquery", action="store_true")
    bu.add_argument("--no-bom", action="store_true")
    bu.add_argument("--partcad", action="store_true")
    bu.add_argument("--zip", dest="zip_path")
    fm = sub.add_parser("form-metadata", help="print browser form metadata for a part family")
    fm.add_argument("part_type")
    fm.add_argument("--pretty", action="store_true")
    fm.add_argument("--json", action="store_true")
    lf = sub.add_parser("list-part-families", help="list available part families")
    lf.add_argument("--pretty", action="store_true")
    lf.add_argument("--json", action="store_true")
    args = p.parse_args(argv)
    if args.version or args.cmd == "version":
        print(f"printspec {_version()}")
        return 0
    if args.cmd is None:
        p.print_help()
        return 1
    if args.cmd == "validate":
        return _validate(_load(args.file))
    if args.cmd == "to-openscad":
        return _generate(args, generate_openscad)
    if args.cmd == "to-cadquery":
        return _generate(args, generate_cadquery)
    if args.cmd == "bom":
        return _bom(args)
    if args.cmd == "bundle":
        if not args.output and not args.zip_path:
            print(
                "error: bundle requires --output <directory> or --zip <bundle.zip>", file=sys.stderr
            )
            return 1
        spec = _load(args.file)
        b = create_bundle(
            spec,
            {
                "includeOpenScad": not args.no_openscad,
                "includeCadQuery": not args.no_cadquery,
                "includeBom": not args.no_bom,
                "includePartCad": args.partcad,
            },
        )
        if not b.get("supported"):
            print("error: " + (b.get("message") or "unsupported bundle"), file=sys.stderr)
            return 1
        try:
            if args.output:
                write_bundle_to_directory(b, args.output, overwrite=args.overwrite)
            if args.zip_path:
                write_bundle_to_zip(b, args.zip_path, overwrite=args.overwrite)
        except Exception as e:
            print("error: " + str(e), file=sys.stderr)
            return 1
        target = args.output or args.zip_path
        print(f"wrote {len(b['files'])} files to {target}")
        print(f"warnings: {len(b['warnings'])}")
        return 0
    if args.cmd == "form-metadata":
        try:
            print(
                json.dumps(
                    get_part_family_form_metadata(args.part_type), indent=2 if args.pretty else None
                )
            )
            return 0
        except ValueError as e:
            print("error: " + str(e), file=sys.stderr)
            return 1
    if args.cmd == "list-part-families":
        print(json.dumps(list_part_families(), indent=2 if args.pretty else None))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
