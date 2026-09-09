#!/usr/bin/env node
// Adversarial fixtures for the offline content-quality gate.
// Each case builds a synthetic repo in a temp dir, mutates one thing a
// sloppy release would get wrong, and asserts the gate catches it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, "../scripts/content-quality-gate.mjs");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function buildRepo(root, { domain = "example-clinic.com", readmeDomain = domain, sourcesOverrides = {} } = {}) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, "sites", domain), { recursive: true });
  writeFileSync(path.join(root, "README.md"), `# KB\nSee sites/${readmeDomain}/ index.\n`);
  writeFileSync(path.join(root, "LICENSE"), "CC-BY-4.0\n");
  writeFileSync(path.join(root, "CITATION.cff"), "cff-version: 1.2.0\n");

  const body = "# snapshot\nAnswer-first content.\n";
  writeFileSync(path.join(root, "sites", domain, "llms.txt"), body);

  const sources = [
    `# ${domain} provenance`,
    "",
    "- **Fetched:** 2026-09-09",
    "- **Site repository:** https://github.com/example/example",
    "",
    "| File | Live source URL | SHA-256 at fetch |",
    "|---|---|---|",
    `| \`llms.txt\` | https://${domain}/llms.txt | \`${sha256(body).slice(0, 16)}\` |`,
    ...Object.entries(sourcesOverrides).map(([k, v]) => `| \`${k}\` | url | \`${v}\` |`),
    "",
  ].join("\n");
  writeFileSync(path.join(root, "sites", domain, "SOURCES.md"), sources);
  return { body };
}

function runGate(root) {
  try {
    const stdout = execFileSync("node", [GATE, "--repo", root, "--mode=release"], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout + err.stderr };
  }
}

function freshDir(name) {
  return path.join(tmpdir(), `kb-gate-test-${name}-${process.pid}`);
}

test("valid synthetic repo passes the gate", () => {
  const root = freshDir("valid");
  buildRepo(root);
  const r = runGate(root);
  assert.equal(r.code, 0, `gate should pass, got:\n${r.stdout}`);
  assert.match(r.stdout, /CONTENT QUALITY PASS/);
});

test("tampered snapshot (digest mismatch) is blocked", () => {
  const root = freshDir("tampered");
  buildRepo(root);
  const f = path.join(root, "sites", "example-clinic.com", "llms.txt");
  writeFileSync(f, "# snapshot\nSILENTLY EDITED\n"); // not a verbatim mirror anymore
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /no longer matches its SOURCES\.md digest/);
});

test("declared digest for a missing file is blocked", () => {
  const root = freshDir("missing-file");
  buildRepo(root, { sourcesOverrides: { "gone.txt": "0123456789abcdef" } });
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /declares digest for missing file gone\.txt/);
});

test("broken JSON is blocked", () => {
  const root = freshDir("badjson");
  buildRepo(root);
  writeFileSync(path.join(root, "sites", "example-clinic.com", "profile.json"), "{not json");
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /invalid JSON: .*profile\.json/);
});

test("missing SOURCES.md is blocked", () => {
  const root = freshDir("nosources");
  buildRepo(root);
  rmSync(path.join(root, "sites", "example-clinic.com", "SOURCES.md"));
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /missing SOURCES\.md provenance record/);
});

test("undated SOURCES.md is blocked", () => {
  const root = freshDir("undated");
  buildRepo(root);
  const f = path.join(root, "sites", "example-clinic.com", "SOURCES.md");
  writeFileSync(f, readFileSync(f, "utf8").replace("**Fetched:** 2026-09-09", "Fetched: sometime"));
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /no dated "\*\*Fetched:\*\*" line/);
});

test("site directory not indexed in README is blocked", () => {
  const root = freshDir("unindexed");
  buildRepo(root, { domain: "not-in-readme.com", readmeDomain: "other-site.com" });
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /not linked from README\.md/);
});

test("knowledgebase manifest artifact tampering is blocked", () => {
  const root = freshDir("manifest");
  buildRepo(root);
  const runDir = path.join(root, "sites", "example-clinic.com", "knowledgebase", "services", "botox", "runs", "run1");
  mkdirSync(path.join(runDir, "raw"), { recursive: true });
  const artifact = "evidence";
  writeFileSync(path.join(runDir, "raw", "research.json"), artifact);
  writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, artifacts: [{ path: "raw/research.json", sha256: sha256(artifact) }] })
  );
  const serviceDir = path.dirname(runDir);
  writeFileSync(
    path.join(serviceDir, "current.json"),
    JSON.stringify({ manifest: "runs/run1/manifest.json", manifestSha256: sha256(JSON.stringify({ schemaVersion: 1, artifacts: [{ path: "raw/research.json", sha256: sha256(artifact) }] })) })
  );
  // Tamper with the artifact after pinning.
  writeFileSync(path.join(runDir, "raw", "research.json"), "evidence TAMPERED");
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /manifest digest mismatch/);
});

test("current.json pinning a stale manifest is blocked", () => {
  const root = freshDir("stalepin");
  buildRepo(root);
  const runDir = path.join(root, "sites", "example-clinic.com", "knowledgebase", "services", "botox", "runs", "run1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, artifacts: [] }));
  writeFileSync(
    path.join(path.dirname(runDir), "current.json"),
    JSON.stringify({ manifestSha256: sha256("not-the-manifest") })
  );
  const r = runGate(root);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /manifestSha256 does not pin the on-disk manifest/);
});

test("the real repository passes the gate", () => {
  const repo = path.resolve(HERE, "..");
  const r = runGate(repo);
  assert.equal(r.code, 0, `real repo should pass, got:\n${r.stdout}`);
});
