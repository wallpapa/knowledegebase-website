# Clinic Knowledge Base — Single Source of Truth (SSOT)

This repository is the centralized, machine-readable knowledge base for the clinic website ecosystem. It collects shared evidence, patient terminology, topic intelligence and AI-facing snapshots while preserving site-specific publication authority.

## Covered websites

- `waleeratclinic.com`
- `waleeratinternational.com`
- `verzoclinic.com`

## Cross-site resources

- `glossary/` — Thai → English → Chinese patient terminology with per-term evidence states, including Rednote-observed Chinese usage.
- `content/topic-backlog/` — evidence-backed candidate blog topics sourced from real patient discourse and bounded research.
- `sites/` — site-scoped snapshots and knowledge surfaces. Keep claims, prices and evidence separated by site unless an explicit cross-site contract says otherwise.
- `config/local-ai-nodes.json` — shared M2/M5 local-AI execution contract.
- `docs/local-ai-fabric.md` — setup and operating boundary for the two-node local AI fabric.

## Local AI fabric

The current local setup is designed around:

- `clinic-m2` — always-on M2 control plane (8 GB): Git/KB watch, queueing, deterministic checks, light local work.
- `clinic-m5` — M5 Pro compute plane (32 GB): heavier Ollama generation, bilingual synthesis, semantic review and escalation.

From the Central KB checkout on `clinic-m2`, run the full connectivity diagnostic with one command:

```bash
npm run ai:fabric:doctor
```

This checks Tailscale, SSH, M2 Ollama, M5 Ollama over SSH, and the M2→M5 Ollama tunnel. See `docs/local-ai-fabric.md` for setup, environment overrides and safety boundaries.

## Publication boundary

This repository is a canonical collection/retrieval layer, not a universal auto-publisher. A knowledge item becomes public only through the target website repository's own content, medical, compliance, translation and release gates. Machine output must not be treated as medical or compliance approval.

## Quality commands

```bash
npm test
npm run content:quality-gate
npm run code:quality-gate
npm run build:aliases
npm run ai:nodes:check
npm run ai:fabric:doctor
```

## First operational use case

The first shared workflow is:

```text
Rednote patient insight
  -> centralized evidence/topic packet
  -> Chinese intent master + English evidence master
  -> site-specific Waleerat / Waleerat International / VERZO article projections
  -> reviewed AEO/GEO/AI surfaces
  -> later localization to additional languages
```

The Central KB provides evidence and routing context; each site retains its own release authority.
