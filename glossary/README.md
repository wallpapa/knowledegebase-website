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

## Status: discovery draft — NOT publication authority

Created 2026-09-09 from **15 bounded Tavily web searches** (raw JSON kept
verbatim in [`evidence/`](./evidence/), q01–q15) plus the repo's site
snapshots. The owner-requested verification pass **inside logged-in Rednote**
(rednote.com, via the user's Chrome) is **pending** — macOS Accessibility /
Screen Recording has not yet been granted to ZCode Computer Use.app, so the
browser could not be driven.

Every term carries a `reviewState`:

| State | Meaning |
|---|---|
| `site-published-zh` / `site-canonical` / `site-keyword` | Already published by one of the sites (verifiable at the live URL) |
| `kb-observed-th` | Real Thai patient search phrase from the verzo evidence KB |
| `discovery-confirmed` | ≥2 independent discovery sources agree — still needs the Rednote pass |
| `discovery-single-source` | One source only; hypothesis |
| `unverified-colloquial` | No evidence captured; do not use in publication copy |

Until the Rednote pass records in-app observations (post titles, frequencies,
zh-Hans vs zh-Hant variants), **do not treat any Chinese entry here as
release-ready website copy** — it is translation *input*, not publication
output. Site translation batches continue to run through each site repo's own
workflow (`verzo-local-translation`, i18n quality gates, approval states).

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

1. Run the Rednote verification pass (requires the owner to grant macOS
   Accessibility + Screen Recording to **ZCode Computer Use.app** in System
   Settings → Privacy & Security, then fully quit and reopen ZCode):
   for each `zhHans` term, search inside the logged-in rednote.com tab,
   record post titles/URLs/frequency, note zh-Hant variants, then upgrade
   `reviewState` per term and update this README's status line.
2. New treatment families: run bounded Tavily discovery first (save raw
   JSON to `evidence/qNN-*.json`), then add the entry with honest states.
3. Validate: `npm run content:quality-gate` (JSON validity is checked
   automatically for every file in the repo).

## File map

- `th-en-zh-patient-aesthetic-terms.json` — the glossary (schema v1)
- `evidence/q01…q15-*.json` — raw Tavily discovery results, verbatim
