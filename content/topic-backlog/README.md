# Topic backlog — evidence-backed blog topics (EN + ZH) for the 3 websites

Candidate blog topics sourced from **real patient discourse** — Rednote search
observations (`glossary/evidence/xhs-*.json`, logged-in web session, 2026-09-09)
plus bounded Tavily discovery (`glossary/evidence/q01–q15`).

## What's here

- `topic-backlog-2026-09-09.json` — 12 candidate topics, each with:
  - `titleEn` / `titleZh` — angle in the exact register patients use
  - `sites` — which of waleeratclinic.com / waleeratinternational.com /
    verzoclinic.com it fits
  - `angle` — why this topic, tied to observed engagement (likes) and queries
  - `evidence` — the exact Rednote posts/chips that justify it
  - `medicalHigh` — topics whose copy must pass source-verified medical review
  - `status: candidate` — nothing here is publication-ready copy

## Rules of use

1. A topic becomes a page only through the target site repo's own workflow
   (brief → draft → translation gates → review). This backlog is INPUT, not
   publication authority.
2. zh titles use observed patient words (线雕, 热玛吉, 童颜针≠少女针, 瘦脸针,
   微晶瓷/瑞德喜, 乔雅露) — see `glossary/` for term evidence and the
   high-risk disambiguations (e.g. 逆龄针 no longer maps to Profhilo;
   婴儿针 is currently ambiguous with a skincare trend).
3. Engagement numbers are observed likes at capture time — directional
   evidence of demand, not a promise of performance.
4. The Bangkok-trust topic is grounded in a real 2026-09 news event and
   避雷 posts: write it as license-verification guidance, never as
   fear-marketing about competitors.

## Refresh

The recurring discovery automation appends new dated backlog files
(`topic-backlog-YYYY-MM-DD.json`) and per-term evidence
(`glossary/evidence/xhs-*.json`). Keep one file per discovery run; do not
overwrite past evidence.
