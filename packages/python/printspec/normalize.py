import copy

def _norm_supplier(s):
    x=str(s).lower().replace(' ','')
    return 'mcmaster' if x in ('mcmaster','mcmaster-carr') else str(s).lower()

def _walk(v):
    if isinstance(v, list): return [_walk(x) for x in v]
    if isinstance(v, dict):
        o={k:_walk(val) for k,val in v.items()}
        if 'diameter' in o and 'x' in o and 'y' in o:
            o.setdefault('axis','z'); o.setdefault('depth','through')
        if 'supplier' in o: o['supplier']=_norm_supplier(o['supplier'])
        return o
    return v

def normalize_printspec(spec):
    out=_walk(copy.deepcopy(spec)); out.setdefault('units','mm'); return out
