#!/usr/bin/env node
// Offline, deterministic content-quality gate for the knowledge base SSOT.
// No network, no model calls: every check is reproducible from the tree.
//
// Checks:
//   1. Root documents exist (README.md, LICENSE, CITATION.cff).
//   2. Every directory under sites/ has a SOURCES.md with a dated
//      "Fetched:" line and a github.com site-repository URL.
//   3. Every *.json in the repo parses.
//   4. Digest table in SOURCES.md: declared hex prefixes must match the
//      current sha256 of the named sibling file (verbatim-mirror proof).
//   5. knowledgebase/ evidence runs: every manifest artifact sha256 and
//      current.json manifestSha256 pin must match the files on disk.
//   6. README.md links each sites/<domain>/ directory (SSOT index proof).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { repo: process.cwd(), mode: "audit" };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split("=");
    if (key === "--repo") args.repo = inlineValue ?? argv[++i];
    else if (key === "--mode") args.mode = inlineValue ?? argv[++i];
  }
  return args;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules") continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function checkRepo(repo) {
  const failures = [];
  const rootDocs = ["README.md", "LICENSE", "CITATION.cff"];
  for (const doc of rootDocs) {
    if (!existsSync(path.join(repo, doc))) failures.push(`missing root document: ${doc}`);
  }

  const sitesDir = path.join(repo, "sites");
  if (!existsSync(sitesDir)) {
    failures.push("missing sites/ directory");
    return failures;
  }
  const domains = readdirSync(sitesDir).filter((d) => statSync(path.join(sitesDir, d)).isDirectory());
  if (domains.length === 0) failures.push("sites/ contains no site directories");

  const files = walk(repo);
  for (const f of files) {
    if (f.endsWith(".json")) {
      try {
        JSON.parse(readFileSync(f, "utf8"));
      } catch (err) {
        failures.push(`invalid JSON: ${path.relative(repo, f)} (${err.message})`);
      }
    }
  }

  const readme = existsSync(path.join(repo, "README.md"))
    ? readFileSync(path.join(repo, "README.md"), "utf8")
    : "";

  for (const domain of domains) {
    const siteDir = path.join(sitesDir, domain);
    const sourcesPath = path.join(siteDir, "SOURCES.md");
    if (!existsSync(sourcesPath)) {
      failures.push(`${domain}: missing SOURCES.md provenance record`);
      continue;
    }
    const sources = readFileSync(sourcesPath, "utf8");

    if (!/\*\*Fetched:\*\*\s*\d{4}-\d{2}-\d{2}/.test(sources)) {
      failures.push(`${domain}: SOURCES.md has no dated "**Fetched:**" line`);
    }
    if (!/github\.com\//.test(sources)) {
      failures.push(`${domain}: SOURCES.md does not name a github.com site repository`);
    }
    if (!readme.includes(`sites/${domain}`)) {
      failures.push(`${domain}: not linked from README.md`);
    }

    // Digest table: | `file` | url | `hex16+` ... | — prefix must match file on disk.
    for (const line of sources.split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 4) continue;
      const nameCell = cells[1].replace(/`/g, "").trim();
      const hex = (cells[3].match(/[0-9a-f]{16,64}/) || [])[0];
      if (!hex) continue; // rows without a digest (e.g. authored records) are exempt
      const target = path.join(siteDir, nameCell);
      if (!existsSync(target)) {
        failures.push(`${domain}: SOURCES.md declares digest for missing file ${nameCell}`);
      } else if (!sha256(target).startsWith(hex)) {
        failures.push(`${domain}: ${nameCell} no longer matches its SOURCES.md digest (not a verbatim mirror)`);
      }
    }

    // Evidence-run pinning: manifest artifact digests + current.json manifest pin.
    const kbRoot = path.join(siteDir, "knowledgebase");
    if (existsSync(kbRoot)) {
      for (const f of walk(kbRoot)) {
        const rel = path.relative(kbRoot, f);
        if (rel.endsWith("manifest.json")) {
          const runDir = path.dirname(f);
          let manifest;
          try {
            manifest = JSON.parse(readFileSync(f, "utf8"));
          } catch {
            continue; // already reported by JSON parse check
          }
          for (const artifact of manifest.artifacts || []) {
            const ap = path.join(runDir, artifact.path);
            if (!existsSync(ap)) {
              failures.push(`${domain}: manifest artifact missing: ${path.relative(repo, ap)}`);
            } else if (sha256(ap) !== artifact.sha256) {
              failures.push(`${domain}: manifest digest mismatch: ${path.relative(repo, ap)}`);
            }
          }
          const serviceDir = path.dirname(runDir);
          const currentPath = path.join(serviceDir, "current.json");
          if (existsSync(currentPath)) {
            const current = JSON.parse(readFileSync(currentPath, "utf8"));
            if (current.manifestSha256 && current.manifestSha256 !== sha256(f)) {
              failures.push(`${domain}: current.json manifestSha256 does not pin the on-disk manifest (${path.relative(repo, currentPath)})`);
            }
          }
        }
      }
    }
  }
  return failures;
}

const { repo, mode } = parseArgs(process.argv);
const failures = checkRepo(repo);
if (failures.length > 0) {
  console.error(`CONTENT QUALITY BLOCK (${mode}): ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`CONTENT QUALITY PASS (${mode}): structure, provenance dates, digest pins, manifest pins, JSON validity, README index — all verified offline`);
