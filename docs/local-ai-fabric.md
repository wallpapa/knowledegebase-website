# Local AI fabric: M2 control plane + M5 compute plane

Status: **integration scaffold only**. Nothing in this document grants publication, medical, compliance or deployment authority.

## Goal

Use the always-on MacBook Pro M2 (8 GB) as the control plane and the MacBook Pro M5 Pro (32 GB) as the heavier Ollama compute plane for the centralized clinic knowledge workflow shared by:

- `wallpapa/knowledegebase-website`
- `wallpapa/waleeratclinic.com`
- `wallpapa/waleeratinternational.com`
- `wallpapa/verzoclinic.com`

The first production use case is the Rednote insight pipeline: evidence-backed Chinese/English blog work, then reviewed localization and AEO/GEO/AI projections.

## Security boundary

Ollama stays loopback-only on both Macs. The M5 service is reached from M2 through an SSH tunnel over a private network such as Tailscale.

Do **not** bind Ollama to a public or LAN-wide interface for this workflow.

Expected local endpoints on M2:

- M2 Ollama: `http://127.0.0.1:11434`
- M5 Ollama through tunnel: `http://127.0.0.1:11435`

The shared contract is `config/local-ai-nodes.json`. Environment overrides are permitted only when they still resolve to loopback.

## One-time machine setup

### M5

1. Enable macOS Remote Login (SSH).
2. Ensure Ollama is running locally.
3. Verify:

```bash
curl http://127.0.0.1:11434/api/tags
```

### M2

Create the tunnel:

```bash
ssh -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 11435:127.0.0.1:11434 \
  <m5-user>@clinic-m5
```

Then verify the M5 endpoint from M2:

```bash
curl http://127.0.0.1:11435/api/tags
```

## Repository health check

From the centralized KB checkout on M2:

```bash
npm run ai:nodes:check
```

This reports both nodes independently and does not fail merely because an on-demand node is offline.

Require the M2 control plane:

```bash
npm run ai:nodes:check -- --require-m2
```

Require both nodes before a heavy generation/review batch:

```bash
npm run ai:nodes:check -- --require-all
```

Machine-readable output:

```bash
npm run ai:nodes:check -- --json
```

## Routing intent

### M2 control plane

Suitable work:

- repository and SSOT watching
- queue/state handling
- deterministic quality gates
- evidence deduplication
- embeddings and RAG
- lightweight classification
- health monitoring

The 8 GB M2 is not the shared large-model node.

### M5 compute plane

Suitable work:

- Chinese patient-intent synthesis
- English evidence synthesis
- article drafting
- independent semantic review
- difficult localization review
- high-nuance escalation

Model admission remains governed by benchmark evidence in the website repositories. This fabric config does not promote a model simply because it is installed.

## Publication boundary

All model outputs remain candidates/drafts until the target website repository's own gates and release rules pass. In particular:

- no worker may automatically mutate protected SSOT fields;
- no model may grant medical or compliance approval;
- no local worker may auto-publish;
- site-specific price, claim, route and content authority remain with the target site workflow.

## Next integration step

After both endpoints pass `ai:nodes:check`, add a bounded central job router that:

1. consumes a knowledge/topic packet from the centralized KB;
2. routes lightweight extraction/classification to M2;
3. routes Chinese/English synthesis or review to M5;
4. writes append-only candidate artifacts;
5. never edits website public content directly.
