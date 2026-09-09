# Learning record — overnight deep-research run (2026-09-10)

Verified: 11/11 Rednote searches OK (logged-in IAB), 6/6 zh masters + 6/6 EN
via Ollama lanes, gates PASS. Time cost ~3.5h inside free window (00:00-04:30).

Lessons (scope: this workspace's agent-mesh + KB runs):
1. node_repl browser scripts must persist state via files (/tmp/*.json) —
   globalThis does NOT survive across js calls; capture full data to files,
   never rely on .slice() console output.
2. nohup+background node silently dies on stdout buffering in this harness —
   use foreground exec path (background tool) for long fan-outs.
3. qwen3:14b emits empty /api/generate responses (thinking mode) — excluded
   from translation lanes; qwen2.5:14b is the reliable 14B.
4. Ollama per-machine: MAX_LOADED_MODELS=4 set locally; M5 requires owner
   (no ssh; machine slept). Two-machine fan-out deferred until owner enables
   remote access + disables sleep.
5. Rednote: high-engagement posts are frequently author-locked on web —
   never retry locked IDs (recorded stable); openable ones give hashtags +
   comment Q&A (highest-value UGC evidence).
6. Evidence-file naming: xhs-<term>-<YYYYMMDD>.json; one run per file,
   never overwrite.
Next actionable: staff review of 12 drafts; publish through site workflows;
rerun persona ar/ja/ru localization when owner wakes M5.
