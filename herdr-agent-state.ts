// installed by herdr-kimchi
// managed by herdr-kimchi; reinstalling or updating the integration overwrites this file.
// add custom hooks/plugins beside this file instead of editing it.
// HERDR_INTEGRATION_ID=pi
// HERDR_INTEGRATION_VERSION=6

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import net from "node:net"

const HERDR_ENV = process.env.HERDR_ENV
const socketPath = process.env.HERDR_SOCKET_PATH
const socketEndpoint =
	process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath
const paneId = process.env.HERDR_PANE_ID
const source = "herdr:pi"

function enabled() {
	return HERDR_ENV === "1" && !!socketPath && !!paneId
}

function sendRequestAttempt(request: unknown, timeoutMs: number): Promise<boolean> {
	if (!enabled()) {
		return Promise.resolve(true)
	}

	return new Promise((resolve) => {
		let done = false
		let timeout: ReturnType<typeof setTimeout> | undefined
		const finish = (delivered: boolean) => {
			if (done) return
			done = true
			if (timeout) {
				clearTimeout(timeout)
			}
			socket.destroy()
			resolve(delivered)
		}

		const socket = net.createConnection(socketEndpoint!)
		socket.on("error", () => finish(false))
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`))
		socket.on("data", () => finish(true))
		socket.on("end", () => finish(false))
		timeout = setTimeout(() => finish(false), timeoutMs)
		timeout.unref?.()
	})
}

async function sendRequest(request: unknown): Promise<void> {
	if (await sendRequestAttempt(request, 500)) {
		return
	}
	await sendRequestAttempt(request, 1500)
}

type AgentState = "working" | "blocked" | "idle"

type QueuedState = {
	state: AgentState
	message?: string
	seq: number
}

let reportSeq = Date.now() * 1000
let currentAgentSessionId: string | undefined
let currentAgentSessionPath: string | undefined

function nextReportSeq(): number {
	reportSeq += 1
	return reportSeq
}

function updateSessionRef(ctx: any): void {
	try {
		const file = ctx?.sessionManager?.getSessionFile?.()
		currentAgentSessionPath =
			typeof file === "string" && file.startsWith("/") ? file : undefined
	} catch {
		currentAgentSessionPath = undefined
	}

	try {
		const id = ctx?.sessionManager?.getSessionId?.()
		currentAgentSessionId = typeof id === "string" && id.length > 0 ? id : undefined
	} catch {
		currentAgentSessionId = undefined
	}
}

function withSessionRef(params: Record<string, unknown>): Record<string, unknown> {
	if (currentAgentSessionPath) {
		return { ...params, agent_session_path: currentAgentSessionPath }
	}
	if (currentAgentSessionId) {
		return { ...params, agent_session_id: currentAgentSessionId }
	}
	return params
}

function currentSessionRef(): Record<string, unknown> | undefined {
	if (currentAgentSessionPath) {
		return { agent_session_path: currentAgentSessionPath }
	}
	if (currentAgentSessionId) {
		return { agent_session_id: currentAgentSessionId }
	}
	return undefined
}

function reportSession(sessionStartSource?: string): Promise<void> {
	const sessionRef = currentSessionRef()
	if (!sessionRef) {
		return Promise.resolve()
	}

	return sendRequest({
		id: `${source}:session:${Date.now()}:${Math.random().toString(36).slice(2)}`,
		method: "pane.report_agent_session",
		params: {
			pane_id: paneId,
			source,
			agent: "pi",
			seq: nextReportSeq(),
			session_start_source: sessionStartSource,
			...sessionRef,
		},
	})
}

function sendState(state: AgentState, message?: string, seq = nextReportSeq()): Promise<void> {
	return sendRequest({
		id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
		method: "pane.report_agent",
		params: withSessionRef({
			pane_id: paneId,
			source,
			agent: "pi",
			state,
			message,
			seq,
		}),
	})
}

function releaseAgent(): Promise<void> {
	return sendRequest({
		id: `${source}:release:${Date.now()}:${Math.random().toString(36).slice(2)}`,
		method: "pane.release_agent",
		params: {
			pane_id: paneId,
			source,
			agent: "pi",
			seq: nextReportSeq(),
		},
	})
}

function shouldReleaseOnSessionShutdown(event: any): boolean {
	const reason = event?.reason
	return reason === "quit"
}

let sendInFlight = false
let queuedState: QueuedState | undefined

function queueState(state: AgentState, message?: string): void {
	queuedState = { state, message, seq: nextReportSeq() }
	if (!sendInFlight) {
		void drainStateQueue()
	}
}

async function drainStateQueue(): Promise<void> {
	if (sendInFlight) {
		return
	}

	sendInFlight = true
	try {
		while (queuedState) {
			const next = queuedState
			queuedState = undefined
			await sendState(next.state, next.message, next.seq)
		}
	} finally {
		sendInFlight = false
		if (queuedState) {
			void drainStateQueue()
		}
	}
}

export default function (pi: ExtensionAPI): void {
	if (!enabled()) {
		return
	}

	let agentActive = false
	let blockedCount = 0
	let blockedMessage: string | undefined
	let lastState: AgentState | undefined
	let lastMessage: string | undefined
	let rootSession = false

	function desiredState() {
		if (blockedCount > 0) {
			return { state: "blocked" as const, message: blockedMessage }
		}
		if (agentActive) {
			return { state: "working" as const, message: undefined }
		}
		return { state: "idle" as const, message: undefined }
	}

	function publishState(force = false) {
		const next = desiredState()
		if (!force && next.state === lastState && next.message === lastMessage) {
			return
		}
		lastState = next.state
		lastMessage = next.message
		queueState(next.state, next.message)
	}

	pi.events.on("herdr:blocked", (data: any) => {
		if (!rootSession) {
			return
		}
		if (!data?.active) {
			blockedCount = Math.max(0, blockedCount - 1)
			if (blockedCount === 0) {
				blockedMessage = undefined
			}
			publishState()
			return
		}

		blockedCount += 1
		blockedMessage = data.label
		publishState()
	})

	pi.on("session_start", async (_event: any, ctx: any) => {
		if (ctx?.hasUI !== true) {
			return
		}
		rootSession = true
		updateSessionRef(ctx)
		await reportSession(_event?.reason)
		agentActive = ctx?.isIdle?.() === false
		publishState(true)
	})

	pi.on("agent_start", (_event: any, ctx: any) => {
		if (!rootSession) {
			return
		}
		updateSessionRef(ctx)
		void reportSession()
		agentActive = true
		publishState()
	})

	// Pi 0.79.10+ (including 0.84.1) emits `agent_end`. Herdr's bundled Pi
	// extension only listens for `agent_settled`, so the pane stays stuck in
	// `working` after a turn completes. Listen for `agent_end` so Herdr
	// transitions back to `idle` when the agent run is done.
	pi.on("agent_end", () => {
		if (!rootSession) {
			return
		}
		agentActive = false
		publishState()
	})

	pi.on("session_shutdown", async (event: any) => {
		if (!rootSession) {
			return
		}
		if (shouldReleaseOnSessionShutdown(event)) {
			await releaseAgent()
		}
	})
}
