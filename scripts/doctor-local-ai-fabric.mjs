#!/usr/bin/env node

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadContract, probeOllama, resolveNodeEndpoint } from "./check-local-ai-nodes.mjs";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.resolve(HERE, "../config/local-ai-nodes.json");
const DEFAULT_TIMEOUT_MS = 5000;

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") args.json = true;
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
  console.log(`Usage: node scripts/doctor-local-ai-fabric.mjs [options]\n\nChecks from clinic-m2, in order:\n  1. Tailscale CLI + reachability to clinic-m5\n  2. SSH config parse + non-interactive SSH authentication to clinic-m5\n  3. Ollama on clinic-m2 loopback\n  4. Ollama on clinic-m5 loopback, reached through SSH\n  5. Existing M2 -> M5 SSH tunnel at 127.0.0.1:11435\n\nOptions:\n  --json             JSON output only\n  --timeout-ms N     Timeout per external check (default: ${DEFAULT_TIMEOUT_MS})\n  --config PATH      Override node contract\n  -h, --help         Show help\n\nEnvironment:\n  CLINIC_M5_HOST       Override M5 Tailscale hostname (default: config hostnameHint)\n  CLINIC_M5_SSH_USER   Override M5 SSH user (default: current local user)\n  CLINIC_SSH_CONFIG    Optional SSH config path; use /dev/null to bypass a broken ~/.ssh/config\n  OLLAMA_M2_URL        Override M2 loopback endpoint\n  OLLAMA_M5_URL        Override M5 tunnel loopback endpoint\n`);
}

async function runCommand(command, args, timeoutMs) {
  const startedAt = Date.now();
  try {
    const { stdout = "", stderr = "" } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error) {
    const timedOut = error?.killed || error?.code === "ETIMEDOUT";
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: timedOut ? "timeout" : String(error?.message || error),
      stdout: String(error?.stdout || "").trim(),
      stderr: String(error?.stderr || "").trim(),
    };
  }
}

function sshBaseArgs(timeoutMs, sshConfigPath = null) {
  const connectTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = [];
  if (sshConfigPath) args.push("-F", sshConfigPath);
  args.push(
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${connectTimeoutSeconds}`,
    "-o", "ConnectionAttempts=1",
    "-o", "StrictHostKeyChecking=accept-new",
  );
  return args;
}

function combinedOutput(result) {
  return [result?.stdout, result?.stderr, result?.error].filter(Boolean).join("\n");
}

function tailscalePingReached(result) {
  return Boolean(result?.ok || /\bpong from\b/i.test(combinedOutput(result)));
}

function sshConfigBroken(result) {
  const text = combinedOutput(result);
  return /bad configuration options|no argument after keyword|terminating, \d+ bad configuration option/i.test(text);
}

function tunnelCommand({ sshTarget, sshConfigPath }) {
  const configPart = sshConfigPath ? ` -F ${shellQuote(sshConfigPath)}` : "";
  return `ssh${configPart} -N -L 11435:127.0.0.1:11434 ${shellQuote(sshTarget)}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export async function diagnoseFabric({
  contract,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  commandRunner = runCommand,
  ollamaProbe = probeOllama,
}) {
  const m2Endpoint = resolveNodeEndpoint("m2", contract.nodes.m2, env);
  const m5TunnelEndpoint = resolveNodeEndpoint("m5", contract.nodes.m5, env);
  const m5Host = env.CLINIC_M5_HOST || contract.nodes.m5.hostnameHint || "clinic-m5";
  const sshUser = env.CLINIC_M5_SSH_USER || env.USER || os.userInfo().username;
  const sshConfigPath = env.CLINIC_SSH_CONFIG || null;
  const sshTarget = `${sshUser}@${m5Host}`;

  const tailscaleStatus = await commandRunner("tailscale", ["status", "--json"], timeoutMs);
  const tailscalePingRaw = tailscaleStatus.ok
    ? await commandRunner("tailscale", ["ping", "--c=1", m5Host], timeoutMs)
    : { ok: false, latencyMs: 0, error: "tailscale CLI unavailable" };
  const tailscaleReachable = tailscalePingReached(tailscalePingRaw);
  const tailscalePing = { ...tailscalePingRaw, ok: tailscaleReachable, rawCommandOk: Boolean(tailscalePingRaw.ok) };

  const sshArgs = sshBaseArgs(timeoutMs, sshConfigPath);
  const sshConfigCheck = tailscaleReachable
    ? await commandRunner("ssh", [...sshArgs, "-G", sshTarget], timeoutMs)
    : { ok: false, latencyMs: 0, error: "skipped: Tailscale path unavailable" };
  const sshConfigInvalid = tailscaleReachable && !sshConfigCheck.ok && sshConfigBroken(sshConfigCheck);

  const ssh = tailscaleReachable && !sshConfigInvalid
    ? await commandRunner("ssh", [...sshArgs, sshTarget, "true"], timeoutMs)
    : {
      ok: false,
      latencyMs: 0,
      error: sshConfigInvalid ? "skipped: SSH config invalid" : "skipped: Tailscale path unavailable",
    };

  const m2Ollama = await ollamaProbe(m2Endpoint, timeoutMs);

  const remoteOllama = ssh.ok
    ? await commandRunner(
      "ssh",
      [
        ...sshArgs,
        sshTarget,
        "curl -fsS --max-time 4 http://127.0.0.1:11434/api/tags >/dev/null",
      ],
      timeoutMs,
    )
    : { ok: false, latencyMs: 0, error: "skipped: SSH unavailable" };

  const tunnelOllama = await ollamaProbe(m5TunnelEndpoint, timeoutMs);

  let diagnosis = "ready";
  let recommendedAction = null;
  if (!tailscaleStatus.ok) {
    diagnosis = "tailscale-cli-unavailable";
    recommendedAction = "Install/enable the Tailscale CLI on clinic-m2, then rerun.";
  } else if (!tailscaleReachable) {
    diagnosis = "tailscale-path-unavailable";
    recommendedAction = `Bring ${m5Host} online in the same tailnet and verify MagicDNS/Tailscale reachability.`;
  } else if (sshConfigInvalid) {
    diagnosis = "ssh-config-invalid";
    recommendedAction = "Your SSH config cannot be parsed. Repair ~/.ssh/config, or temporarily bypass it with: CLINIC_SSH_CONFIG=/dev/null npm run ai:fabric:doctor";
  } else if (!ssh.ok) {
    diagnosis = "ssh-unavailable";
    recommendedAction = `Enable Remote Login on ${m5Host} and verify key-based SSH for ${sshTarget}.`;
  } else if (!remoteOllama.ok) {
    diagnosis = "m5-ollama-unavailable";
    recommendedAction = `Start Ollama on ${m5Host}; it must answer on 127.0.0.1:11434.`;
  } else if (!tunnelOllama.ok) {
    diagnosis = "m5-tunnel-unavailable";
    recommendedAction = `Start the tunnel on clinic-m2: ${tunnelCommand({ sshTarget, sshConfigPath })}`;
  } else if (!m2Ollama.ok) {
    diagnosis = "m2-ollama-unavailable";
    recommendedAction = "Start Ollama on clinic-m2 at 127.0.0.1:11434, or keep M2 inference disabled until a small worker model is installed.";
  }

  return {
    fabricId: contract.fabricId,
    checkedFrom: "clinic-m2",
    checkedAt: new Date().toISOString(),
    target: { host: m5Host, sshUser, sshTarget, sshConfigPath },
    checks: {
      tailscaleCli: { ok: tailscaleStatus.ok, latencyMs: tailscaleStatus.latencyMs, error: tailscaleStatus.error },
      tailscaleToM5: {
        ok: tailscaleReachable,
        rawCommandOk: Boolean(tailscalePingRaw.ok),
        latencyMs: tailscalePingRaw.latencyMs,
        detail: tailscalePingRaw.stdout || tailscalePingRaw.stderr,
        error: tailscaleReachable ? null : tailscalePingRaw.error,
      },
      sshConfig: {
        ok: Boolean(sshConfigCheck.ok),
        invalid: sshConfigInvalid,
        latencyMs: sshConfigCheck.latencyMs,
        error: sshConfigCheck.error || sshConfigCheck.stderr || null,
      },
      sshToM5: { ok: ssh.ok, latencyMs: ssh.latencyMs, error: ssh.error || ssh.stderr || null },
      m2Ollama: { endpoint: m2Endpoint, ...m2Ollama },
      m5RemoteOllama: { endpoint: "http://127.0.0.1:11434", ok: remoteOllama.ok, latencyMs: remoteOllama.latencyMs, error: remoteOllama.error || remoteOllama.stderr || null },
      m5TunnelOllama: { endpoint: m5TunnelEndpoint, ...tunnelOllama },
    },
    diagnosis,
    recommendedAction,
    ready: diagnosis === "ready",
  };
}

function icon(ok) {
  return ok ? "PASS" : "FAIL";
}

function printHuman(result) {
  console.log(`Clinic local AI fabric doctor — ${result.fabricId}`);
  console.log(`M2 -> M5 target: ${result.target.sshTarget}`);
  console.log(`${icon(result.checks.tailscaleCli.ok)} Tailscale CLI`);
  console.log(`${icon(result.checks.tailscaleToM5.ok)} Tailscale -> M5${result.checks.tailscaleToM5.detail ? ` | ${result.checks.tailscaleToM5.detail}` : ""}`);
  console.log(`${icon(result.checks.sshConfig.ok)} SSH config${result.checks.sshConfig.invalid ? " | invalid" : ""}`);
  console.log(`${icon(result.checks.sshToM5.ok)} SSH -> M5`);
  console.log(`${icon(result.checks.m2Ollama.ok)} M2 Ollama | ${result.checks.m2Ollama.endpoint}${result.checks.m2Ollama.ok ? ` | models=${result.checks.m2Ollama.models.length}` : ""}`);
  console.log(`${icon(result.checks.m5RemoteOllama.ok)} M5 Ollama over SSH | ${result.checks.m5RemoteOllama.endpoint}`);
  console.log(`${icon(result.checks.m5TunnelOllama.ok)} M2 -> M5 tunnel Ollama | ${result.checks.m5TunnelOllama.endpoint}${result.checks.m5TunnelOllama.ok ? ` | models=${result.checks.m5TunnelOllama.models.length}` : ""}`);
  console.log(`Diagnosis: ${result.diagnosis}`);
  if (result.recommendedAction) console.log(`Next: ${result.recommendedAction}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const contract = loadContract(args.config);
  const result = await diagnoseFabric({ contract, timeoutMs: args.timeoutMs });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  if (!result.ready) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
