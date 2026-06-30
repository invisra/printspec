def extract_bom(spec):
    out=[]
    out.extend(spec.get('hardware') or [])
    if spec.get('part'): out.extend(spec['part'].get('hardware') or [])
    if spec.get('project'): out.extend(spec['project'].get('hardware') or [])
    for i in out: i['quantity']=max(1,int(i.get('quantity') or 1))
    return out
def bom_to_markdown(bom):
    rows=['| ID | Kind | Size | Qty | Supplier | Part Number |','| --- | --- | --- | ---: | --- | --- |']
    for i in bom:
        r=(i.get('supplierReferences') or [{}])[0]
        rows.append(f"| {i.get('id','')} | {i.get('kind','')} | {i.get('size','')} | {i.get('quantity','')} | {r.get('supplier','')} | {r.get('partNumber','')} |")
    return '\n'.join(rows)
def _csv(v): return '"'+str(v).replace('"','""')+'"'
def bom_to_csv(bom):
    rows=['id,kind,standard,size,quantity,role,supplier,partNumber,url']
    for i in bom:
        r=(i.get('supplierReferences') or [{}])[0]
        rows.append(','.join(_csv(x) for x in [i.get('id',''),i.get('kind',''),i.get('standard',''),i.get('size',''),i.get('quantity',''),i.get('role',''),r.get('supplier',''),r.get('partNumber',''),r.get('url','')]))
    return '\n'.join(rows)
def bom_to_supplier_order_list(bom):
    lines=[]
    for i in bom:
        for r in i.get('supplierReferences') or []: lines.append(f"{r.get('supplier')}: {r.get('partNumber')} x {i.get('quantity')}{' ('+r.get('url')+')' if r.get('url') else ''}")
    return '\n'.join(lines)
