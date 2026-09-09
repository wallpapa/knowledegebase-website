#!/usr/bin/env node
// Adversarial tests for the service-alias machine map generator and its
// evidence filtering + digest-pinning rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build-service-aliases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function fixtureGlossary(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    status: "test",
    terms: [
      {
        id: "gadget-lift",
        family: "Gadget Lift",
        sites: ["waleeratclinic.com", "verzoclinic.com"],
        th: [{ term: "ร้อยไหม", reviewState: "site-keyword" }, { term: "ฉีดโบ", reviewState: "unverified-colloquial" }],
        en: [{ term: "Gadget Lift", reviewState: "site-canonical" }],
        zhHans: [
          { term: "线雕", reviewState: "rednote-search-observed" },
          { term: "埋线提升", reviewState: "discovery-confirmed" },
          { term: "黑话X", reviewState: "unverified-colloquial" },
          { term: "歧义词", reviewState: "rednote-search-observed", usageNote: "AMBIGUITY WARNING: dominated by an unrelated trend" },
          { term: "冲突词", reviewState: "conflicts-current-rednote-usage" },
        ],
        subTerms: [{ term: "大V线", meaning: "PLLA cog", reviewState: "rednote-search-observed" }],
        disambiguation: [{ term: "邻词", meaning: "different product", reviewState: "rednote-search-observed" }],
        ...overrides,
      },
      {
        id: "thailand-medical-aesthetics-context",
        family: "Context",
        sites: [],
        th: [], en: [{ term: "Context", reviewState: "site-canonical" }], zhHans: [],
      },
    ],
  });
}

test("verified states are exported; discovery/unverified/conflicting/ambiguous are excluded", () => {
  const out = build(fixtureGlossary());
  assert.equal(out.families.length, 1, "context family is skipped");
  const f = out.families[0];
  assert.deepEqual(f.zhHans, ["线雕", "大V线"]);
  assert.deepEqual(f.th, ["ร้อยไหม"]);
  assert.deepEqual(f.en, ["Gadget Lift"]);
  const excluded = f.excluded.map((e) => e.term);
  assert.ok(excluded.includes("埋线提升"));
  assert.ok(excluded.includes("黑话X"));
  assert.ok(excluded.includes("歧义词"));
  assert.ok(excluded.includes("冲突词"));
  assert.equal(f.excluded.find((e) => e.term === "歧义词").reason, "ambiguous-on-platform");
  assert.deepEqual(f.clinicScope, ["WLR", "VRZ"]);
  assert.deepEqual(f.dangerousConfusions, [{ term: "邻词", meaning: "different product" }]);
});

test("sourceDigest pins the exact glossary bytes", () => {
  const glossaryJson = fixtureGlossary();
  const out = build(glossaryJson);
  assert.equal(out.sourceDigest, sha256(glossaryJson));
});

test("a stale machine file fails the content gate", () => {
  const root = path.join(tmpdir(), `kb-alias-gate-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, "glossary"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# KB\nglossary\n");
  writeFileSync(path.join(root, "LICENSE"), "CC-BY-4.0\n");
  writeFileSync(path.join(root, "CITATION.cff"), "cff-version: 1.2.0\n");
  const glossaryJson = fixtureGlossary();
  writeFileSync(path.join(root, "glossary", "th-en-zh-patient-aesthetic-terms.json"), glossaryJson);
  const stale = build(glossaryJson);
  stale.sourceDigest = "0".repeat(64);
  writeFileSync(path.join(root, "glossary", "service-aliases.machine.json"), JSON.stringify(stale));
  let gate;
  try {
    gate = execFileSync("node", [
      path.resolve(HERE, "../scripts/content-quality-gate.mjs"),
      "--repo", root, "--mode=release",
    ], { encoding: "utf8" });
    gate = { code: 0, out: gate };
  } catch (err) {
    gate = { code: err.status, out: err.stdout + err.stderr };
  }
  assert.notEqual(gate.code, 0);
  assert.match(gate.out, /service-aliases\.machine\.json is stale/);
});

test("the real repository's machine file matches its glossary", async () => {
  const repo = path.resolve(HERE, "..");
  const machine = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(repo, "glossary", "service-aliases.machine.json"), "utf8"),
  );
  const glossaryJson = (await import("node:fs")).readFileSync(path.join(repo, "glossary", "th-en-zh-patient-aesthetic-terms.json"), "utf8");
  assert.equal(machine.sourceDigest, sha256(glossaryJson));
  for (const f of machine.families) {
    for (const zh of f.zhHans) assert.ok(zh.trim().length > 0, "no empty aliases");
  }
});
