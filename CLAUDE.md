## Plans

All architectural decisions, bug analyses, and roadmap items live in `plans/`.
- `plans/architecture-analysis.md` — full breakdown of bugs, root causes, and fix priorities
- `plans/ui-redesign.md` — UI roadmap comparing stavi vs t3code, phase-by-phase plan
- `plans/competitive-research.md` — deep research on t3code and lunel architectures, what to copy/avoid
- `plans/stavi-vision.md` — product vision, differentiators, roadmap

**Always read the plans/ files before starting new work** — they contain root-cause
analysis that prevents re-investigating known bugs.

---

## Project Context

- Stavi is a React Native mobile app that connects to a local server to run AI agents
- Forked from t3code's server code, inspired by lunel (another RN terminal app)
- Server: `packages/server-core/src/server.ts` (Bun WebSocket RPC, single file)
- Mobile AI: `apps/mobile/src/plugins/core/ai/` (useOrchestration.ts is the brain)
- Provider adapters: `packages/server-core/src/providers/` (claude.ts, codex.ts)

Key known bugs (see plans/architecture-analysis.md for details):
1. Multi-turn Claude conversations are broken (queryRuntime not reset after turn)
2. CWD not passed to Claude adapter (always uses '.', not the workspace root)
3. thread.created event never broadcast from server

---

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
