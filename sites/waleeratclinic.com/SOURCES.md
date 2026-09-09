# waleeratclinic.com — gathered knowledge base provenance

What this directory is: a verbatim, dated snapshot of the AI-facing
knowledge surfaces that waleeratclinic.com itself publishes, plus the
verified clinic identity record. Nothing here is editorially rewritten;
if a claim appears in these files it appeared on the live site at fetch
time. Attribution and citation should point at the live canonical URLs
below, not at this snapshot.

## Gathered snapshot

- **Fetched:** 2026-09-09 (UTC+7)
- **Method:** direct HTTPS GET of each public URL (no transformation)
- **Site repository:** https://github.com/wallpapa/waleeratclinic.com
- **Site repository `main` at fetch time:** `609bbffdc48b865fd9d4167d34423e58db45907f` (2026-09-09, "fix(i18n): complete Thai TheraFill patient content (#46)")

## Files

| File | Live source URL | SHA-256 at fetch |
|---|---|---|
| `llms.txt` | https://waleeratclinic.com/llms.txt | `7e805a95c962250d` (prefix — full digest in git history of this file's first commit) |
| `profile.json` | https://waleeratclinic.com/profile.json | `1903b33244a36d2f` |
| `sitemap-md.txt` | https://waleeratclinic.com/sitemap-md.txt | `1cb0ffba980bfed2` |
| `clinic.json` | authored record originally released in this repository; verified against the live site and Thai Medical Council registry (see its `lastUpdated`) | — |

The live site also exposes a read-only MCP server (`https://waleeratclinic.com/api/mcp`,
discovery at `/.well-known/mcp.json`, tools: `clinic_info`, `list_programs`,
`list_pages`) — intentionally not snapshotted here because it is an
endpoint, not a document. Query it directly when live data is needed.

## Refresh procedure

```bash
curl -sL https://waleeratclinic.com/llms.txt      -o sites/waleeratclinic.com/llms.txt
curl -sL https://waleeratclinic.com/profile.json  -o sites/waleeratclinic.com/profile.json
curl -sL https://waleeratclinic.com/sitemap-md.txt -o sites/waleeratclinic.com/sitemap-md.txt
# then update Fetched date + digests in this file and commit
```
