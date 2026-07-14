def _supplier(s):
    x = str(s or "").lower().replace(" ", "")
    return "mcmaster" if x in ("mcmaster", "mcmaster-carr") else str(s or "").lower()


def _norm(i, m=1):
    o = {**i, "quantity": max(1, int(i.get("quantity") or 1) * m)}
    o["supplierReferences"] = [
        {**r, "supplier": _supplier(r.get("supplier"))} for r in i.get("supplierReferences") or []
    ]
    return o


def _collect(spec, m=1, out=None):
    out = [] if out is None else out
    for h in spec.get("hardware") or []:
        out.append(_norm(h, m))
    if spec.get("part"):
        for h in spec["part"].get("hardware") or []:
            out.append(_norm(h, m))
    if spec.get("project"):
        for h in spec["project"].get("hardware") or []:
            out.append(_norm(h, m))
        for p in spec["project"].get("parts") or []:
            if p.get("spec"):
                _collect(p["spec"], m * p.get("quantity", 1), out)
    return out


def _key(i):
    r = (i.get("supplierReferences") or [{}])[0]
    return (
        i.get("kind"),
        i.get("standard", ""),
        i.get("size", ""),
        r.get("supplier", ""),
        r.get("partNumber", ""),
        i.get("role", ""),
    )


def extract_bom(spec):
    merged = {}
    for i in _collect(spec):
        k = _key(i)
        if k in merged:
            merged[k]["quantity"] += i["quantity"]
        else:
            merged[k] = dict(i)
    return list(merged.values())


def bom_to_markdown(bom):
    return "\n".join(
        [
            "| ID | Kind | Size | Qty | Supplier | Part Number |",
            "| --- | --- | --- | ---: | --- | --- |",
        ]
        + [
            f"| {i.get('id')} | {i.get('kind')} | {i.get('size', '')} | {i.get('quantity')} | {(i.get('supplierReferences') or [{}])[0].get('supplier', '')} | {(i.get('supplierReferences') or [{}])[0].get('partNumber', '')} |"
            for i in bom
        ]
    )


def _csv(v):
    s = str(v or "")
    return '"' + s.replace('"', '""') + '"' if any(c in s for c in ',"\n') else s


def bom_to_csv(bom):
    rows = ["id,kind,standard,size,quantity,role,supplier,partNumber,url,description"]
    for i in bom:
        r = (i.get("supplierReferences") or [{}])[0]
        rows.append(
            ",".join(
                _csv(x)
                for x in [
                    i.get("id"),
                    i.get("kind"),
                    i.get("standard", ""),
                    i.get("size", ""),
                    i.get("quantity"),
                    i.get("role", ""),
                    r.get("supplier", ""),
                    r.get("partNumber", ""),
                    r.get("url", ""),
                    r.get("description", ""),
                ]
            )
        )
    return "\n".join(rows)


def bom_to_supplier_order_list(bom):
    by = {}
    for i in bom:
        for r in i.get("supplierReferences") or []:
            by.setdefault(_supplier(r.get("supplier")), []).append(
                f"{r.get('partNumber')} x {i.get('quantity')}"
                + (f" ({r.get('url')})" if r.get("url") else "")
            )
    return "\n\n".join(
        s + "\n" + "\n".join("- " + line for line in lines) for s, lines in by.items()
    )
