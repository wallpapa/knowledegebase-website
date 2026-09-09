#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { probeOllama, resolveNodeEndpoint } from "./check-local-ai-nodes.mjs";
import { buildPlan } from "./plan-content-jobs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROUTING = path.resolve(HERE, "../config/content-job-routing.json");
const DEFAULT_MODEL_ROUTING = path.resolve(HERE, "../config/content-model-routing.json");

const ROLE_ORDER = [
  "normalize-insight",
  "deduplicate-insight",
  "classify-intent",
  "zh-intent-synthesis",
  "en-evidence-synthesis",
];

const ROLE_PROMPTS = {
  "normalize-insight":
    "You are a normalization worker. Given the knowledge packet below, output strict JSON: {\"insights\":[{\"id\":string,\"locale\":\"zh\"|\"en\",\"text\":string}]}. Normalize terminology only; never add medical claims. Packet:",
  "deduplicate-insight":
    "You are a deduplication worker. Given the normalized insights below, output strict JSON: {\"insights\":[...],\"removedDuplicates\":number} keeping one canonical entry per distinct insight. Input:",
  "classify-intent":
    "You are an intent classifier. Given the deduplicated insights below, output strict JSON: {\"intents\":[{\"id\":string,\"intent\":string,\"medicalHigh\":boolean}]}. Input:",
  "zh-intent-synthesis":
    "You are the Chinese master synthesis worker. Using only the classified insights below, output strict JSON: {\"zhIntent\":{\"patientQuestions\":[string],\"terms\":[string],\"concerns\":[string]}}. Do not invent evidence. Input:",
  "en-evidence-synthesis":
    "You are the English master synthesis worker. Using only the classified insights below, output strict JSON: {\"enEvidence\":{\"answerFrame\":[string],\"claimRefs\":[string],\"sourceBoundaries\":[string]}}. Do not invent evidence. Input:",
};

function parseArgs(argv) {
  const args = {
    packet: null,
    routing: DEFAULT_ROUTING,
    modelRouting: DEFAULT_MODEL_ROUTING,
    out: null,
    json: false,
    execute: false,
    requestTimeoutMs: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--packet") args.packet = path.resolve(argv[++i]);
    else if (token === "--routing") args.routing = path.resolve(argv[++i]);
    else if (token === "--model-routing") args.modelRouting = path.resolve(argv[++i]);
    else if (token === "--out") args.out = path.resolve(argv[++i]);
    else if (token === "--json") args.json = true;
    else if (token === "--execute") args.execute = true;
    else if (token === "--request-timeout-ms") args.requestTimeoutMs = Number(argv[++i]);
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.help && !args.packet) throw new Error("--packet is required");
  if (args.requestTimeoutMs !== null && (!Number.isFinite(args.requestTimeoutMs) || args.requestTimeoutMs <= 0)) {
    throw new Error("--request-timeout-ms must be a positive number");
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/run-content-jobs.mjs --packet <knowledge-packet.json> [options]

Bounded executor for the RedNote -> KB pipeline. Runs exactly five jobs in
order: normalize-insight, deduplicate-insight, classify-intent (M2 light
models), then zh-intent-synthesis and en-evidence-synthesis (M5 qwen3.5:9b).
Site drafts, reviews and localization fan-out are never executed here.

Options:
  --packet PATH          Required knowledge packet
  --routing PATH         Routing contract (default: config/content-job-routing.json)
  --model-routing PATH   Model routing contract (default: config/content-model-routing.json)
  --out PATH             Candidate output directory (default: outputs/content-jobs)
  --execute              Actually call Ollama. Without it, only preflight and plan.
  --request-timeout-ms N Per-job model timeout (default: model routing execution.requestTimeoutMs)
  --json                 JSON output only
  -h, --help             Show help

Safety: fails closed when an endpoint or model is unavailable. Outputs are
append-only candidates; re-running a packet fails instead of overwriting.
Nothing is written to website repositories and nothing is ever published.
`);
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${error.message}`);
  }
  return parsed;
}

export function validateModelRouting(modelRouting) {
  if (modelRouting?.schemaVersion !== 1) throw new Error("model routing schemaVersion must be 1");
  const exec = modelRouting?.execution;
  if (!exec || exec.automaticPublication !== false) throw new Error("model routing automaticPublication must remain false");
  if (exec.publicWriteAllowed !== false) throw new Error("model routing publicWriteAllowed must remain false");
  if (exec.sourceMutationAllowed !== false) throw new Error("model routing sourceMutationAllowed must remain false");
  if (exec.outputMode !== "append-only-candidate") throw new Error("model routing outputMode must be append-only-candidate");
  const roles = modelRouting?.allowedRoles || {};
  const roleNames = Object.keys(roles).sort();
  const expected = [...ROLE_ORDER].sort();
  if (JSON.stringify(roleNames) !== JSON.stringify(expected)) {
    throw new Error(`model routing must authorize exactly the ZH+EN master roles ${expected.join(", ")}`);
  }
  for (const role of ROLE_ORDER) {
    const entry = roles[role];
    if (!entry?.model || typeof entry.model !== "string") throw new Error(`model routing missing model for ${role}`);
    const node = modelRouting.nodes?.[entry.node];
    if (!node) throw new Error(`model routing missing node ${entry.node} for ${role}`);
  }
  const blocked = (modelRouting?.blockedModels || []).map((item) => item.model);
  for (const blockedModel of ["qwen3.8:27b-mlx", "qwen2.5:14b"]) {
    if (!blocked.includes(blockedModel)) throw new Error(`model routing must keep ${blockedModel} blocked`);
  }
  for (const [role, entry] of Object.entries(roles)) {
    if (blocked.includes(entry.model)) throw new Error(`model routing assigns blocked model ${entry.model} to ${role}`);
  }
  return modelRouting;
}

export async function preflightFabric({
  modelRouting,
  routing,
  env = process.env,
  timeoutMs = 5000,
  fetchImpl = fetch,
}) {
  const requiredNodes = [...new Set(ROLE_ORDER.map((role) => modelRouting.allowedRoles[role].node))];
  const nodes = {};
  for (const nodeId of requiredNodes) {
    const endpoint = resolveNodeEndpoint(nodeId, modelRouting.nodes[nodeId], env);
    const probe = await probeOllama(endpoint, timeoutMs, fetchImpl);
    nodes[nodeId] = { endpoint, ...probe };
  }
  const missingModels = [];
  for (const role of ROLE_ORDER) {
    const entry = modelRouting.allowedRoles[role];
    const node = nodes[entry.node];
    if (!node?.ok) {
      missingModels.push({ role, model: entry.model, reason: `node ${entry.node} unavailable` });
      continue;
    }
    if (!node.models.includes(entry.model)) {
      missingModels.push({ role, model: entry.model, reason: `not installed on ${entry.node} (${node.endpoint})` });
    }
  }
  const expectedFabricId = routing?.fabricId || modelRouting.fabricId;
  const fabricIdMismatch = routing?.fabricId && modelRouting.fabricId && routing.fabricId !== modelRouting.fabricId;
  return {
    ok: missingModels.length === 0 && !fabricIdMismatch,
    fabricId: expectedFabricId,
    nodes,
    missingModels,
    fabricIdMismatch: Boolean(fabricIdMismatch),
  };
}

function buildPrompt(role, packet, maxPromptChars) {
  const payload = JSON.stringify({
    packetId: packet.packetId,
    topic: packet.topic,
    sourceInsightRefs: packet.sourceInsightRefs,
    evidence: packet.evidence,
    claims: packet.claims,
  });
  const bounded = payload.length > maxPromptChars ? `${payload.slice(0, maxPromptChars)}…[truncated]` : payload;
  return `${ROLE_PROMPTS[role]}\n${bounded}`;
}

async function generate({ endpoint, model, prompt, timeoutMs, fetchImpl, think = null, numPredict = null }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const payload = { model, prompt, stream: false, options: { temperature: 0.2 } };
    if (think === false) payload.think = false;
    if (Number.isFinite(numPredict) && numPredict > 0) payload.options.num_predict = numPredict;
    const response = await fetchImpl(`${endpoint}/api/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const body = await response.json();
    if (typeof body?.response !== "string" || body.response.trim().length === 0) {
      return { ok: false, error: "empty model response" };
    }
    return { ok: true, latencyMs: Date.now() - startedAt, response: body.response.trim() };
  } catch (error) {
    const message = error?.name === "AbortError" ? "timeout" : String(error?.message || error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeContentJobs({
  packetInput,
  routing,
  modelRouting,
  packetBytes = null,
  outDir = null,
  execute = false,
  env = process.env,
  timeoutMs = 5000,
  requestTimeoutMs = 120000,
  maxPromptChars = 24000,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  validateModelRouting(modelRouting);
  const plan = buildPlan(packetInput, routing, packetBytes);

  const preflight = await preflightFabric({ modelRouting, env, timeoutMs, fetchImpl });
  if (execute && !preflight.ok) {
    return { plan, preflight, executed: false, jobs: [], failure: "fail-closed: fabric or models unavailable" };
  }

  const jobs = [];
  const defaultMaxTokens = Number.isFinite(modelRouting.execution.maxOutputTokens)
    ? modelRouting.execution.maxOutputTokens
    : 4096;
  for (const role of ROLE_ORDER) {
    const entry = modelRouting.allowedRoles[role];
    const result = execute && preflight.ok
      ? await generate({
          endpoint: preflight.nodes[entry.node].endpoint,
          model: entry.model,
          prompt: buildPrompt(role, packetInput, maxPromptChars),
          timeoutMs: requestTimeoutMs,
          fetchImpl,
          think: entry.thinking === false ? false : null,
          numPredict: Number.isFinite(entry.maxOutputTokens) ? entry.maxOutputTokens : defaultMaxTokens,
        })
      : { ok: null, skipped: !execute ? "dry-run" : null };
    const record = {
      jobId: `${packetInput.packetId}-${role}`,
      packetId: packetInput.packetId,
      role,
      node: entry.node,
      model: entry.model,
      state: result.ok === null ? "dry-run" : result.ok ? "completed" : "failed",
      outputMode: "append-only-candidate",
      publicWriteAllowed: false,
      automaticPublication: false,
      completedAt: result.ok ? now() : undefined,
      latencyMs: result.latencyMs,
      response: result.ok ? result.response : undefined,
      error: result.ok === false ? result.error : undefined,
    };
    jobs.push(record);
    if (result.ok === false) {
      return { plan, preflight, executed: execute, jobs, failure: `fail-closed: job ${role} failed (${result.error})` };
    }
  }

  if (outDir && execute) {
    const candidatePath = path.join(outDir, packetInput.packetId);
    fs.mkdirSync(candidatePath, { recursive: true });
    const runId = createHash("sha256")
      .update(`${packetInput.packetId}|${plan.packetDigest}|${now()}`)
      .digest("hex")
      .slice(0, 16);
    const summary = {
      schemaVersion: 1,
      workflowId: modelRouting.fabricId,
      packetId: packetInput.packetId,
      packetDigest: plan.packetDigest,
      runId,
      executedAt: now(),
      executionMode: modelRouting.execution.mode,
      locales: ["zh", "en"],
      automaticPublication: false,
      publicWriteAllowed: false,
      outputMode: "append-only-candidate",
      jobs: jobs.map(({ response, ...rest }) => ({ ...rest, responseChars: response?.length ?? 0 })),
      responses: Object.fromEntries(jobs.map((job) => [job.role, job.response])),
    };
    fs.writeFileSync(path.join(candidatePath, `run-${runId}.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  }

  return { plan, preflight, executed: execute, jobs, failure: null };
}

function printHuman(result) {
  console.log(`Bounded content execution: ${result.plan.packetId}`);
  console.log(`Mode: ZH+EN masters only | executed=${result.executed} | automaticPublication=false`);
  for (const [nodeId, node] of Object.entries(result.preflight.nodes)) {
    console.log(`${node.ok ? "PASS" : "FAIL"} ${nodeId.toUpperCase()} | ${node.endpoint}${node.ok ? ` | models=${node.models.length}` : ` | ${node.error}`}`);
  }
  for (const missing of result.preflight.missingModels) {
    console.log(`FAIL model ${missing.model} for ${missing.role}: ${missing.reason}`);
  }
  for (const job of result.jobs) {
    console.log(`${job.state.toUpperCase()} ${job.role} | ${job.node} | ${job.model}`);
  }
  if (result.failure) console.log(result.failure);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const packetBytes = fs.readFileSync(args.packet);
  const packet = JSON.parse(packetBytes.toString("utf8"));
  const routing = readJson(args.routing, "routing contract");
  const modelRouting = readJson(args.modelRouting, "model routing contract");
  const result = await executeContentJobs({
    packetInput: packet,
    routing,
    modelRouting,
    packetBytes,
    outDir: args.out || modelRouting.execution.candidateDirectory,
    execute: args.execute,
    requestTimeoutMs: args.requestTimeoutMs ?? modelRouting.execution.requestTimeoutMs,
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  if (result.failure) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
