#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseFabric } from "../scripts/doctor-local-ai-fabric.mjs";

const contract = {
  fabricId: "test-fabric",
  nodes: {
    m2: {
      role: "control-plane",
      hostnameHint: "clinic-m2",
      ollamaEndpoint: "http://127.0.0.1:11434",
      endpointEnv: "OLLAMA_M2_URL",
    },
    m5: {
      role: "compute-plane",
      hostnameHint: "clinic-m5",
      ollamaEndpoint: "http://127.0.0.1:11435",
      endpointEnv: "OLLAMA_M5_URL",
    },
  },
};

function successfulCommandRunner(calls) {
  return async (command, args) => {
    calls.push([command, ...args]);
    if (command === "tailscale" && args[0] === "ping") {
      return { ok: true, latencyMs: 3, stdout: "pong from clinic-m5 via direct", stderr: "" };
    }
    return { ok: true, latencyMs: 2, stdout: "", stderr: "" };
  };
}

async function successfulOllamaProbe(endpoint) {
  return { ok: true, latencyMs: 1, models: endpoint.endsWith("11435") ? ["qwen3.5:9b"] : ["gemma3:4b"] };
}

test("one-command doctor passes all layers and uses BatchMode SSH", async () => {
  const calls = [];
  const result = await diagnoseFabric({
    contract,
    env: { USER: "tester" },
    commandRunner: successfulCommandRunner(calls),
    ollamaProbe: successfulOllamaProbe,
  });

  assert.equal(result.ready, true);
  assert.equal(result.diagnosis, "ready");
  assert.equal(result.target.sshTarget, "tester@clinic-m5");
  assert.equal(result.checks.tailscaleToM5.ok, true);
  assert.equal(result.checks.sshConfig.ok, true);
  assert.equal(result.checks.sshToM5.ok, true);
  assert.equal(result.checks.m5RemoteOllama.ok, true);
  assert.equal(result.checks.m5TunnelOllama.ok, true);
  const sshCalls = calls.filter((call) => call[0] === "ssh");
  assert.equal(sshCalls.length, 3);
  for (const call of sshCalls) assert.ok(call.includes("BatchMode=yes"));
});

test("a DERP pong counts as reachable even if tailscale ping exits nonzero", async () => {
  const runner = async (command, args) => {
    if (command === "tailscale" && args[0] === "status") {
      return { ok: true, latencyMs: 1, stdout: "{}", stderr: "" };
    }
    if (command === "tailscale" && args[0] === "ping") {
      return {
        ok: false,
        latencyMs: 74,
        stdout: "pong from clinic-m5 (100.70.240.28) via DERP(sin) in 74ms",
        stderr: "",
        error: "command exited 1",
      };
    }
    if (command === "ssh") return { ok: true, latencyMs: 2, stdout: "", stderr: "" };
    throw new Error(`unexpected command ${command}`);
  };

  const result = await diagnoseFabric({
    contract,
    env: { USER: "tester" },
    commandRunner: runner,
    ollamaProbe: successfulOllamaProbe,
  });

  assert.equal(result.checks.tailscaleToM5.ok, true);
  assert.equal(result.checks.tailscaleToM5.rawCommandOk, false);
  assert.equal(result.diagnosis, "ready");
});

test("broken ~/.ssh/config is diagnosed separately from network reachability", async () => {
  const runner = async (command, args) => {
    if (command === "tailscale" && args[0] === "status") {
      return { ok: true, latencyMs: 1, stdout: "{}", stderr: "" };
    }
    if (command === "tailscale" && args[0] === "ping") {
      return { ok: true, latencyMs: 1, stdout: "pong from clinic-m5 via direct", stderr: "" };
    }
    if (command === "ssh" && args.includes("-G")) {
      return {
        ok: false,
        latencyMs: 1,
        stdout: "",
        stderr: '/Users/tester/.ssh/config line 2: no argument after keyword "host"\n/Users/tester/.ssh/config: terminating, 1 bad configuration options',
        error: "command failed",
      };
    }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };

  const result = await diagnoseFabric({
    contract,
    env: { USER: "tester" },
    commandRunner: runner,
    ollamaProbe: async (endpoint) => endpoint.endsWith("11434")
      ? { ok: true, latencyMs: 1, models: [] }
      : { ok: false, latencyMs: 1, error: "offline" },
  });

  assert.equal(result.checks.tailscaleToM5.ok, true);
  assert.equal(result.checks.sshConfig.invalid, true);
  assert.equal(result.diagnosis, "ssh-config-invalid");
  assert.match(result.recommendedAction, /CLINIC_SSH_CONFIG=\/dev\/null/);
});

test("healthy SSH plus remote Ollama but missing tunnel diagnoses tunnel only", async () => {
  const result = await diagnoseFabric({
    contract,
    env: { USER: "tester" },
    commandRunner: successfulCommandRunner([]),
    ollamaProbe: async (endpoint) => endpoint.endsWith("11435")
      ? { ok: false, latencyMs: 1, error: "fetch failed" }
      : { ok: true, latencyMs: 1, models: [] },
  });

  assert.equal(result.ready, false);
  assert.equal(result.diagnosis, "m5-tunnel-unavailable");
  assert.match(result.recommendedAction, /ssh -N -L 11435:127\.0\.0\.1:11434/);
});

test("SSH failure is reported before tunnel and Ollama symptoms", async () => {
  const runner = async (command, args) => {
    if (command === "tailscale") return { ok: true, latencyMs: 1, stdout: "pong", stderr: "" };
    if (command === "ssh" && args.includes("-G")) return { ok: true, latencyMs: 1, stdout: "", stderr: "" };
    if (command === "ssh") return { ok: false, latencyMs: 1, error: "Permission denied", stdout: "", stderr: "Permission denied" };
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };
  const result = await diagnoseFabric({
    contract,
    env: { USER: "tester" },
    commandRunner: runner,
    ollamaProbe: async () => ({ ok: false, latencyMs: 1, error: "offline" }),
  });

  assert.equal(result.diagnosis, "ssh-unavailable");
  assert.equal(result.checks.m5RemoteOllama.ok, false);
});

test("environment overrides host, SSH user and SSH config without changing loopback endpoints", async () => {
  const calls = [];
  const result = await diagnoseFabric({
    contract,
    env: {
      USER: "local-user",
      CLINIC_M5_HOST: "m5-custom",
      CLINIC_M5_SSH_USER: "remote-user",
      CLINIC_SSH_CONFIG: "/dev/null",
      OLLAMA_M2_URL: "http://localhost:11434",
      OLLAMA_M5_URL: "http://localhost:11435",
    },
    commandRunner: successfulCommandRunner(calls),
    ollamaProbe: successfulOllamaProbe,
  });

  assert.equal(result.target.sshTarget, "remote-user@m5-custom");
  assert.equal(result.target.sshConfigPath, "/dev/null");
  assert.equal(result.checks.m2Ollama.endpoint, "http://localhost:11434");
  assert.equal(result.checks.m5TunnelOllama.endpoint, "http://localhost:11435");
  const sshCalls = calls.filter((call) => call[0] === "ssh");
  for (const call of sshCalls) {
    assert.ok(call.includes("-F"));
    assert.ok(call.includes("/dev/null"));
  }
});
