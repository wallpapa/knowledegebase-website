#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.resolve(HERE, "../config/local-ai-nodes.json");
const DEFAULT_TIMEOUT_MS = 3000;

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    requireM2: false,
    requireM5: false,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--require-m2") args.requireM2 = true;
    else if (token === "--require-m5") args.requireM5 = true;
    else if (token === "--require-all") {
      args.requireM2 = true;
      args.requireM5 = true;
    } else if (token === "--json") args.json = true;
    else if (token === "--config") args.config = path.resolve(argv[++i]);
    else if (token === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/check-local-ai-nodes.mjs [options]\n\nOptions:\n  --require-m2       Fail if the M2 Ollama endpoint is unavailable\n  --require-m5       Fail if the M5 tunnel/Ollama endpoint is unavailable\n  --require-all      Require both nodes\n  --json             Print JSON only\n  --timeout-ms N     Per-node timeout (default: ${DEFAULT_TIMEOUT_MS})\n  --config PATH      Override node-contract path\n  -h, --help         Show this help\n\nEnvironment overrides:\n  OLLAMA_M2_URL      M2 Ollama base URL\n  OLLAMA_M5_URL      M5 tunnel Ollama base URL\n`);
}

export function loadContract(configPath = DEFAULT_CONFIG) {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (parsed?.schemaVersion !== 1 || !parsed?.nodes?.m2 || !parsed?.nodes?.m5) {
    throw new Error("Invalid local AI node contract");
  }
  return parsed;
}

export function resolveNodeEndpoint(nodeId, node, env = process.env) {
  const envName = node.endpointEnv;
  const raw = (envName && env[envName]) || node.ollamaEndpoint;
  const url = new URL(raw);
  if (url.protocol !== "http:") throw new Error(`${nodeId}: only http loopback endpoints are allowed`);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`${nodeId}: endpoint must remain loopback-only; got ${url.hostname}`);
  }
  return url.origin;
}

export async function probeOllama(baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false, latencyMs: Date.now() - startedAt, error: `HTTP ${response.status}` };
    }
    const body = await response.json();
    const models = Array.isArray(body?.models)
      ? body.models.map((item) => item?.name).filter((name) => typeof name === "string")
      : [];
    return { ok: true, latencyMs: Date.now() - startedAt, models };
  } catch (error) {
    const message = error?.name === "AbortError" ? "timeout" : String(error?.message || error);
    return { ok: false, latencyMs: Date.now() - startedAt, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function runHealthCheck({ contract, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
  const nodes = {};
  for (const nodeId of ["m2", "m5"]) {
    const node = contract.nodes[nodeId];
    const endpoint = resolveNodeEndpoint(nodeId, node, env);
    const probe = await probeOllama(endpoint, timeoutMs, fetchImpl);
    nodes[nodeId] = {
      role: node.role,
      endpoint,
      ...probe,
    };
  }
  return {
    fabricId: contract.fabricId,
    checkedAt: new Date().toISOString(),
    nodes,
  };
}

function printHuman(result) {
  console.log(`Local AI fabric: ${result.fabricId}`);
  for (const [nodeId, node] of Object.entries(result.nodes)) {
    const state = node.ok ? "READY" : "OFFLINE";
    const models = node.ok ? ` | models=${node.models.length}` : ` | ${node.error}`;
    console.log(`${nodeId.toUpperCase()} ${state} | ${node.role} | ${node.endpoint} | ${node.latencyMs}ms${models}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const contract = loadContract(args.config);
  const result = await runHealthCheck({ contract, timeoutMs: args.timeoutMs });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);

  const failed = (args.requireM2 && !result.nodes.m2.ok) || (args.requireM5 && !result.nodes.m5.ok);
  if (failed) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
