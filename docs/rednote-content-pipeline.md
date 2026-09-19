# RedNote → Central KB → 3-site content pipeline

Status: **planning and contract layer only**. This document does not authorize model execution, publication, medical approval or deployment.

## Purpose

Turn evidence-backed RedNote patient discourse into reusable bilingual knowledge packets that can later produce distinct editorial projections for:

- `waleeratclinic.com`
- `waleeratinternational.com`
- `verzoclinic.com`

The first masters are **Chinese intent** and **English evidence**. The remaining 13 locales are downstream projections only after the bilingual master has been reviewed.

## Data flow

```text
RedNote observation
  ↓
rednote-insight record
  ↓
normalize / deduplicate / classify on M2
  ↓
knowledge packet
  ├─ Chinese patient-intent master
  ├─ English evidence master
  ├─ claim/evidence graph
  ├─ site eligibility + editorial angle
  └─ localization targets
  ↓
site-specific ZH + EN candidates on M5
  ↓
semantic / medical-high review
  ↓
13 additional locale candidates
  ↓
site-repository gates and explicit release authority
```

## Contracts

### `schemas/rednote-insight.schema.json`

One append-only observation unit from RedNote. It records query wording, patient question shapes, terminology and bounded engagement observations. It must not contain patient identifiers or private messages.

Observed engagement is **directional demand evidence only**. It is not a prediction of traffic, ranking, enquiries or treatment demand.

### `schemas/knowledge-packet.schema.json`

The reusable cross-site content unit. It binds:

- RedNote insight references;
- evidence and exact source scope;
- claim IDs and risk tiers;
- Chinese patient-language intent;
- English evidence boundaries;
- site eligibility and editorial angles;
- ZH/EN masters and the 13 downstream target locales.

A knowledge packet never grants a website write. Every site route requires `publicWriteAllowed: false` in this central layer.

### `schemas/content-job-candidate.schema.json`

The result envelope for future local workers. Outputs are append-only candidates. The contract fixes:

- `sourceMutationAllowed: false`
- `publicWriteAllowed: false`
- `medicalApprovalGranted: false`

Model consensus cannot change those values.

## Job routing

`config/content-job-routing.json` is the shared routing contract.

M2 control-plane roles:

- normalize insight
- deduplicate insight
- classify intent

M5 compute-plane roles:

- Chinese intent synthesis
- English evidence synthesis
- site editorial drafting
- semantic review
- medical-high review
- localization drafting

The routing file is currently `mode: plan-only` and `executeModels: false`.

## Deterministic planning

A knowledge packet can be converted into a job graph without running any model:

```bash
npm run content:jobs:plan -- --packet path/to/packet.json
```

Write an immutable plan artifact:

```bash
npm run content:jobs:plan -- \
  --packet path/to/packet.json \
  --out outputs/content-jobs/<packet-id>.plan.json
```

The planner uses exclusive-create semantics for `--out`, so it will not silently overwrite an existing evidence artifact.

The plan includes:

- packet SHA-256 digest;
- M2/M5 assignment;
- dependencies between stages;
- eligible sites;
- ZH/EN master work;
- conditional medical-high review;
- downstream locale jobs.

It performs **zero Ollama calls** and **zero website writes**.

## Site adaptation rule

The three sites may answer the same patient intent differently, but factual claims must trace back to the same packet evidence.

Typical editorial emphasis:

- `waleeratclinic.com` — treatment authority, mechanism, program-specific depth;
- `waleeratinternational.com` — Chinese/international patient planning, Bangkok trust and travel context;
- `verzoclinic.com` — decision support, comparisons, direct questions before booking.

Do not copy one finished article three times. Reuse the knowledge packet, not the prose.

## Localization rule

Chinese is not treated as a literal translation of English. Chinese captures patient vocabulary and question framing observed in RedNote. English is the evidence-control master for source scope and claims.

Only after those two masters agree on entities, numbers, Program names, risk boundaries and evidence should the 13 additional locales be planned for drafting.

## Release boundary

Central KB output is research/candidate material. Publication authority remains in each website repository. Existing site-level controls continue to govern:

- prices and expiry;
- treatment/program identity;
- regulatory and medical claims;
- localization admission;
- citations;
- AEO/GEO/AI surfaces;
- final merge and deployment.

No local model, Codex, Claude Code, Z Code or future agent may infer publication approval from a successful job, build, benchmark or model vote.
