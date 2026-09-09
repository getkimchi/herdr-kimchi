# herdr-kimchi

Herdr lifecycle bridge for [Kimchi](https://kimchi.dev/).

This is a Pi extension that Kimchi loads automatically when it starts inside a [Herdr](https://herdr.dev/) pane. It reports Kimchi's agent state (`idle`/`working`/`blocked`) and session references to Herdr over its local socket, so Herdr can:

- label the pane correctly in its sidebar,
- show `working` while Kimchi is generating,
- transition back to `idle` when the turn completes,
- restore the Kimchi session after a Herdr server restart.

## Why this exists

Herdr ships a bundled Pi integration (`HERDR_INTEGRATION_ID=pi`). Current Kimchi is built on `@earendil-works/pi-coding-agent` **0.84.1**, whose runtime emits `agent_settled` (the higher-level "truly done" event) in interactive mode. This repository ships a kimchi-versioned copy of that integration so that:

- it is a known-good, pinned version for Kimchi users, and
- it is not silently overwritten by Herdr's generic `herdr integration install pi` step.

This copy tracks Herdr's **v8** Pi integration: it drives the `idle` transition from `agent_settled` (guarded by `ctx.isIdle()`), and gates activation on Kimchi's TUI mode.

> **Older Kimchi:** if your Kimchi runs a Pi runtime that does **not** emit `agent_settled` (for example `0.79.10`), use the previous revision of this file, which tracked Herdr's integration via the `agent_end` event instead. Prefer upgrading Kimchi; `agent_settled` reflects a truly settled turn (no auto-retry or compaction continuation), which `agent_end` alone does not.

## Install

### One-liner from GitHub

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/getkimchi/herdr-kimchi/main/herdr-agent-state.ts \
  -o ~/.config/kimchi/harness/extensions/herdr-agent-state.ts
```

### Manual copy

Copy `herdr-agent-state.ts` into Kimchi's extensions directory:

```bash
# macOS / Linux
cp herdr-agent-state.ts ~/.config/kimchi/harness/extensions/

# Windows
# %LOCALAPPDATA%\kimchi\harness\extensions\
```

Then restart Kimchi (or the Herdr pane running Kimchi).

## How it works

When Herdr spawns a pane running Kimchi, it sets three environment variables:

- `HERDR_ENV=1`
- `HERDR_SOCKET_PATH` — path to Herdr's local Unix socket or Windows named pipe
- `HERDR_PANE_ID` — the Herdr pane identifier

The extension reads these, connects to the socket, and sends JSON-RPC-style messages for lifecycle events:

- `pane.report_agent_session` — when a session starts, carrying the session file path
- `pane.report_agent` — whenever state changes (`idle`/`working`/`blocked`)

It reports `source: "kimchi-bridge"` and `agent: "kimchi"`. A custom source is required: Herdr only honors `herdr:`-namespaced integration reports (like `herdr:pi`) for panes it natively detects as that agent. A `kimchi` process is not a natively detected Pi agent, so a `herdr:pi` report is silently dropped. Reporting a plain source (e.g. `kimchi-bridge`) registers the pane as an agent in any pane herdr manages.

Both values can be overridden per pane with environment variables, so you can run multiple distinct Kimchi agents: set `KIMCHI_AGENT_NAME` (default `kimchi`) and optionally `KIMCHI_AGENT_SOURCE` (default `kimchi-bridge`) on the pane that launches Kimchi.

### Session storage in herdr (`HERDR_AGENT=pi`)

herdr only persists native session references from official `herdr:` integration sources, and only
for panes it natively detects as that agent. The plain `kimchi-bridge` source registers agent state
(label, `working`/`idle`) but the session is never stored, and `herdr:pi` reports from a pane herdr
does not detect as pi are dropped.

Launching Kimchi with `HERDR_AGENT=pi` — herdr's escape hatch for wrapper-hidden agents — fixes
both sides: herdr natively treats the pane's process as pi, and the bridge then automatically
reports through the official pi channel (`source: "herdr:pi"`, `agent: "pi"`). The session lands
as a native `herdr:pi` reference pointing at the Kimchi session file (pi-format JSONL), so
pi-aware tools such as token dashboards pick Kimchi panes up.

```sh
HERDR_AGENT=pi kimchi
```

- The pane's agent label shows as `pi` rather than `kimchi` (required: a report whose agent name
  does not match the official source is ignored). `herdr agent rename <pane> kimchi` restores the
  display name per pane.
- Explicit `KIMCHI_AGENT_SOURCE` / `KIMCHI_AGENT_NAME` overrides keep their precedence over the
  automatic pi reporting.

## Compatibility

- Kimchi built on `@earendil-works/pi-coding-agent` that emits `agent_settled` (present from `0.81.0` in the RPC API; Kimchi currently pins `0.84.1`, verified)
- Herdr with Pi integration support (v8)

## License

Apache-2.0
