# Glossary — Thai → English → Chinese patient terms (aesthetic clinic)

`th-en-zh-patient-aesthetic-terms.json` maps the treatment families that
waleeratclinic.com, waleeratinternational.com and verzoclinic.com actually
offer into:

- **Thai** — patient search terms (from site keywords and real Google
  People-Also-Ask phrases captured in the verzo evidence KB)
- **English** — each site's canonical program names
- **Simplified Chinese** — the words prospective Chinese-speaking patients
  really use (Rednote / Xiaohongshu register), so zh pages and content speak
  the patient's language instead of literal translation

## Status: partially Rednote-verified (2026-09-09)

Verification pass 1 ran on 2026-09-09: **16 terms searched inside rednote.com**
via the ZCode in-app browser (logged-in session — the owner's Chrome was never
touched, per owner instruction). Raw observations (post titles, authors, dates,
likes, related-query chips) live in `evidence/xhs-<term>.json`. Verified terms
carry `reviewState: rednote-search-observed`.

Two discovery-grade mappings were **overturned by observation**:

- **逆龄针 ≠ Profhilo** on current Rednote — the term now denotes
  longevity/gene-therapy injections. Keep the Latin brand "Profhilo" in zh copy.
- **婴儿针 is ambiguous** — the current surface is dominated by the NEUE
  *topical skincare* trend, not Rejuran injectables. Lead with 丽珠兰/Rejuran
  + 三文鱼 qualifiers.

Note-level verification (opening individual posts for body text and comments)
is still pending; before any zh term reaches publication copy it must still
pass the target site's i18n quality gates.

Earlier discovery material (15 Tavily searches, `evidence/q01–q15`) is kept
verbatim as the pre-verification baseline.

| State | Meaning |
|---|---|
| `rednote-search-observed` | Searched on rednote.com (logged-in); titles/likes/chips recorded in `evidence/xhs-*.json` |
| `conflicts-current-rednote-usage` | Observed usage contradicts the mapping — do not use in copy |
| `site-published-zh` / `site-canonical` / `site-keyword` | Already published by one of the sites (verifiable at the live URL) |
| `kb-observed-th` | Real Thai patient search phrase from the verzo evidence KB |
| `discovery-confirmed` / `discovery-single-source` | Tavily discovery grade; superseded by rednote observation where present |
| `unverified-colloquial` | No evidence captured; do not use in publication copy |

## High-risk disambiguations (read before translating anything)

- **童颜针 = Sculptra** (PLLA). **少女针 = Ellansé** (PCL) — a different
  product. Never label a Sculptra program 少女针.
- **超声刀 = Ultherapy** (US Ulthera). **超声炮 = Korean multi-point HIFU**
  (incl. Ultraformer). Patients treat them as different classes.
- **蜂巢皮秒 = PicoSure specifically**, not a generic pico term.
- **热玛吉 = Thermage**; **Oligio = 韩版热玛吉** ("Korean Thermage") — related
  framing, different device; keep the qualifier.
- **保妥适 = Botox brand (CN market name)**; 兰州衡力 is the China-domestic
  botulinum brand — disambiguation only.
- Juvelook's Chinese names (乔雅露 / 新童颜 / 素颜针) rest on Traditional-script
  Taiwan sources — weakest entries, Rednote pass required.

## Refreshing

1. Recurring discovery runs (see repo README automation section) append new
   `evidence/xhs-*.json` observations and dated topic-backlog files.
2. Note-level verification: open 2–3 top posts per term inside the in-app
   browser session, record body hashtags/comment language, then upgrade
   `reviewState` accordingly.
3. New treatment families: run bounded Tavily discovery first (save raw
   JSON to `evidence/qNN-*.json`), then the Rednote search pass.
4. Validate: `npm run content:quality-gate` (JSON validity is checked
   automatically for every file in the repo).

## File map

- `th-en-zh-patient-aesthetic-terms.json` — the glossary (schema v1)
- `evidence/q01…q15-*.json` — raw Tavily discovery results, verbatim
- `evidence/xhs-<term>.json` — Rednote search observations per term (verification pass 1, 2026-09-09)
