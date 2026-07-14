BAD = [
    "weapon",
    "firearm",
    "ammunition",
    "explosive",
    "suppressor",
    "silencer",
    "lockpick",
    "bypass",
    "implant",
    "pressure vessel",
    "flight-critical",
    "high-voltage",
]


def is_potentially_unsafe_label(text):
    return any(w in text.lower() for w in BAD)


def has_disallowed_supplier_role(text):
    return is_potentially_unsafe_label(text)


def validate_safe_metadata(spec):
    text = (
        str(spec.get("metadata", {}))
        + " "
        + str((spec.get("part") or spec.get("project") or {}).get("label", ""))
    )
    return {
        "valid": not is_potentially_unsafe_label(text),
        "errors": []
        if not is_potentially_unsafe_label(text)
        else ["Metadata or label may describe a disallowed/safety-critical use."],
    }
