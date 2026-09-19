#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROUTING = path.resolve(HERE, "../config/content-job-routing.json");

function parseArgs(argv) {
  const args = { packet: null, routing: DEFAULT_ROUTING, out: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--packet") args.packet = path.resolve(argv[++i]);
    else if (token === "--routing") args.routing = path.resolve(argv[++i]);
    else if (token === "--out") args.out = path.resolve(argv[++i]);
    else if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/plan-content-jobs.mjs --packet <knowledge-packet.json> [options]\n\nOptions:\n  --packet PATH    Required knowledge packet\n  --routing PATH   Routing contract (default: config/content-job-routing.json)\n  --out PATH       Write the deterministic plan to a file\n  --json           Print JSON plan only\n  -h, --help       Show help\n\nThis command plans jobs only. It never calls Ollama and never writes to website repositories.\n`);
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validatePacket(packet) {
  if (packet?.schemaVersion !== 1) throw new Error("knowledge packet schemaVersion must be 1");
  if (!packet?.packetId || typeof packet.packetId !== "string") throw new Error("knowledge packet requires packetId");
  if (!packet?.topic || typeof packet.topic.medicalHigh !== "boolean") throw new Error("knowledge packet requires topic.medicalHigh");
  if (!Array.isArray(packet.sourceInsightRefs) || packet.sourceInsightRefs.length === 0) {
    throw new Error("knowledge packet requires at least one sourceInsightRef");
  }
  const siteRouting = packet.siteRouting || {};
  for (const site of ["waleeratclinic.com", "waleeratinternational.com", "verzoclinic.com"]) {
    if (!siteRouting[site]) throw new Error(`knowledge packet missing siteRouting.${site}`);
    if (siteRouting[site].publicWriteAllowed !== false) {
      throw new Error(`siteRouting.${site}.publicWriteAllowed must remain false`);
    }
  }
  if (packet?.localization?.automaticPublication !== false) {
    throw new Error("localization.automaticPublication must remain false");
  }
  return packet;
}

export function validateRouting(routing) {
  if (routing?.schemaVersion !== 1) throw new Error("routing schemaVersion must be 1");
  if (routing?.execution?.executeModels !== false) throw new Error("planner requires executeModels=false");
  if (routing?.execution?.automaticPublication !== false) throw new Error("automaticPublication must remain false");
  if (routing?.execution?.sourceMutationAllowed !== false) throw new Error("sourceMutationAllowed must remain false");
  for (const role of routing.stageOrder || []) {
    const route = routing.roles?.[role];
    if (!route || !["m2", "m5"].includes(route.node)) throw new Error(`invalid route for ${role}`);
  }
  return routing;
}

function makeJob({ packet, routing, role, suffix = "", site = null, locale = null, dependsOn = [] }) {
  const route = routing.roles[role];
  const cleanSuffix = suffix ? `-${suffix}` : "";
  return {
    jobId: `${packet.packetId}-${role}${cleanSuffix}`,
    packetId: packet.packetId,
    role,
    node: route.node,
    class: route.class,
    site,
    locale,
    state: route.requiresFabricReady ? "waiting-fabric" : "planned",
    requiresFabricReady: Boolean(route.requiresFabricReady),
    dependsOn,
    outputMode: "append-only-candidate",
    publicWriteAllowed: false,
  };
}

export function buildPlan(packetInput, routingInput, packetBytes = null) {
  const packet = validatePacket(structuredClone(packetInput));
  const routing = validateRouting(structuredClone(routingInput));
  const bytes = packetBytes ?? Buffer.from(JSON.stringify(packetInput));
  const jobs = [];

  const normalize = makeJob({ packet, routing, role: "normalize-insight" });
  const dedupe = makeJob({ packet, routing, role: "deduplicate-insight", dependsOn: [normalize.jobId] });
  const classify = makeJob({ packet, routing, role: "classify-intent", dependsOn: [dedupe.jobId] });
  const zhMaster = makeJob({ packet, routing, role: "zh-intent-synthesis", locale: "zh", dependsOn: [classify.jobId] });
  const enMaster = makeJob({ packet, routing, role: "en-evidence-synthesis", locale: "en", dependsOn: [classify.jobId] });
  jobs.push(normalize, dedupe, classify, zhMaster, enMaster);

  const eligibleSites = Object.entries(packet.siteRouting)
    .filter(([, route]) => route.eligible)
    .map(([site]) => site)
    .sort();

  for (const site of eligibleSites) {
    const siteSlug = site.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    for (const locale of routing.masterLocales) {
      const draft = makeJob({
        packet,
        routing,
        role: "site-editorial-draft",
        suffix: `${siteSlug}-${locale}`,
        site,
        locale,
        dependsOn: [zhMaster.jobId, enMaster.jobId],
      });
      const semantic = makeJob({
        packet,
        routing,
        role: "semantic-review",
        suffix: `${siteSlug}-${locale}`,
        site,
        locale,
        dependsOn: [draft.jobId],
      });
      jobs.push(draft, semantic);

      let releaseDependency = semantic.jobId;
      if (packet.topic.medicalHigh) {
        const medical = makeJob({
          packet,
          routing,
          role: "medical-high-review",
          suffix: `${siteSlug}-${locale}`,
          site,
          locale,
          dependsOn: [semantic.jobId],
        });
        jobs.push(medical);
        releaseDependency = medical.jobId;
      }

      for (const targetLocale of routing.targetLocales) {
        const localization = makeJob({
          packet,
          routing,
          role: "localization-draft",
          suffix: `${siteSlug}-${locale}-to-${targetLocale}`,
          site,
          locale: targetLocale,
          dependsOn: [releaseDependency],
        });
        localization.sourceLocale = locale;
        localization.state = "waiting-reviewed-master";
        jobs.push(localization);
      }
    }
  }

  return {
    schemaVersion: 1,
    workflowId: routing.workflowId,
    packetId: packet.packetId,
    packetDigest: sha256(bytes),
    generatedAt: new Date().toISOString(),
    executionMode: routing.execution.mode,
    executeModels: false,
    automaticPublication: false,
    eligibleSites,
    masterLocales: routing.masterLocales,
    targetLocales: routing.targetLocales,
    jobs,
  };
}

function printHuman(plan) {
  const m2 = plan.jobs.filter((job) => job.node === "m2").length;
  const m5 = plan.jobs.filter((job) => job.node === "m5").length;
  console.log(`Content job plan: ${plan.packetId}`);
  console.log(`Mode: ${plan.executionMode} | executeModels=${plan.executeModels} | automaticPublication=${plan.automaticPublication}`);
  console.log(`Eligible sites: ${plan.eligibleSites.join(", ") || "none"}`);
  console.log(`Jobs: ${plan.jobs.length} | M2=${m2} | M5=${m5}`);
  console.log("No model calls were made. No website content was written.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.packet) throw new Error("--packet is required");
  const packetBytes = fs.readFileSync(args.packet);
  const packet = JSON.parse(packetBytes.toString("utf8"));
  const routing = readJson(args.routing, "routing contract");
  const plan = buildPlan(packet, routing, packetBytes);
  const json = `${JSON.stringify(plan, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, json, { flag: "wx" });
  }
  if (args.json || !args.out) console.log(json.trimEnd());
  else printHuman(plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
