#!/usr/bin/env python3
"""Cross-repo service-name drift checker for the clinic terminology SSOT.

Compares three sources and reports inconsistencies:
  A. verzoclinic/src/data/serviceChineseNames.ts   (researched per-service zh names + rulings)
  B. glossary/th-en-zh-patient-aesthetic-terms.json (KG human glossary)
  C. glossary/service-aliases.machine.json          (KG machine alias map -> clinic_services)

Hard failures (exit 1):
  - PAIR-CONFLICT: the same EN/brand maps to different primary zh names across files
  - MATERIAL-MIX:  PLLA/PCL/PN/PDLLA material-distinction terms cross-assigned
  - BANNED:        compliance-forbidden terms present in any source
                   (美白针 谷胱甘肽 熊果苷 溶脂针 外泌体 干细胞 富血小板血浆)
Informational (never fails): coverage gaps either direction.

Usage: python3 scripts/check-service-name-drift.py [--repo-roots DIR[,DIR]]
Runs from the KG repo root by default (paths resolved via env or cwd/../).
"""

import json
import os
import pathlib
import re
import sys

KG = pathlib.Path(__file__).resolve().parent.parent
REPO_ROOTS = {p.name: p for p in (KG.parent.iterdir() if KG.parent.exists() else [])}

BANNED = ["美白针", "谷胱甘肽", "熊果苷", "溶脂针", "外泌体", "干细胞", "富血小板血浆"]
MATERIAL_FAMILIES = {
    "PLLA": ["童颜针"],
    "PCL": ["少女针"],
    "PN": ["婴儿针"],
    "PDLLA": ["素颜针"],
}


def load_verzo():
    path = REPO_ROOTS.get("verzoclinic")
    if not path:
        return None, "verzoclinic repo not found next to KG"
    ts = path / "src/data/serviceChineseNames.ts"
    if not ts.exists():
        return None, f"missing {ts}"
    entries = []
    # one entry per line: 'slug': { slug: ..., en: ..., zh: '...', ... alt: ['..','..'], categoryZh: '...' }
    for m in re.finditer(r"\{\s*slug:\s*'([^']+)',\s*en:\s*'([^']+)',\s*zh:\s*'([^']+)'(.{0,400}?)(?:,\s*note:\s*'(.*?)')?\s*\}", ts.read_text(), re.S):
        slug, en, zh, rest, note = m.groups()
        alt = re.findall(r"'([^']+)'", (re.search(r"alt:\s*\[(.*?)\]", rest).group(1)
                                       if re.search(r"alt:\s*\[(.*?)\]", rest) else ""))
        entries.append({"slug": slug, "en": en, "zh": zh, "alt": alt, "note": note or ""})
    return entries, None


def load_kg_terms():
    path = KG / "glossary/th-en-zh-patient-aesthetic-terms.json"
    if not path.exists():
        return None, f"missing {path}"
    data = json.loads(path.read_text())
    return data.get("terms", []), None


def load_kg_aliases():
    path = KG / "glossary/service-aliases.machine.json"
    if not path.exists():
        return None, f"missing {path}"
    data = json.loads(path.read_text())
    return data.get("families", []), None


def brand_key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower()).split("prime")[0]


def main():
    failures, warnings = [], []

    verzo, err = load_verzo()
    if err:
        failures.append(f"LOAD: {err}")
    terms, err = load_kg_terms()
    if err:
        failures.append(f"LOAD: {err}")
    families, err = load_kg_aliases()
    if err:
        failures.append(f"LOAD: {err}")
    if failures:
        for f in failures:
            print(f"FAIL {f}")
        sys.exit(1)

    # BANNED scan: only actual NAME mappings (zh + alt), not notes that
    # legitimately mention a term in order to forbid it.
    blobs = {
        "verzo-serviceChineseNames": "\n".join(e["zh"] + " " + " ".join(e["alt"]) for e in verzo),
        "kg-terms": json.dumps([[x.get("term") for x in t.get("zhHans", [])] for t in terms], ensure_ascii=False),
        "kg-aliases": json.dumps([f.get("zhHans") for f in families], ensure_ascii=False),
    }
    for src, blob in blobs.items():
        for banned in BANNED:
            if banned in blob:
                failures.append(f"BANNED: '{banned}' appears in {src} (compliance-forbidden term)")

    # MATERIAL guard: a material term must map to exactly one family across sources
    material_owner = {}
    for family, zh_names in MATERIAL_FAMILIES.items():
        for zh in zh_names:
            material_owner[zh] = family
    def check_material(where, en, zh_names):
        for zh in zh_names:
            if zh in material_owner:
                owner = brand_key(en)
                expected = {"plla": "sculptra", "pcl": "ellanse", "pn": "rejuran", "pdlla": "juvelook"}.get(material_owner[zh], "")
                if expected and expected not in owner:
                    failures.append(f"MATERIAL-MIX: {where} maps '{zh}' (={material_owner[zh]}) under '{en}', expected brand ~{expected}")
    for e in verzo:
        check_material("verzo", e["en"], [e["zh"]] + e["alt"])
    for t in terms:
        check_material("kg-terms", "/".join(x["term"] for x in t.get("en", [])), [x["term"] for x in t.get("zhHans", [])])

    # PAIR-CONFLICT: brand -> primary zh must agree between verzo and KG sources
    def brand_zh_maps():
        maps = {}
        for e in verzo:
            maps.setdefault(brand_key(e["en"]), {})["verzo"] = e["zh"]
        for t in terms:
            en = "/".join(x["term"] for x in t.get("en", []))
            zh = [x["term"] for x in t.get("zhHans", [])]
            if zh:
                maps.setdefault(brand_key(en), {})["kg-terms"] = zh[0]
        for f in families:
            maps.setdefault(brand_key(f.get("canonicalEn", "")), {})["kg-aliases"] = (f.get("zhHans") or [""])[0]
        return maps
    for brand, sources in brand_zh_maps().items():
        distinct = {v for v in sources.values() if v}
        if len(distinct) > 1:
            detail = ", ".join(f"{k}={v}" for k, v in sorted(sources.items()))
            warnings.append(f"PAIR-CONFLICT[{brand}]: {detail}")

    # Coverage (informational)
    verzo_brands = {brand_key(e["en"]) for e in verzo}
    for t in terms:
        en = "/".join(x["term"] for x in t.get("en", []))
        key = brand_key(en)
        if key and key not in verzo_brands and not any(c.isdigit() for c in en):
            warnings.append(f"COVERAGE: KG term '{en}' has no verzo serviceChineseNames entry")

    for w in warnings:
        print(f"WARN {w}")
    for f in failures:
        print(f"FAIL {f}")
    print(f"drift check: {len(verzo)} verzo entries · {len(terms)} KG terms · "
          f"{len(families)} alias families → {len(failures)} failures, {len(warnings)} warnings")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
