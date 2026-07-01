import argparse, json, sys
from pathlib import Path
from .validate import validate_printspec
from .generators import generate_openscad, generate_cadquery
from .bom import extract_bom, bom_to_markdown, bom_to_csv, bom_to_supplier_order_list

def _load(path):
    try: return json.loads(Path(path).read_text(encoding='utf8'))
    except Exception as e: raise SystemExit(f'error: unable to read JSON: {e}')
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
def main(argv=None):
    p=argparse.ArgumentParser(prog='printspec')
    sub=p.add_subparsers(dest='cmd', required=True)
    v=sub.add_parser('validate'); v.add_argument('file')
    for name in ('to-openscad','to-cadquery'):
        g=sub.add_parser(name); g.add_argument('file'); g.add_argument('--output')
    b=sub.add_parser('bom'); b.add_argument('file'); b.add_argument('--format', choices=['markdown','csv','supplier-list'], default='markdown'); b.add_argument('--output')
    args=p.parse_args(argv)
    if args.cmd=='validate': return _validate(_load(args.file))
    if args.cmd=='to-openscad': return _generate(args, generate_openscad)
    if args.cmd=='to-cadquery': return _generate(args, generate_cadquery)
    if args.cmd=='bom': return _bom(args)
if __name__=='__main__': raise SystemExit(main())
