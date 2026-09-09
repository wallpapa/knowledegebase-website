#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  executeContentJobs,
  preflightFabric,
  validateModelRouting,
} from "../scripts/run-content-jobs.mjs";

const M2_MODELS = ["gemma3:4b"];
const M5_MODELS = ["qwen3.5:9b"];

const routing = {
  schemaVersion: 1,
  workflowId: "test-content-factory",
  execution: { mode: "plan-only", executeModels: false, automaticPublication: false, sourceMutationAllowed: false },
  roles: {
    "normalize-insight": { node: "m2", class: "lightweight", requiresFabricReady: false },
    "deduplicate-insight": { node: "m2", class: "lightweight", requiresFabricReady: false },
    "classify-intent": { node: "m2", class: "lightweight", requiresFabricReady: false },
    "zh-intent-synthesis": { node: "m5", class: "generation", requiresFabricReady: true },
    "en-evidence-synthesis": { node: "m5", class: "generation", requiresFabricReady: true },
  },
  stageOrder: [
    "normalize-insight",
    "deduplicate-insight",
    "classify-intent",
    "zh-intent-synthesis",
    "en-evidence-synthesis",
  ],
  masterLocales: ["zh", "en"],
  targetLocales: ["th", "ja"],
};

function modelRouting(overrides = {}) {
  return {
    schemaVersion: 1,
    fabricId: "clinic-local-ai-fabric-v1",
    execution: {
      mode: "bounded-zh-en-only",
      automaticPublication: false,
      publicWriteAllowed: false,
      sourceMutationAllowed: false,
      outputMode: "append-only-candidate",
      candidateDirectory: "outputs/content-jobs",
    },
    allowedRoles: {
      "normalize-insight": { node: "m2", model: "gemma3:4b" },
      "deduplicate-insight": { node: "m2", model: "gemma3:4b" },
      "classify-intent": { node: "m2", model: "gemma3:4b" },
      "zh-intent-synthesis": { node: "m5", model: "qwen3.5:9b" },
      "en-evidence-synthesis": { node: "m5", model: "qwen3.5:9b" },
    },
    nodes: {
      m2: { ollamaEndpoint: "http://127.0.0.1:11434", endpointEnv: "OLLAMA_M2_URL" },
      m5: { ollamaEndpoint: "http://127.0.0.1:11435", endpointEnv: "OLLAMA_M5_URL" },
    },
    blockedModels: [
      { model: "qwen3.8:27b-mlx", reason: "test" },
      { model: "qwen2.5:14b", reason: "test" },
    ],
    ...overrides,
  };
}

function packet() {
  const sites = ["waleeratclinic.com", "waleeratinternational.com", "verzoclinic.com"];
  return {
    schemaVersion: 1,
    packetId: "thread-lift-longevity-20260909",
    topic: {
      id: "thread-lift-longevity-honest",
      titleZh: "线雕能维持多久？",
      titleEn: "How long does a thread lift last?",
      medicalHigh: true,
    },
    sourceInsightRefs: ["glossary/evidence/xhs-线雕.json"],
    evidence: [],
    claims: [],
    bilingualMaster: {
      zhIntent: { patientQuestions: [], terms: [], concerns: [] },
      enEvidence: { answerFrame: [], claimRefs: [], sourceBoundaries: [] },
    },
    siteRouting: Object.fromEntries(sites.map((site) => [site, {
      eligible: false,
      editorialAngle: null,
      publicWriteAllowed: false,
    }])),
    localization: {
      masterLocales: ["zh", "en"],
      targetLocales: ["th", "ja"],
      automaticPublication: false,
    },
    status: "candidate",
  };
}

function fakeOllama({ m2Ok = true, m5Ok = true, generateOk = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if (parsed.pathname === "/api/tags") {
      if (parsed.origin === "http://127.0.0.1:11434") {
        return new Response(JSON.stringify(m2Ok ? { models: M2_MODELS.map((name) => ({ name })) } : {}), {
          status: m2Ok ? 200 : 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(m5Ok ? { models: M5_MODELS.map((name) => ({ name })) } : {}), {
        status: m5Ok ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (parsed.pathname === "/api/generate") {
      if (!generateOk) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ response: '{"insights":[]}' }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

test("model routing must keep blocked models blocked and stay loopback", async () => {
  assert.ok(validateModelRouting(modelRouting()));

  const unblocks = modelRouting();
  unblocks.blockedModels = unblocks.blockedModels.filter((item) => item.model !== "qwen3.8:27b-mlx");
  assert.throws(() => validateModelRouting(unblocks), /must keep qwen3.8:27b-mlx blocked/);

  const assignsBlocked = modelRouting();
  assignsBlocked.allowedRoles["zh-intent-synthesis"].model = "qwen2.5:14b";
  assert.throws(() => validateModelRouting(assignsBlocked), /blocked model qwen2.5:14b/);

  const extraRole = modelRouting();
  extraRole.allowedRoles["localization-draft"] = { node: "m5", model: "qwen3.5:9b" };
  assert.throws(() => validateModelRouting(extraRole), /exactly the ZH\+EN master roles/);

  const unsafe = modelRouting();
  unsafe.execution.automaticPublication = true;
  assert.throws(() => validateModelRouting(unsafe), /automaticPublication must remain false/);

  const remote = modelRouting();
  remote.nodes.m5.ollamaEndpoint = "http://192.168.1.50:11435";
  await assert.rejects(
    preflightFabric({ modelRouting: remote, routing }),
    /loopback/,
  );
});

test("preflight fails closed when an endpoint or model is unavailable", async () => {
  const down = fakeOllama({ m5Ok: false });
  const result = await preflightFabric({ modelRouting: modelRouting(), routing, fetchImpl: down.fetchImpl });
  assert.equal(result.ok, false);
  assert.ok(result.nodes.m5 && !result.nodes.m5.ok);

  const wrongModels = fakeOllama();
  const missing = modelRouting();
  missing.allowedRoles["zh-intent-synthesis"].model = "qwen3.8:27b-gguf-ad-q4k";
  const missingResult = await preflightFabric({ modelRouting: missing, routing, fetchImpl: wrongModels.fetchImpl });
  assert.equal(missingResult.ok, false);
  assert.deepEqual(missingResult.missingModels.map((item) => item.role), ["zh-intent-synthesis"]);
});

test("executor fails closed without --execute semantics when fabric is down", async () => {
  const down = fakeOllama({ m2Ok: false });
  const result = await executeContentJobs({
    packetInput: packet(),
    routing,
    modelRouting: modelRouting(),
    execute: true,
    fetchImpl: down.fetchImpl,
  });
  assert.equal(result.executed, false);
  assert.match(result.failure, /fail-closed/);
  assert.equal(result.jobs.length, 0);
  assert.equal(down.calls.filter((call) => call.url.includes("/api/generate")).length, 0);
});

test("executor runs exactly the five ZH+EN master jobs in order on the right nodes", async () => {
  const fake = fakeOllama();
  const result = await executeContentJobs({
    packetInput: packet(),
    routing,
    modelRouting: modelRouting(),
    execute: true,
    fetchImpl: fake.fetchImpl,
    now: () => "2026-09-09T10:00:00Z",
  });
  assert.equal(result.failure, null);
  assert.deepEqual(result.jobs.map((job) => job.role), [
    "normalize-insight",
    "deduplicate-insight",
    "classify-intent",
    "zh-intent-synthesis",
    "en-evidence-synthesis",
  ]);
  for (const job of result.jobs) {
    assert.equal(job.publicWriteAllowed, false);
    assert.equal(job.automaticPublication, false);
    assert.equal(job.outputMode, "append-only-candidate");
  }
  const generateCalls = fake.calls.filter((call) => call.url.includes("/api/generate"));
  assert.equal(generateCalls.length, 5);
  for (const call of generateCalls) {
    assert.equal(call.body.stream, false);
    assert.ok(["gemma3:4b", "qwen3.5:9b"].includes(call.body.model));
  }
  const m2Calls = generateCalls.filter((call) => call.url.startsWith("http://127.0.0.1:11434"));
  const m5Calls = generateCalls.filter((call) => call.url.startsWith("http://127.0.0.1:11435"));
  assert.equal(m2Calls.length, 3);
  assert.equal(m5Calls.length, 2);
  assert.ok(m5Calls.every((call) => call.body.model === "qwen3.5:9b"));
});

test("a failed generation stops the pipeline and is reported fail-closed", async () => {
  const fake = fakeOllama({ generateOk: false });
  const result = await executeContentJobs({
    packetInput: packet(),
    routing,
    modelRouting: modelRouting(),
    execute: true,
    fetchImpl: fake.fetchImpl,
  });
  assert.match(result.failure, /fail-closed: job normalize-insight failed/);
  assert.equal(result.jobs.length, 1);
});

test("candidate output is append-only and never touches website repositories", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "content-jobs-"));
  const fake = fakeOllama();
  const run = (now) => executeContentJobs({
    packetInput: packet(),
    routing,
    modelRouting: modelRouting(),
    execute: true,
    outDir: tmp,
    fetchImpl: fake.fetchImpl,
    now,
  });
  const first = await run(() => "2026-09-09T10:00:00Z");
  assert.equal(first.failure, null);
  const packetDir = path.join(tmp, packet().packetId);
  const files = fs.readdirSync(packetDir);
  assert.equal(files.length, 1);
  const written = JSON.parse(fs.readFileSync(path.join(packetDir, files[0]), "utf8"));
  assert.equal(written.automaticPublication, false);
  assert.equal(written.publicWriteAllowed, false);
  assert.equal(written.outputMode, "append-only-candidate");
  assert.deepEqual(written.locales, ["zh", "en"]);
  assert.equal(written.responses["zh-intent-synthesis"], '{"insights":[]}');

  // Same run id must fail on rewrite (append-only, flag "wx").
  assert.throws(() => fs.writeFileSync(path.join(packetDir, files[0]), "{}", { flag: "wx" }), /EEXIST/);

  assert.ok(tmp.startsWith(os.tmpdir()));
  assert.ok(!fs.existsSync(path.join(tmp, "sites")));
});
