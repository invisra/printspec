import argparse, json, sys
from importlib.metadata import PackageNotFoundError, version as package_version
from pathlib import Path
from .validate import validate_printspec
from .generators import generate_openscad, generate_cadquery
from .bom import extract_bom, bom_to_markdown, bom_to_csv, bom_to_supplier_order_list


def _version():
    try:
        return package_version('printspec')
    except PackageNotFoundError:
        return '0.1.0'


def _load(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf8'))
    except FileNotFoundError as e:
        raise SystemExit(f'error: unable to read JSON: {path}: read error: {e}')
    except OSError as e:
        raise SystemExit(f'error: unable to read JSON: {path}: read error: {e}')
    except json.JSONDecodeError as e:
        raise SystemExit(f'error: unable to read JSON: {path}: parse error: {e}')


def _write(text, output=None):
    if output: Path(output).write_text(text, encoding='utf8')
    else: print(text)


def _validate(spec):
    r=validate_printspec(spec)
    if r['valid']: print('valid'); return 0
    print('invalid', file=sys.stderr)
    for e in r['errors']: print(f'- {e}', file=sys.stderr)
    return 1


def _generate(args, fn):
    spec=_load(args.file); r=validate_printspec(spec)
    if not r['valid']:
        for e in r['errors'][:3]: print(f'error: {e}', file=sys.stderr)
        return 1
    g=fn(spec)
    if not g.get('supported'):
        print('error: '+g.get('message','unsupported'), file=sys.stderr); return 1
    for w in g.get('warnings') or []: print('warning: '+w, file=sys.stderr)
    _write(g['code'], args.output); return 0


def _bom(args):
    spec=_load(args.file); bom=extract_bom(spec)
    text={'markdown':bom_to_markdown,'csv':bom_to_csv,'supplier-list':bom_to_supplier_order_list}[args.format](bom)
    _write(text,args.output); return 0


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(1, f'{self.prog}: error: {message}\n')


def main(argv=None):
    p=_Parser(prog='printspec', description='Validate printspec files and generate OpenSCAD, CadQuery, or BOM output.')
    p.add_argument('--version', action='store_true', help='show printspec version and exit')
    sub=p.add_subparsers(dest='cmd')
    sub.add_parser('version', help='show printspec version')
    v=sub.add_parser('validate', help='validate a printspec JSON file'); v.add_argument('file')
    for name in ('to-openscad','to-cadquery'):
        g=sub.add_parser(name, help=f'generate {name.removeprefix("to-")} output'); g.add_argument('file'); g.add_argument('--output')
    b=sub.add_parser('bom', help='extract a bill of materials'); b.add_argument('file'); b.add_argument('--format', choices=['markdown','csv','supplier-list'], default='markdown'); b.add_argument('--output')
    args=p.parse_args(argv)
    if args.version or args.cmd=='version': print(f'printspec {_version()}'); return 0
    if args.cmd is None: p.print_help(); return 1
    if args.cmd=='validate': return _validate(_load(args.file))
    if args.cmd=='to-openscad': return _generate(args, generate_openscad)
    if args.cmd=='to-cadquery': return _generate(args, generate_cadquery)
    if args.cmd=='bom': return _bom(args)
if __name__=='__main__': raise SystemExit(main())
