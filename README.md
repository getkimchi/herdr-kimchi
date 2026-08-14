# herdr-kimchi

Herdr lifecycle bridge for [Kimchi](https://kimchi.dev/).

This is a Pi extension that Kimchi loads automatically when it starts inside a [Herdr](https://herdr.dev/) pane. It reports Kimchi's agent state (`idle`/`working`/`blocked`) and session references to Herdr over its local socket, so Herdr can:

- label the pane correctly in its sidebar,
- show `working` while Kimchi is generating,
- transition back to `idle` when the turn completes,
- restore the Kimchi session after a Herdr server restart.

## Why this exists

Kimchi is built on `@earendil-works/pi-coding-agent` `0.79.10`. Herdr's bundled Pi extension expects a newer Pi runtime that emits `agent_settled`, which does not exist in `0.79.10`. Without this bridge, a Kimchi pane inside Herdr stays stuck on `working` forever after the first turn.

This extension listens for the `agent_end` event that Pi `0.79.10` actually emits, so state transitions work correctly.

## Install

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
- `pane.release_agent` — when the session shuts down due to `quit`

It reports `source: "herdr:pi"` and `agent: "pi"` so it is compatible with Herdr's existing Pi integration today. A future version will switch to `herdr:kimchi` / `kimchi` once Herdr lands a dedicated Kimchi integration.

## Compatibility

- Kimchi `0.79.10` and later
- Herdr with Pi integration support

## License

Apache-2.0
