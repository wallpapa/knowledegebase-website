#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveNodeEndpoint,
  probeOllama,
  runHealthCheck,
} from "../scripts/check-local-ai-nodes.mjs";

const contract = {
  fabricId: "test-fabric",
  nodes: {
    m2: {
      role: "control-plane",
      endpointEnv: "OLLAMA_M2_URL",
      ollamaEndpoint: "http://127.0.0.1:11434",
    },
    m5: {
      role: "compute-plane",
      endpointEnv: "OLLAMA_M5_URL",
      ollamaEndpoint: "http://127.0.0.1:11435",
    },
  },
};

test("node endpoint overrides remain loopback-only", () => {
  assert.equal(
    resolveNodeEndpoint("m5", contract.nodes.m5, { OLLAMA_M5_URL: "http://localhost:14435" }),
    "http://localhost:14435",
  );
  assert.throws(
    () => resolveNodeEndpoint("m5", contract.nodes.m5, { OLLAMA_M5_URL: "http://192.168.1.99:11434" }),
    /loopback-only/,
  );
  assert.throws(
    () => resolveNodeEndpoint("m5", contract.nodes.m5, { OLLAMA_M5_URL: "https://localhost:11435" }),
    /only http loopback endpoints/,
  );
});

test("probeOllama returns model names from /api/tags", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "http://127.0.0.1:11434/api/tags");
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "tiny:latest" }, { name: "embed:test" }] }),
    };
  };
  const result = await probeOllama("http://127.0.0.1:11434", 50, fetchImpl);
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["tiny:latest", "embed:test"]);
});

test("probeOllama fails closed on an HTTP error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const result = await probeOllama("http://127.0.0.1:11434", 50, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.error, "HTTP 503");
});

test("health check reports M2 and M5 independently", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("http://127.0.0.1:11434")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "small:test" }] }),
      };
    }
    return { ok: false, status: 502 };
  };

  const result = await runHealthCheck({ contract, env: {}, timeoutMs: 50, fetchImpl });
  assert.equal(result.nodes.m2.ok, true);
  assert.equal(result.nodes.m5.ok, false);
  assert.deepEqual(result.nodes.m2.models, ["small:test"]);
  assert.equal(result.nodes.m5.error, "HTTP 502");
  assert.deepEqual(calls.sort(), [
    "http://127.0.0.1:11434/api/tags",
    "http://127.0.0.1:11435/api/tags",
  ]);
});
