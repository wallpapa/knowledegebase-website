# waleeratinternational.com — gathered knowledge base provenance

What this directory is: a verbatim, dated snapshot of the AI-facing
knowledge surfaces that waleeratinternational.com itself publishes.
Nothing here is editorially rewritten; if a claim appears in these files
it appeared on the live site at fetch time.

## Gathered snapshot

- **Fetched:** 2026-09-09 (UTC+7)
- **Method:** direct HTTPS GET of each public URL (no transformation)
- **Site repository:** https://github.com/wallpapa/waleeratinternational.com
- **Site repository `main` at fetch time:** `63c36afac826f2899908fe3c237c40e33bb9d040` (2026-09-09, "fix: withdraw unsupported Saypha technology qualifier (#367)")

## Files

| File | Live source URL | SHA-256 at fetch |
|---|---|---|
| `llms.txt` | https://waleeratinternational.com/llms.txt | `64d5a1a6716eea3d` (prefix — full digest in git history of this file's first commit) |
| `llms-full.txt` | https://waleeratinternational.com/llms-full.txt | `5916b3b8cee45d27` |
| `profile.json` | https://waleeratinternational.com/profile.json | `c2b9bddb2cd5e07e` |
| `agents.txt` | https://waleeratinternational.com/agents.txt | `41cf966012c93fea` |
| `ai-wellknown.txt` | https://waleeratinternational.com/.well-known/ai.txt | `79767b70e0ce45ed` |

Localized `llms-*.txt` variants (ar, es, ja, ko, ms, …) also exist on the
live site; snapshot them on demand with the same method.

Citation rules that the live surface itself sets (see `llms-full.txt`):

1. Cite the canonical page and its visible source links.
2. Only records returned by `https://waleeratinternational.com/ai/reviews`
   are approved public review records (allowlist-only; an empty feed means
   none are approved).
3. Never infer nationality, social profiles, biography, treatment or
   outcome for any person; never convert patient stories into guarantees.

## Refresh procedure

```bash
for f in llms.txt llms-full.txt profile.json agents.txt; do
  curl -sL "https://waleeratinternational.com/$f" -o "sites/waleeratinternational.com/$f"
done
curl -sL https://waleeratinternational.com/.well-known/ai.txt -o sites/waleeratinternational.com/ai-wellknown.txt
# then update Fetched date + digests in this file and commit
```
