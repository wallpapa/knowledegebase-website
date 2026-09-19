#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, validatePacket } from "../scripts/plan-content-jobs.mjs";

const routing = {
  schemaVersion: 1,
  workflowId: "test-content-factory",
  execution: {
    mode: "plan-only",
    executeModels: false,
    automaticPublication: false,
    sourceMutationAllowed: false,
  },
  roles: {
    "normalize-insight": { node: "m2", class: "lightweight", requiresFabricReady: false },
    "deduplicate-insight": { node: "m2", class: "lightweight", requiresFabricReady: false },
    "classify-intent": { node: "m2", class: "lightweight", requiresFabricReady: false },
    "zh-intent-synthesis": { node: "m5", class: "generation", requiresFabricReady: true },
    "en-evidence-synthesis": { node: "m5", class: "generation", requiresFabricReady: true },
    "site-editorial-draft": { node: "m5", class: "generation", requiresFabricReady: true },
    "semantic-review": { node: "m5", class: "review", requiresFabricReady: true },
    "medical-high-review": { node: "m5", class: "review", requiresFabricReady: true, automaticRelease: false },
    "localization-draft": { node: "m5", class: "generation", requiresFabricReady: true },
  },
  stageOrder: [
    "normalize-insight",
    "deduplicate-insight",
    "classify-intent",
    "zh-intent-synthesis",
    "en-evidence-synthesis",
    "site-editorial-draft",
    "semantic-review",
    "medical-high-review",
    "localization-draft",
  ],
  masterLocales: ["zh", "en"],
  targetLocales: ["th", "zh-hant", "ja", "ko", "es", "de", "fr", "pt", "ar", "ms", "ru", "id", "tl"],
};

function packet({ medicalHigh = true, eligible = ["waleeratclinic.com", "waleeratinternational.com", "verzoclinic.com"] } = {}) {
  const sites = ["waleeratclinic.com", "waleeratinternational.com", "verzoclinic.com"];
  return {
    schemaVersion: 1,
    packetId: "thread-lift-longevity-20260909",
    createdAt: "2026-09-09T10:00:00Z",
    topic: {
      id: "thread-lift-longevity-honest",
      titleZh: "线雕能维持多久？",
      titleEn: "How long does a thread lift last?",
      medicalHigh,
    },
    sourceInsightRefs: ["glossary/evidence/xhs-线雕.json"],
    evidence: [],
    claims: [],
    bilingualMaster: {
      zhIntent: { patientQuestions: [], terms: [], concerns: [] },
      enEvidence: { answerFrame: [], claimRefs: [], sourceBoundaries: [] },
    },
    siteRouting: Object.fromEntries(sites.map((site) => [site, {
      eligible: eligible.includes(site),
      editorialAngle: eligible.includes(site) ? "bounded test angle" : null,
      publicWriteAllowed: false,
    }])),
    localization: {
      masterLocales: ["zh", "en"],
      targetLocales: routing.targetLocales,
      automaticPublication: false,
    },
    status: "candidate",
  };
}

test("planner routes lightweight work to M2 and all generation/review to M5", () => {
  const plan = buildPlan(packet(), routing);
  const m2Jobs = plan.jobs.filter((job) => job.node === "m2");
  const m5Jobs = plan.jobs.filter((job) => job.node === "m5");

  assert.deepEqual(m2Jobs.map((job) => job.role), [
    "normalize-insight",
    "deduplicate-insight",
    "classify-intent",
  ]);
  assert.equal(m5Jobs.length, 98);
  assert.equal(plan.jobs.length, 101);
  assert.equal(plan.executeModels, false);
  assert.equal(plan.automaticPublication, false);
  for (const job of plan.jobs) assert.equal(job.publicWriteAllowed, false);
});

test("medical-high review is only planned for medical-high topics", () => {
  const high = buildPlan(packet({ medicalHigh: true }), routing);
  const low = buildPlan(packet({ medicalHigh: false }), routing);
  assert.equal(high.jobs.filter((job) => job.role === "medical-high-review").length, 6);
  assert.equal(low.jobs.filter((job) => job.role === "medical-high-review").length, 0);
});

test("only eligible sites receive editorial and localization jobs", () => {
  const plan = buildPlan(packet({ eligible: ["verzoclinic.com"] }), routing);
  const siteJobs = plan.jobs.filter((job) => job.site);
  assert.deepEqual([...new Set(siteJobs.map((job) => job.site))], ["verzoclinic.com"]);
  assert.equal(plan.eligibleSites.length, 1);
});

test("packet validation rejects any attempt to authorize a public write", () => {
  const unsafe = packet();
  unsafe.siteRouting["waleeratclinic.com"].publicWriteAllowed = true;
  assert.throws(() => validatePacket(unsafe), /publicWriteAllowed must remain false/);
});

test("packet validation rejects automatic publication", () => {
  const unsafe = packet();
  unsafe.localization.automaticPublication = true;
  assert.throws(() => validatePacket(unsafe), /automaticPublication must remain false/);
});
