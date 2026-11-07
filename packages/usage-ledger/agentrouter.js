import { createHash } from 'node:crypto';

const ENDPOINTS = { cn: 'ps.air-outer.com', intl: 'agentrouter.org' };
const USAGE_PATH = '/api/usage/token/';
const STATUS_PATH = '/api/status';
const MAX_BODY_BYTES = 256 * 1024;

/** Resolve only AgentRouter's current route; never expose config or credentials to the Client. */
export function agentRouterConnection(ctx) {
	const editor = ctx.get('configEditor');
	const settings = ctx.get('settings');
	if (editor === undefined || settings === undefined) return null;
	const entries = editor.entries();
	const entry = entries.find((item) => item.options.name === 'dsh-llm-agentrouter');
	if (entry === undefined || entry.fiber === undefined || entry.options.disabled === true) return null;
	const forms = settings.describe({ redactSecrets: true });
	const formFor = (id) => forms.find((form) => form.ns === id || form.ns === `include:${id}`)?.value;
	const config = entry.options.config ?? {};
	const live = formFor(entry.options.id);
	if (live === undefined) return null;
	const endpoint = live?.endpoint ?? config.endpoint ?? 'cn';
	const hosts = config.endpoints ?? ENDPOINTS;
	const host = hosts?.[endpoint];
	if (typeof host !== 'string' || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host.trim())) {
		throw new Error('invalid-config');
	}
	const piEntry = entries.find((item) => item.options.name === '@deepseek-ai/dsh-llm-pi-ai');
	const route = piEntry === undefined ? undefined : formFor(piEntry.options.id)?.providers?.agentrouter;
	const sentinel = config.sentinel ?? 'relay.agentrouter.internal';
	const url = new URL(route?.baseURL ?? `https://${host.trim()}`);
	if (url.hostname === sentinel) url.host = host.trim();
	if (url.protocol !== 'https:' || url.username || url.password || url.hostname.endsWith('.internal')) {
		throw new Error('invalid-config');
	}
	const credentialRef = route?.apiKeyEnv ?? 'AGENTROUTER_API_KEY';
	if (typeof credentialRef !== 'string' || credentialRef.trim().length === 0) throw new Error('invalid-config');
	return { origin: url.origin, credentialRef };
}

function number(value) {
	if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

/** New API's quota values are not token counts or dollars unless status confirms the scale. */
export function quotaUnit(body) {
	const data = body?.success === true ? body.data : undefined;
	const perUnit = number(data?.quota_per_unit);
	if (!(perUnit > 0)) return { currency: null, factor: 1, quotaPerUnit: null };
	const type = data.quota_display_type;
	if (type === 'USD' || ((type === undefined || type === null) && data.display_in_currency === true)) {
		return { currency: 'USD', factor: 1 / perUnit, quotaPerUnit: perUnit };
	}
	if (type === 'CNY') {
		const exchange = number(data.usd_exchange_rate);
		if (exchange > 0) return { currency: 'CNY', factor: exchange / perUnit, quotaPerUnit: perUnit };
	}
	return { currency: null, factor: 1, quotaPerUnit: perUnit };
}

/** Allowlisted DTO: a key quota is deliberately distinct from the optional account quota. */
export function normalizeAgentRouterUsage(body, statusBody) {
	const data = body?.code === true || body?.success === true ? body.data : undefined;
	if (data?.object !== 'token_usage' || typeof data.unlimited_quota !== 'boolean') return null;
	const total = number(data.total_granted);
	const used = number(data.total_used);
	const balance = number(data.total_available);
	const expiry = number(data.expires_at);
	if (total === null || total < 0 || used === null || used < 0 || balance === null ||
		expiry === null || !Number.isInteger(expiry) || expiry < -1 || expiry > 8_640_000_000_000) return null;
	const unit = quotaUnit(statusBody);
	const unlimited = data.unlimited_quota;
	const result = {
		status: 'ready',
		scope: 'key',
		currency: unit.currency,
		quotaPerUnit: unit.quotaPerUnit,
		unlimited,
		total: unlimited ? null : total * unit.factor,
		used: used * unit.factor,
		balance: unlimited ? null : balance * unit.factor,
		expiresAt: expiry > 0 ? expiry : null,
		rawQuota: { total, used, balance }
	};
	const accountBalance = number(data.user_quota?.total_available);
	const accountUsed = number(data.user_quota?.total_used);
	if (accountBalance !== null && accountUsed !== null && accountUsed >= 0) {
		result.account = { balance: accountBalance * unit.factor, used: accountUsed * unit.factor };
	}
	return result;
}

async function readJson(response) {
	const reader = response.body?.getReader();
	if (reader === undefined) throw new Error('invalid-response');
	const chunks = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > MAX_BODY_BYTES) throw new Error('invalid-response');
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export async function fetchJson(fetchImpl, origin, path, headers, signal) {
	let response = await fetchImpl(origin + path, { method: 'GET', headers, signal, redirect: 'manual' });
	// Some New API versions canonicalize the one trailing slash. No cross-origin redirects.
	if ([301, 302, 307, 308].includes(response.status)) {
		const location = response.headers.get('location');
		await response.body?.cancel();
		const next = location === null ? null : new URL(location, origin + path);
		if (next === null || next.origin !== origin || next.username || next.password || next.search || next.hash ||
			!([USAGE_PATH, USAGE_PATH.slice(0, -1)].includes(path) &&
			[USAGE_PATH, USAGE_PATH.slice(0, -1)].includes(next.pathname))) {
			return { error: 'redirect', code: response.status };
		}
		response = await fetchImpl(next.href, { method: 'GET', headers, signal, redirect: 'manual' });
	}
	const type = response.headers.get('content-type')?.toLowerCase() ?? '';
	if (type.includes('text/html')) {
		await response.body?.cancel();
		return { error: 'waf', code: response.status };
	}
	if (!response.ok) {
		await response.body?.cancel();
		const error = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' :
			response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'server-error' : 'unsupported';
		return { error, code: response.status };
	}
	if (!/\bapplication\/(?:[\w.-]+\+)?json\b/.test(type)) {
		await response.body?.cancel();
		return { error: 'invalid-response', code: response.status };
	}
	try {
		return { body: await readJson(response) };
	} catch (error) {
		if (signal.aborted) throw error;
		return { error: 'invalid-response', code: response.status };
	}
}

/** Per-instance, single-flight cache; key changes invalidate it before any value is served. */
export function createAgentRouterReader({
	getConnection,
	resolveCredential,
	fetchImpl = (...args) => globalThis.fetch(...args),
	now = Date.now,
	ttlMs = 60_000,
	maxStaleMs = 15 * 60_000,
	timeoutMs = 12_000
}) {
	let scope;
	let cached;
	let cachedAt = 0;
	let good;
	let inflight;
	let controller;
	let disposed = false;
	let generation = 0;
	const clear = () => {
		generation += 1;
		controller?.abort();
		scope = undefined;
		cached = undefined;
		good = undefined;
		inflight = undefined;
	};
	const read = async () => {
		if (disposed) return { status: 'failed', reason: 'unavailable' };
		let connection;
		let key;
		try {
			connection = getConnection();
			if (connection === null || connection === undefined) {
				clear();
				return { status: 'provider-unavailable' };
			}
			key = await resolveCredential(connection.credentialRef);
		} catch {
			clear();
			return { status: 'failed', reason: 'configuration' };
		}
		if (typeof key !== 'string' || key.trim().length === 0) {
			clear();
			return { status: 'missing', origin: connection.origin };
		}
		if (disposed) return { status: 'failed', reason: 'unavailable' };
		const identity = createHash('sha256').update(connection.origin + '\0' + connection.credentialRef + '\0' + key).digest('hex');
		if (identity !== scope) {
			clear();
			scope = identity;
		}
		if (inflight !== undefined) return inflight;
		if (cached !== undefined && now() - cachedAt < ttlMs && (cached.stale !== true || now() - cached.at <= maxStaleMs)) return cached;
		const active = new AbortController();
		controller = active;
		const timer = setTimeout(() => active.abort(), timeoutMs);
		const stamp = generation;
		inflight = (async () => {
			let fresh;
			try {
				const headers = { authorization: `Bearer ${key}`, accept: 'application/json' };
				const [usage, status] = await Promise.all([
					fetchJson(fetchImpl, connection.origin, USAGE_PATH, headers, active.signal),
					// The public status endpoint needs no API key.
					fetchJson(fetchImpl, connection.origin, STATUS_PATH, { accept: 'application/json' }, active.signal)
						.catch(() => ({}))
				]);
				fresh = usage.error
					? { status: 'failed', reason: usage.error, code: usage.code }
					: normalizeAgentRouterUsage(usage.body, status.body) ?? { status: 'failed', reason: 'invalid-response' };
			} catch {
				fresh = { status: 'failed', reason: active.signal.aborted ? 'timeout' : 'network' };
			} finally {
				clearTimeout(timer);
				active.abort();
			}
			// A completed old-key request cannot populate a new-key cache or reach its callers.
			if (disposed || generation !== stamp) return { status: 'failed', reason: 'configuration-changed' };
			const at = now();
			const transient = fresh.status === 'failed' && !['unauthorized', 'forbidden'].includes(fresh.reason);
			if (fresh.status === 'ready') {
				good = { ...fresh, origin: connection.origin, at, stale: false };
				cached = good;
			} else if (transient && good !== undefined && at - good.at <= maxStaleMs) {
				cached = { ...good, stale: true, reason: fresh.reason, lastAttemptAt: at };
			} else {
				good = undefined;
				cached = { ...fresh, origin: connection.origin, at, stale: false };
			}
			cachedAt = at;
			return cached;
		})().finally(() => {
			if (generation === stamp) inflight = undefined;
		});
		return inflight;
	};
	return { read, dispose() { disposed = true; clear(); } };
}
