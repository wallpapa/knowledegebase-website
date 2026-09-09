# verzoclinic.com — gathered knowledge base provenance

What this directory is: a verbatim, dated snapshot of the AI-facing
knowledge surfaces that verzoclinic.com itself publishes, plus a copy of
the service evidence knowledge base maintained in the site repository.
Nothing here is editorially rewritten.

## Gathered snapshot

- **Fetched:** 2026-09-09 (UTC+7)
- **Method:** direct HTTPS GET of each public URL (no transformation)
- **Site repository:** https://github.com/wallpapa/verzoclinic.com
- **Site repository `main` at fetch time:** `d7c6768ded8014186891052d64d3cf19b45b588a` (2026-09-09, "fix: bind English Sculptra guide price to current VERZO bottle authority (#338)")

## Files

| File | Live source URL | SHA-256 at fetch |
|---|---|---|
| `ai.txt` | https://verzoclinic.com/ai.txt | `02cf4ee3df7e3e2f` (prefix — full digest in git history of this file's first commit) |
| `llms.txt` | https://verzoclinic.com/llms.txt | `9f5b73af12615984` |
| `llms-full.txt` | https://verzoclinic.com/llms-full.txt | `19e7ead558e85a1a` |
| `profile.json` | https://verzoclinic.com/profile.json | `5df296c50314f5ff` |

The live site also exposes a citation index at
`https://verzoclinic.com/api/clinic-info.json` and a sitemap at
`https://verzoclinic.com/sitemap.xml`.

## knowledgebase/ (service evidence runs)

Copied verbatim from `.data-migration/knowledgebase/` in the site
repository at the commit above. Structure:

- `services/<serviceKey>/current.json` — pointer to the latest evidence run
- `services/<serviceKey>/runs/<runId>/manifest.json` — run manifest with
  sha256-pinned artifacts (retrieval provider, request IDs, scope)
- `runs/<runId>/raw/research/` — bounded SERP research captures
  (queries + organic results only; no credentials, no patient data)
- `runs/<runId>/normalized/` — aliases, questions (intent-only review
  states), claims, demand, locale-personas, sources
- `runs/<runId>/reports/`, `runs/<runId>/review/` — release-state,
  selection and verification notes

Evidence boundary (from the run itself): third-party SERP research
established patient wording and question coverage only; it was **not**
used as medical-claim authority, and `claims.json` is empty by design.

## Refresh procedure

```bash
curl -sL https://verzoclinic.com/ai.txt       -o sites/verzoclinic.com/ai.txt
curl -sL https://verzoclinic.com/llms.txt     -o sites/verzoclinic.com/llms.txt
curl -sL https://verzoclinic.com/llms-full.txt -o sites/verzoclinic.com/llms-full.txt
curl -sL https://verzoclinic.com/profile.json -o sites/verzoclinic.com/profile.json
# knowledgebase/: git -C <site-repo> archive origin/main -- .data-migration/knowledgebase | tar -x
# then update Fetched date + digests in this file and commit
```
