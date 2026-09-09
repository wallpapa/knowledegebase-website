#!/usr/bin/env node
// Deterministic generator: verified glossary -> machine-readable service alias map.
// This file is the consumption point for downstream consumers (Whisperchat
// alias registry, website i18n tooling). It contains ONLY terms whose
// reviewState passed verification — discovery-grade and conflicting terms are
// excluded by design and listed under `excluded` for transparency.
//
// Enforced by the content-quality gate: the machine file must carry the
// sha256 digest of the glossary it was generated from (sourceDigest); a stale
// machine file fails the gate, so every glossary change requires a regenerate.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const GLOSSARY_PATH = path.join(REPO, "glossary", "th-en-zh-patient-aesthetic-terms.json");
const OUT_PATH = path.join(REPO, "glossary", "service-aliases.machine.json");

const ALLOWED_STATES = new Set([
  "rednote-search-observed",
  "site-published-zh",
  "site-canonical",
  "site-keyword",
  "kb-observed-th",
]);

const SITE_TO_SCOPE = {
  "waleeratclinic.com": "WLR",
  "waleeratinternational.com": "WLR",
  "verzoclinic.com": "VRZ",
};

function build(glossaryJson = readFileSync(GLOSSARY_PATH, "utf8")) {
  const glossary = JSON.parse(glossaryJson);
  const families = [];

  for (const term of glossary.terms) {
    if (term.id === "thailand-medical-aesthetics-context") continue; // intent context, not a service
    const family = {
      id: term.id,
      canonicalEn: (term.en || []).map((e) => e.term)[0] || term.family,
      clinicScope: [...new Set((term.sites || []).map((s) => SITE_TO_SCOPE[s]).filter(Boolean))],
      th: [],
      en: [],
      zhHans: [],
      excluded: [],
    };

    function splitVariants(term) {
      return String(term).split(" / ").map((s) => s.trim()).filter(Boolean);
    }

    for (const e of term.th || []) {
      if (ALLOWED_STATES.has(e.reviewState)) family.th.push(...splitVariants(e.term));
      else family.excluded.push({ term: e.term, lang: "th", state: e.reviewState });
    }
    for (const e of term.en || []) {
      if (ALLOWED_STATES.has(e.reviewState)) family.en.push(...splitVariants(e.term));
      else family.excluded.push({ term: e.term, lang: "en", state: e.reviewState });
    }
    for (const e of term.zhHans || []) {
      if (ALLOWED_STATES.has(e.reviewState) && !(e.usageNote || "").includes("AMBIGUITY WARNING")) family.zhHans.push(...splitVariants(e.term));
      else family.excluded.push({ term: e.term, lang: "zhHans", state: e.reviewState, reason: (e.usageNote || "").includes("AMBIGUITY WARNING") ? "ambiguous-on-platform" : e.reviewState });
    }
    for (const s of term.subTerms || []) {
      if (ALLOWED_STATES.has(s.reviewState)) family.zhHans.push(...splitVariants(s.term));
      else family.excluded.push({ term: s.term, lang: "zhHans", state: s.reviewState });
    }

    family.zhHans = [...new Set(family.zhHans)];
    if (term.disambiguation) {
      family.dangerousConfusions = term.disambiguation
        .filter((d) => ALLOWED_STATES.has(d.reviewState) || d.reviewState === "conflicts-current-rednote-usage")
        .map((d) => ({ term: d.term, meaning: d.meaning }));
    }
    families.push(family);
  }

  return {
    schemaVersion: 1,
    aliasMapId: "service-aliases",
    generatedAt: new Date().toISOString().slice(0, 10),
    sourceGlossary: "glossary/th-en-zh-patient-aesthetic-terms.json",
    sourceDigest: createHash("sha256").update(glossaryJson).digest("hex"),
    evidenceRule: "Only reviewState in {rednote-search-observed, site-published-zh, site-canonical, site-keyword, kb-observed-th} is exported. Discovery-grade, unverified and conflicting terms stay in the glossary only.",
    consumers: [
      "Whisper repo scripts/sync-service-aliases-from-kb.mjs -> clinic_services.aliases (whisperchat.co/chat service matching)",
      "Website i18n tooling (see glossary README)",
    ],
    families,
  };
}

// CLI execution (import-safe for tests)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const out = build();
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const counts = out.families.reduce(
    (acc, f) => ({ th: acc.th + f.th.length, en: acc.en + f.en.length, zh: acc.zh + f.zhHans.length, excluded: acc.excluded + f.excluded.length }),
    { th: 0, en: 0, zh: 0, excluded: 0 },
  );
  console.log(`service-aliases.machine.json: ${out.families.length} families | th:${counts.th} en:${counts.en} zhHans:${counts.zh} | excluded (unverified): ${counts.excluded}`);
  console.log(`sourceDigest: ${out.sourceDigest.slice(0, 16)}…`);
}

export { build, GLOSSARY_PATH, OUT_PATH, ALLOWED_STATES };
