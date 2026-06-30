import copy
def normalize_printspec(spec):
    out=copy.deepcopy(spec); out.setdefault('units','mm'); return out
