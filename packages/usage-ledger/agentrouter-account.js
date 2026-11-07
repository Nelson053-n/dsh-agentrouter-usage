import { createHash, randomBytes } from 'node:crypto';
import { fetchJson, quotaUnit } from './agentrouter.js';

export const ACCOUNT_RECORD = 'usage-ledger/agentrouter-account';
export const ACCOUNT_PATH = '/api/token-usage/agentrouter/account';
export const BINDING_PATH = ACCOUNT_PATH + '/binding';
const BODY_LIMIT = 12 * 1024;

function numeric(value) {
	if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+$/.test(value))) return null;
	const n = Number(value);
	return Number.isSafeInteger(n) ? n : null;
}

function canonicalOrigin(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && url.origin === value ? url.origin : null;
	} catch { return null; }
}

function validToken(value) {
	return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value) && !value.startsWith('sk-');
}

export function accountCredential(record) {
	const value = record?.kind === 'grant' ? record.payload : undefined;
	const userId = numeric(value?.userId);
	if (value?.version !== 1 || !(userId > 0) || !validToken(value.token) || canonicalOrigin(value.origin) === null) return null;
	return { token: value.token, userId: String(userId), origin: value.origin };
}

/** Only balance fields cross the wire; GetSelf can also return private identity and tokens. */
export function normalizeAgentRouterAccount(body, status, expectedUserId) {
	const data = body?.success === true ? body.data : undefined;
	const id = numeric(data?.id);
	const balance = numeric(data?.quota);
	const used = data?.used_quota === undefined ? null : numeric(data.used_quota);
	const requests = data?.request_count === undefined ? null : numeric(data.request_count);
	if (!(id > 0) || String(id) !== String(expectedUserId) || balance === null ||
		(data.used_quota !== undefined && (used === null || used < 0)) ||
		(data.request_count !== undefined && (requests === null || requests < 0))) return null;
	let unit = quotaUnit(status);
	if (![balance, used ?? 0].every((value) => Number.isFinite(value * unit.factor))) unit = { currency: null, factor: 1, quotaPerUnit: null };
	return { status: 'ready', scope: 'account', currency: unit.currency, quotaPerUnit: unit.quotaPerUnit,
		balance: balance * unit.factor, used: used === null ? null : used * unit.factor, requests };
}

async function loadAccount(auth, { fetchImpl, signal }) {
	const [self, status] = await Promise.all([
		fetchJson(fetchImpl, auth.origin, '/api/user/self', {
			authorization: `Bearer ${auth.token}`, 'new-api-user': auth.userId, accept: 'application/json'
		}, signal),
		fetchJson(fetchImpl, auth.origin, '/api/status', { accept: 'application/json' }, signal).catch(() => ({}))
	]);
	if (self.error) return { status: 'failed', reason: self.error, code: self.code };
	if (self.body?.success === false) return { status: 'failed', reason: 'account-refused' };
	return normalizeAgentRouterAccount(self.body, status.body, auth.userId) ?? { status: 'failed', reason: 'invalid-response' };
}

function fingerprint(value) {
	return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/** Host-owned account operations. Grant/revoke are reachable only through the browser-only route. */
export function createAgentRouterAccount({ getCredentials, getConnection,
	fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now,
	ttlMs = 60_000, maxStaleMs = 15 * 60_000, timeoutMs = 12_000 }) {
	let descriptorScope;
	let revision;
	let cacheScope;
	let cache;
	let cacheAt = 0;
	let good;
	let inflight;
	let epoch = 0;
	let closed = false;
	let busy = false;
	const controllers = new Set();
	const readControllers = new Set();
	const invalidate = () => {
		epoch += 1;
		for (const active of readControllers) active.abort();
		cacheScope = undefined;
		cache = undefined;
		good = undefined;
		inflight = undefined;
	};
	const inspect = async () => {
		const credentials = getCredentials();
		if (credentials === undefined) throw new Error('storage');
		const record = await credentials.readRecord(ACCOUNT_RECORD);
		const auth = accountCredential(record);
		let origin = null;
		try { origin = getConnection()?.origin ?? null; } catch { /* Saved account remains pinned to its original origin. */ }
		const scope = fingerprint({ record, origin });
		if (scope !== descriptorScope) {
			descriptorScope = scope;
			revision = randomBytes(18).toString('base64url');
		}
		return { credentials, record, auth, recordScope: fingerprint(record),
			binding: { configured: auth !== null, available: origin !== null, origin: auth?.origin ?? origin,
				connectOrigin: origin, userId: auth?.userId ?? null, revision } };
	};
	const probe = async (auth, signal, cacheRead = false) => {
		const active = new AbortController();
		controllers.add(active);
		if (cacheRead) readControllers.add(active);
		const joined = signal === undefined ? active.signal : AbortSignal.any([signal, active.signal]);
		const timer = setTimeout(() => active.abort(), timeoutMs);
		try { return await loadAccount(auth, { fetchImpl, signal: joined }); }
		catch { return { status: 'failed', reason: joined.aborted ? 'timeout' : 'network' }; }
		finally { clearTimeout(timer); active.abort(); controllers.delete(active); readControllers.delete(active); }
	};
	const read = async () => {
		if (closed) return { status: 'failed', reason: 'unavailable' };
		let state;
		try { state = await inspect(); } catch { invalidate(); return { status: 'failed', reason: 'storage' }; }
		if (closed) return { status: 'failed', reason: 'unavailable' };
		if (state.auth === null) {
			invalidate();
			return { status: state.record === undefined ? 'unconnected' : 'failed', reason: state.record === undefined ? undefined : 'storage', binding: state.binding };
		}
		if (cacheScope !== state.recordScope) { invalidate(); cacheScope = state.recordScope; }
		if (inflight !== undefined) return { ...await inflight, binding: state.binding };
		if (cache !== undefined && now() - cacheAt < ttlMs && (cache.stale !== true || now() - cache.at <= maxStaleMs)) return { ...cache, binding: state.binding };
		const started = epoch;
		inflight = (async () => {
			const fresh = await probe(state.auth, undefined, true);
			if (closed || epoch !== started) return { status: 'failed', reason: 'configuration-changed' };
			// Re-resolve after the request as well: another browser/process can remove or replace the grant.
			let current;
			try { current = await inspect(); } catch { return { status: 'failed', reason: 'storage' }; }
			if (current.recordScope !== state.recordScope || closed || epoch !== started) return { status: 'failed', reason: 'configuration-changed' };
			const at = now();
			if (fresh.status === 'ready') good = { ...fresh, at, stale: false, origin: state.auth.origin };
			const transient = fresh.status === 'failed' && !['unauthorized', 'forbidden', 'account-refused'].includes(fresh.reason);
			if (fresh.status !== 'ready' && (!transient || good === undefined || at - good.at > maxStaleMs)) good = undefined;
			cache = fresh.status === 'ready' ? good : good !== undefined
				? { ...good, stale: true, reason: fresh.reason, lastAttemptAt: at }
				: { ...fresh, at, stale: false, origin: state.auth.origin };
			cacheAt = at;
			return cache;
		})().finally(() => { if (epoch === started) inflight = undefined; });
		return { ...await inflight, binding: state.binding };
	};
	const connect = async (input, signal) => {
		if (closed) return { ok: false, reason: 'unavailable', httpStatus: 503 };
		if (busy) return { ok: false, reason: 'busy', httpStatus: 409 };
		const userId = numeric(typeof input?.userId === 'string' ? input.userId.trim() : input?.userId);
		const token = typeof input?.token === 'string' ? input.token.trim() : null;
		if (!(userId > 0) || !validToken(token)) return { ok: false, reason: token?.startsWith('sk-') ? 'wrong-token-kind' : 'invalid-input', httpStatus: 400 };
		busy = true;
		try {
			const before = await inspect();
			if (input.revision !== before.binding.revision) return { ok: false, reason: 'configuration-changed', httpStatus: 409 };
			if (before.binding.connectOrigin === null || input.origin !== before.binding.connectOrigin) return { ok: false, reason: 'configuration', httpStatus: 409 };
			const auth = { token, userId: String(userId), origin: before.binding.connectOrigin };
			const fresh = await probe(auth, signal);
			if (fresh.status !== 'ready') return { ok: false, reason: fresh.reason, code: fresh.code, httpStatus: 502 };
			if (closed || signal?.aborted) return { ok: false, reason: 'configuration-changed', httpStatus: 409 };
			const after = await inspect();
			if (after.binding.revision !== input.revision) return { ok: false, reason: 'configuration-changed', httpStatus: 409 };
			const next = { kind: 'grant', payload: { version: 1, ...auth } };
			await before.credentials.modifyRecord(ACCOUNT_RECORD, async (current) => {
				if (closed || signal?.aborted || fingerprint(current) !== before.recordScope) throw new Error('changed');
				return next;
			});
			invalidate();
			const saved = await inspect();
			cacheScope = saved.recordScope;
			good = { ...fresh, at: now(), stale: false, origin: auth.origin };
			cache = good;
			cacheAt = good.at;
			return { ok: true, value: { ...good, binding: saved.binding } };
		} catch { return { ok: false, reason: 'storage', httpStatus: 503 }; }
		finally { busy = false; }
	};
	const disconnect = async (input) => {
		if (closed) return { ok: false, reason: 'unavailable', httpStatus: 503 };
		if (busy) return { ok: false, reason: 'busy', httpStatus: 409 };
		busy = true;
		try {
			const before = await inspect();
			if (input?.revision !== before.binding.revision) return { ok: false, reason: 'configuration-changed', httpStatus: 409 };
			invalidate();
			await before.credentials.deleteRecord(ACCOUNT_RECORD);
			const state = await inspect();
			return { ok: true, value: { status: 'unconnected', binding: state.binding } };
		} catch { return { ok: false, reason: 'storage', httpStatus: 503 }; }
		finally { busy = false; }
	};
	return { read, connect, disconnect, dispose() { closed = true; invalidate(); for (const active of controllers) active.abort(); } };
}

export function jsonResponse(value, status = 200) {
	return new Response(JSON.stringify(value), { status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

/** GET resources require the same admission as the existing authenticated Web GUI. */
export function authenticatedResource(ctx, handler) {
	return async (request, peer) => {
		const connection = ctx.get('connection');
		if (connection === undefined) return jsonResponse({ status: 'failed', reason: 'unavailable' }, 503);
		if (peer === undefined) {
			const admission = connection.admit(request);
			if ('rejection' in admission) return jsonResponse({ status: 'failed', reason: 'unauthorized' }, admission.rejection);
			peer = admission.peer;
		}
		if (peer.principal.kind !== 'owner') return jsonResponse({ status: 'failed', reason: 'forbidden' }, 403);
		return handler(request);
	};
}

async function readBindingBody(request) {
	const reader = request.body?.getReader();
	if (reader === undefined) throw new Error('body');
	const chunks = [];
	let count = 0;
	let timedOut = false;
	const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (timedOut || request.signal.aborted) throw new Error('body');
			if (done) break;
			count += value.byteLength;
			if (count > BODY_LIMIT) throw new Error('body');
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks, count).toString('utf8'));
	} finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** No tool or generic API Peer can save/revoke this grant; only the authenticated browser Peer. */
export function installAccountRoutes(ctx, service) {
	const connection = ctx.get('connection');
	if (connection === undefined) return;
	ctx.effect(() => connection.fetch.register({
		path: ACCOUNT_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered',
		fetch: async (request) => {
			const admission = connection.admit(request);
			if ('rejection' in admission) return jsonResponse({ ok: false, reason: 'unauthorized' }, admission.rejection);
			if (admission.peer !== connection.browserPeer) return jsonResponse({ ok: false, reason: 'browser-only' }, 403);
			const response = jsonResponse(await service.read());
			return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
		}
	}), 'usage-ledger: account read route');
	ctx.effect(() => connection.fetch.register({
		path: BINDING_PATH, methods: ['POST'], requestBody: 'streaming',
		fetch: async (request) => {
			const admission = connection.admit(request);
			if ('rejection' in admission) return jsonResponse({ ok: false, reason: 'unauthorized' }, admission.rejection);
			if (admission.peer !== connection.browserPeer) return jsonResponse({ ok: false, reason: 'browser-only' }, 403);
			if (request.headers.get('x-dsh-usage-action') !== 'account-binding' ||
				request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
				return jsonResponse({ ok: false, reason: 'invalid-input' }, 415);
			}
			let body;
			try { body = await readBindingBody(request); } catch { return jsonResponse({ ok: false, reason: 'invalid-input' }, 400); }
			if (body === null || typeof body !== 'object' || Array.isArray(body) ||
				!['connect', 'disconnect'].includes(body.action) || typeof body.revision !== 'string' || body.revision.length > 64 ||
				Object.keys(body).some((key) => !['action', 'revision', 'origin', 'token', 'userId'].includes(key))) {
				return jsonResponse({ ok: false, reason: 'invalid-input' }, 400);
			}
			const result = body.action === 'connect' ? await service.connect(body, request.signal) : await service.disconnect(body);
			const { httpStatus = result.ok ? 200 : 400, ...output } = result;
			return jsonResponse(output, httpStatus);
		}
	}), 'usage-ledger: browser-only account binding');
}
