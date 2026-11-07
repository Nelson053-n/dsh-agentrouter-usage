import assert from 'node:assert/strict';
import test from 'node:test';
import { agentRouterConnection, createAgentRouterReader, normalizeAgentRouterUsage, quotaUnit } from '../agentrouter.js';
import { apply } from '../index.js';

const STATUS = { success: true, data: { quota_per_unit: 500000, display_in_currency: true } };
const USAGE = { code: true, data: {
	object: 'token_usage', name: 'private label', total_granted: 50000000,
	total_used: 12500000, total_available: 37500000, unlimited_quota: false,
	expires_at: 0, model_limits: {}, model_limits_enabled: false
} };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const modified = (fields) => ({ ...USAGE, data: { ...USAGE.data, ...fields } });

function fixture(options = {}) {
	let clock = 1_800_000_000_000;
	let key = 'test-key-A';
	let target = { origin: 'https://agentrouter.example', credentialRef: 'AGENTROUTER_API_KEY' };
	let response = () => json(USAGE);
	const requests = [];
	const reader = createAgentRouterReader({
		getConnection: () => target,
		resolveCredential: async () => key,
		fetchImpl: async (url, init) => {
			requests.push({ url, ...init });
			if (url.endsWith('/api/status')) return json(STATUS);
			return response(url, init);
		},
		now: () => clock,
		...options
	});
	return { ...reader, requests, advance: (ms) => { clock += ms; },
		setKey: (value) => { key = value; }, setTarget: (value) => { target = value; },
		respond: (fn) => { response = fn; } };
}

test('confirmed currency scale converts quota, not token counts; private fields are excluded', () => {
	const value = normalizeAgentRouterUsage(USAGE, STATUS);
	assert.equal(value.balance, 75);
	assert.equal(value.used, 25);
	assert.equal(value.total, 100);
	assert.equal(value.currency, 'USD');
	assert.equal(value.expiresAt, null);
	assert.equal(value.name, undefined);
	assert.equal(value.model_limits, undefined);
	assert.equal(value.account, undefined);
	assert.deepEqual(value.rawQuota, { total: 50000000, used: 12500000, balance: 37500000 });
});

test('unknown or disabled currency presentation stays in raw quota units', () => {
	for (const status of [undefined, { success: false }, { success: true, data: { quota_per_unit: 0 } },
		{ success: true, data: { quota_per_unit: 500000, display_in_currency: false } },
		{ success: true, data: { quota_per_unit: 500000, quota_display_type: 'CUSTOM', display_in_currency: true } }]) {
		const value = normalizeAgentRouterUsage(USAGE, status);
		assert.equal(value.currency, null);
		assert.equal(value.balance, 37500000);
	}
	assert.deepEqual(quotaUnit({ success: true, data: { quota_per_unit: 500000, quota_display_type: 'CNY', usd_exchange_rate: 7.12 } }),
		{ currency: 'CNY', factor: 7.12 / 500000, quotaPerUnit: 500000 });
});

test('unlimited applies only to the key, never invents an infinite account balance', () => {
	const value = normalizeAgentRouterUsage(modified({ unlimited_quota: true, expires_at: -1,
		user_quota: { total_available: 5000000, total_used: 10000000 } }), STATUS);
	assert.equal(value.unlimited, true);
	assert.equal(value.balance, null);
	assert.equal(value.total, null);
	assert.equal(value.used, 25);
	assert.equal(value.expiresAt, null);
	assert.deepEqual(value.account, { balance: 10, used: 20 });
});

test('zero, negative remaining quota, and a past expiry retain their meaning', () => {
	const zero = normalizeAgentRouterUsage(modified({ total_used: 0, total_available: 0, total_granted: 0 }), STATUS);
	assert.equal(zero.balance, 0);
	assert.equal(zero.used, 0);
	assert.equal(zero.unlimited, false);
	const debt = normalizeAgentRouterUsage(modified({ total_available: -500000, expires_at: 1700000000 }), STATUS);
	assert.equal(debt.balance, -1);
	assert.equal(debt.expiresAt, 1700000000);
});

test('malformed and denied payloads do not turn missing values into zero', () => {
	for (const data of [null, {}, { code: false, data: USAGE.data }, modified({ total_used: null }),
		modified({ total_available: '' }), modified({ total_used: false }), modified({ total_granted: 'Infinity' }),
		modified({ unlimited_quota: 'false' }), modified({ expires_at: 'bad' }), modified({ expires_at: 1.5 }),
		modified({ expires_at: -2 }), modified({ total_used: -1 }), modified({ object: 'credit_summary' })]) {
		assert.equal(normalizeAgentRouterUsage(data, STATUS), null);
	}
});

function fakeContext({ endpoint = 'cn', config = {}, route = {}, enabled = true } = {}) {
	const entries = [
		{ options: { id: 'llm-agentrouter', name: 'dsh-llm-agentrouter', config, disabled: !enabled }, fiber: {} },
		{ options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }, fiber: {} }
	];
	const forms = [
		{ ns: 'llm-agentrouter', value: { endpoint } },
		{ ns: 'llm-pi-ai', value: { providers: { agentrouter: { apiKeyEnv: 'AGENTROUTER_API_KEY',
			baseURL: 'https://relay.agentrouter.internal/v1', ...route } } } }
	];
	return { get(name) {
		if (name === 'configEditor') return { entries: () => entries };
		if (name === 'settings') return { describe: (options) => { assert.equal(options.redactSecrets, true); return forms; } };
	} };
}

test('connection follows live endpoint, custom hosts and the provider credential reference', () => {
	assert.deepEqual(agentRouterConnection(fakeContext()), { origin: 'https://ps.air-outer.com', credentialRef: 'AGENTROUTER_API_KEY' });
	assert.equal(agentRouterConnection(fakeContext({ endpoint: 'intl' })).origin, 'https://agentrouter.org');
	assert.deepEqual(agentRouterConnection(fakeContext({ config: { endpoints: { cn: 'relay.example' } },
		route: { apiKeyEnv: 'CUSTOM_AGENTROUTER_KEY' } })), { origin: 'https://relay.example', credentialRef: 'CUSTOM_AGENTROUTER_KEY' });
	assert.equal(agentRouterConnection(fakeContext({ route: { baseURL: 'https://custom-relay.example/v1' } })).origin, 'https://custom-relay.example');
	assert.equal(agentRouterConnection(fakeContext({ enabled: false })), null);
	assert.equal(agentRouterConnection({ get() {} }), null);
	assert.throws(() => agentRouterConnection(fakeContext({ route: { baseURL: 'http://relay.example/v1' } })));
	assert.throws(() => agentRouterConnection(fakeContext({ route: { baseURL: 'https://user:password@relay.example/v1' } })));
});

test('missing key or integration makes no external request', async () => {
	const reader = fixture();
	reader.setKey(undefined);
	assert.equal((await reader.read()).status, 'missing');
	reader.setTarget(null);
	assert.equal((await reader.read()).status, 'provider-unavailable');
	assert.equal(reader.requests.length, 0);
	reader.dispose();
});

test('requests are read-only, credentials go only to usage, and results share a TTL cache', async () => {
	const reader = fixture();
	const [a, b] = await Promise.all([reader.read(), reader.read()]);
	assert.deepEqual(a, b);
	assert.equal(a.status, 'ready');
	assert.equal(reader.requests.length, 2);
	for (const request of reader.requests) {
		assert.equal(request.method, 'GET');
		assert.equal(request.redirect, 'manual');
		assert.equal(request.body, undefined);
	}
	assert.equal(reader.requests[0].headers.authorization, 'Bearer test-key-A');
	assert.equal(reader.requests[1].headers.authorization, undefined);
	assert.equal(JSON.stringify(a).includes('test-key'), false);
	await reader.read();
	assert.equal(reader.requests.length, 2);
	reader.advance(60001);
	await reader.read();
	assert.equal(reader.requests.length, 4);
	reader.dispose();
});

test('transient errors retain bounded, explicitly stale data and the original timestamp', async () => {
	const reader = fixture();
	const first = await reader.read();
	reader.advance(60001);
	reader.respond(() => { throw new Error('network contains a secret that must never be exposed'); });
	const cached = await reader.read();
	assert.equal(cached.status, 'ready');
	assert.equal(cached.stale, true);
	assert.equal(cached.reason, 'network');
	assert.equal(cached.at, first.at);
	assert.equal(JSON.stringify(cached).includes('secret'), false);
	reader.advance(16 * 60000);
	assert.equal((await reader.read()).status, 'failed');
	reader.dispose();
});

test('rotating or removing a credential never serves another key\'s last good value', async () => {
	const reader = fixture();
	await reader.read();
	reader.setKey('test-key-B');
	reader.respond(() => json({ success: false, message: 'private' }, 401));
	const next = await reader.read();
	assert.equal(next.status, 'failed');
	assert.equal(next.reason, 'unauthorized');
	assert.equal(next.balance, undefined);
	reader.setKey(undefined);
	assert.equal((await reader.read()).status, 'missing');
	reader.dispose();
});

test('authentication and permission failures invalidate old data', async () => {
	for (const status of [401, 403]) {
		const reader = fixture();
		await reader.read();
		reader.advance(60001);
		reader.respond(() => json({ success: false }, status));
		const result = await reader.read();
		assert.equal(result.status, 'failed');
		assert.equal(result.stale, false);
		assert.equal(result.balance, undefined);
		reader.dispose();
	}
});

test('HTML protection pages, even HTTP 200/403, are not zero or a JSON permission error', async () => {
	for (const status of [200, 403]) {
		const reader = fixture();
		reader.respond(() => new Response('<html>CF_APP_WAF</html>', { status, headers: { 'content-type': 'text/html' } }));
		const value = await reader.read();
		assert.equal(value.status, 'failed');
		assert.equal(value.reason, 'waf');
		assert.equal(value.code, status);
		assert.equal(value.balance, undefined);
		reader.dispose();
	}
});

test('never follows an external redirect with the API key', async () => {
	const reader = fixture();
	reader.respond(() => new Response(null, { status: 302, headers: { location: 'https://other.example/collect' } }));
	assert.equal((await reader.read()).reason, 'redirect');
	assert.equal(reader.requests.length, 2);
	reader.dispose();
});

test('supports only the same-origin canonical usage slash redirect', async () => {
	const reader = fixture();
	reader.respond((url) => url.endsWith('/token/')
		? new Response(null, { status: 307, headers: { location: '/api/usage/token' } }) : json(USAGE));
	assert.equal((await reader.read()).status, 'ready');
	assert.equal(reader.requests.length, 3);
	reader.dispose();
});

test('oversized or invalid JSON is rejected without leaking the response body', async () => {
	for (const text of ['{invalid', JSON.stringify({ secret: 'x'.repeat(300000) })]) {
		const reader = fixture();
		reader.respond(() => new Response(text, { headers: { 'content-type': 'application/json' } }));
		const value = await reader.read();
		assert.equal(value.reason, 'invalid-response');
		assert.equal(value.balance, undefined);
		assert.equal(JSON.stringify(value).includes('secret'), false);
		reader.dispose();
	}
});

test('network work is time bounded and disposal aborts in-flight work', async () => {
	const wait = (_url, { signal }) => new Promise((_resolve, reject) => {
		if (signal.aborted) reject(new Error('aborted'));
		else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	});
	const reader = fixture({ timeoutMs: 15 });
	reader.respond(wait);
	assert.equal((await reader.read()).reason, 'timeout');
	reader.dispose();
	const disposable = fixture();
	disposable.respond(wait);
	const pending = disposable.read();
	await Promise.resolve();
	disposable.dispose();
	assert.equal((await pending).status, 'failed');
});

test('provider totals use the recorded provider, not a guessed model family', async () => {
	const routes = new Map();
	const cleanup = [];
	const browserPeer = { principal: { kind: 'owner' } };
	const connection = { browserPeer, admit: () => ({ rejection: 401 }),
		fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } };
	const event = (provider, inputTokens) => ({ type: 'assistant/message', time: 1800000000000,
		data: { message: { source: { provider, model: 'same-model' } }, usage: { inputTokens, outputTokens: 10 } } });
	apply({
		get(name) {
			if (name === 'connection') return connection;
			if (name === 'sessionQuery') return {
				listSessions: async () => [{ header: { id: 'usage-agentrouter-test-fixture' } }],
				readSession: async () => ({ session: {}, events: [event('agentrouter', 20), event('openai', 30), event('agentrouter', 40)] })
			};
		},
		effect(fn) { cleanup.push(fn()); },
		webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } }
	});
	try {
		const response = await routes.get('/token-usage/summary').resource(undefined, browserPeer);
		const summary = await response.json();
		const ar = summary.byProvider.find((row) => row.provider === 'agentrouter');
		assert.deepEqual(ar, { provider: 'agentrouter', uncachedInputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0,
			outputTokens: 20, messages: 2, sessions: 1 });
		assert.equal(summary.totals.uncachedInputTokens, 90);
		assert.equal(summary.byModel.length, 1);
		const status = await routes.get('/token-usage/agentrouter').resource();
		assert.equal(status.status, 401);
		assert.equal((await status.json()).reason, 'unauthorized');
	} finally {
		for (const dispose of cleanup.reverse()) dispose?.();
	}
	assert.equal(routes.size, 0);
});

test('every distribution ledger route rejects unauthenticated reads before touching user data', async () => {
	const routes = new Map();
	const cleanup = [];
	let dataReads = 0;
	const connection = { browserPeer: { principal: { kind: 'owner' } }, admit: () => ({ rejection: 401 }),
		fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } };
	apply({
		get(name) {
			if (name === 'connection') return connection;
			if (name === 'sessionQuery' || name === 'credentials') { dataReads += 1; throw new Error('user data must not be read'); }
		},
		effect(fn) { cleanup.push(fn()); },
		webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } }
	});
	try {
		for (const path of ['/token-usage/summary', '/token-usage/codex', '/token-usage/balances', '/token-usage/agentrouter']) {
			const response = await routes.get(path).resource(new Request('http://harness.test' + path));
			assert.equal(response.status, 401, path);
		}
		assert.equal(dataReads, 0);
	} finally { for (const dispose of cleanup.reverse()) dispose?.(); }
	assert.equal(routes.size, 0);
});
