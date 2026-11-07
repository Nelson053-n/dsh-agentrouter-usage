import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT_RECORD, ACCOUNT_PATH, BINDING_PATH, accountCredential, authenticatedResource,
	createAgentRouterAccount, installAccountRoutes, normalizeAgentRouterAccount } from '../agentrouter-account.js';

const ORIGIN = 'https://agentrouter.example';
const TOKEN = 'dashboard-token-test-only';
const STATUS = { success: true, data: { quota_per_unit: 500000, display_in_currency: true } };
const SELF = { success: true, data: { id: 42, quota: 37500000, used_quota: 12500000, request_count: 10,
	username: 'private user', email: 'private@example.test', access_token: 'must not cross the wire' } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const record = (token = TOKEN, origin = ORIGIN, userId = '42') => ({ kind: 'grant', payload: { version: 1, token, origin, userId } });

function fixture(options = {}) {
	let value;
	let clock = 1800000000000;
	let origin = ORIGIN;
	let source = () => json(SELF);
	let writes = 0;
	let deletes = 0;
	const requests = [];
	const credentials = {
		readRecord: async (key) => { assert.equal(key, ACCOUNT_RECORD); return structuredClone(value); },
		modifyRecord: async (key, mutate) => { assert.equal(key, ACCOUNT_RECORD); const next = await mutate(structuredClone(value));
			if (next !== undefined) { writes += 1; value = structuredClone(next); } return structuredClone(value); },
		deleteRecord: async (key) => { assert.equal(key, ACCOUNT_RECORD); deletes += 1; value = undefined; }
	};
	const service = createAgentRouterAccount({
		getCredentials: () => credentials,
		getConnection: () => origin === null ? null : { origin },
		now: () => clock,
		fetchImpl: async (url, init) => { requests.push({ url, ...init }); return url.endsWith('/api/status') ? json(STATUS) : source(url, init); },
		...options
	});
	return { ...service, requests, credentials, get record() { return value; }, get writes() { return writes; }, get deletes() { return deletes; },
		setRecord: (next) => { value = next; }, respond: (fn) => { source = fn; },
		setOrigin: (next) => { origin = next; }, advance: (ms) => { clock += ms; } };
}

async function connectInput(service, extra = {}) {
	const state = await service.read();
	return { token: TOKEN, userId: '42', origin: ORIGIN, revision: state.binding.revision, ...extra };
}

test('account DTO contains real balance fields only and confirms the matching user ID', () => {
	const result = normalizeAgentRouterAccount(SELF, STATUS, '42');
	assert.deepEqual(result, { status: 'ready', scope: 'account', currency: 'USD', quotaPerUnit: 500000, balance: 75, used: 25, requests: 10 });
	assert.equal(JSON.stringify(result).includes('private'), false);
	assert.equal(JSON.stringify(result).includes('access_token'), false);
	assert.equal(normalizeAgentRouterAccount(SELF, STATUS, '43'), null);
	assert.equal(normalizeAgentRouterAccount({ success: false, data: SELF.data }, STATUS, '42'), null);
	assert.equal(normalizeAgentRouterAccount({ success: true, data: { ...SELF.data, quota: null } }, STATUS, '42'), null);
	const zero = normalizeAgentRouterAccount({ success: true, data: { id: 42, quota: 0 } }, undefined, '42');
	assert.equal(zero.balance, 0);
	assert.equal(zero.currency, null);
	assert.equal(zero.used, null);
	assert.equal(zero.requests, null);
});

test('stored grant validation rejects model keys and unsafe origins', () => {
	assert.deepEqual(accountCredential(record()), { token: TOKEN, origin: ORIGIN, userId: '42' });
	for (const value of [undefined, {}, record('sk-model-key'), record(TOKEN, 'http://bad.example'),
		record(TOKEN, 'https://user:password@bad.example'), record(TOKEN, ORIGIN + '/path'), record(TOKEN, ORIGIN, 'x')]) {
		assert.equal(accountCredential(value), null);
	}
});

test('unconnected account needs no key or external calls and returns an opaque form revision', async () => {
	const service = fixture();
	const result = await service.read();
	assert.equal(result.status, 'unconnected');
	assert.equal(result.binding.configured, false);
	assert.equal(result.binding.origin, ORIGIN);
	assert.equal(typeof result.binding.revision, 'string');
	assert.equal(service.requests.length, 0);
	service.dispose();
});

test('verify-and-save uses only GET self/status, stores one grant, and never returns a token', async () => {
	const service = fixture();
	const input = await connectInput(service);
	const result = await service.connect(input);
	assert.equal(result.ok, true);
	assert.equal(result.value.balance, 75);
	assert.equal(result.value.binding.configured, true);
	assert.equal(result.value.binding.userId, '42');
	assert.equal(JSON.stringify(result).includes(TOKEN), false);
	assert.equal(JSON.stringify(result).includes('private'), false);
	assert.equal(service.writes, 1);
	assert.deepEqual(service.record, record());
	assert.equal(service.requests.length, 2);
	assert.equal(service.requests[0].url, ORIGIN + '/api/user/self');
	assert.equal(service.requests[0].headers.authorization, 'Bearer ' + TOKEN);
	assert.equal(service.requests[0].headers['new-api-user'], '42');
	assert.equal(service.requests[1].headers.authorization, undefined);
	for (const request of service.requests) { assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'manual'); assert.equal(request.body, undefined); }
	assert.equal((await service.read()).balance, 75);
	assert.equal(service.requests.length, 2);
	service.dispose();
});

test('model key, bad ID, stale revision and changed destination are refused before transmission', async () => {
	const service = fixture();
	for (const extra of [{ token: 'sk-model-key' }, { userId: 'bad' }, { userId: '0' },
		{ token: 'token\r\nheader' }, { revision: 'stale' }, { origin: 'https://other.example' }]) {
		const result = await service.connect(await connectInput(service, extra));
		assert.equal(result.ok, false);
	}
	assert.equal(service.requests.length, 0);
	assert.equal(service.writes, 0);
	service.dispose();
});

test('failed verification does not save the candidate or replace an existing grant', async () => {
	const service = fixture();
	service.setRecord(record('existing-dashboard-token'));
	await service.read();
	service.respond(() => json({ success: false, message: 'secret echoed by server' }, 401));
	const result = await service.connect(await connectInput(service));
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'unauthorized');
	assert.equal(service.record.payload.token, 'existing-dashboard-token');
	assert.equal(service.writes, 0);
	assert.equal(JSON.stringify(result).includes('secret'), false);
	service.dispose();
});

test('API-level refusal and mismatched account ID cannot be saved', async () => {
	for (const body of [{ success: false, message: TOKEN }, { success: true, data: { ...SELF.data, id: 43 } }]) {
		const service = fixture();
		service.respond(() => json(body));
		assert.equal((await service.connect(await connectInput(service))).ok, false);
		assert.equal(service.writes, 0);
		service.dispose();
	}
});

test('account reads share one cache, mark stale data, and expire stale snapshots', async () => {
	const service = fixture();
	service.setRecord(record());
	const [a, b] = await Promise.all([service.read(), service.read()]);
	assert.deepEqual(a, b);
	assert.equal(service.requests.length, 2);
	service.advance(60001);
	service.respond(() => { throw new Error(TOKEN); });
	const stale = await service.read();
	assert.equal(stale.balance, 75);
	assert.equal(stale.stale, true);
	assert.equal(stale.at, a.at);
	assert.equal(JSON.stringify(stale).includes(TOKEN), false);
	service.advance(16 * 60000);
	const failed = await service.read();
	assert.equal(failed.status, 'failed');
	assert.equal(failed.balance, undefined);
	service.dispose();
});

test('auth refusal, rotation and deletion invalidate a cached account immediately', async () => {
	const service = fixture();
	service.setRecord(record());
	await service.read();
	service.setRecord(record('new-dashboard-token'));
	service.respond(() => json({ success: false }, 403));
	const result = await service.read();
	assert.equal(result.status, 'failed');
	assert.equal(result.balance, undefined);
	assert.equal(result.stale, false);
	service.setRecord(undefined);
	assert.equal((await service.read()).status, 'unconnected');
	service.dispose();
});

test('changing the model endpoint never sends the saved management token to that new origin', async () => {
	const service = fixture();
	service.setRecord(record());
	await service.read();
	service.setOrigin('https://new-relay.example');
	service.advance(60001);
	const result = await service.read();
	assert.equal(result.origin, ORIGIN);
	assert.equal(result.binding.connectOrigin, 'https://new-relay.example');
	assert.ok(service.requests.every((item) => item.url.startsWith(ORIGIN + '/')));
	service.dispose();
});

test('disconnect removes only this plugin grant and clears the balance', async () => {
	const service = fixture();
	await service.connect(await connectInput(service));
	const result = await service.disconnect({ revision: (await service.read()).binding.revision });
	assert.equal(result.ok, true);
	assert.equal(result.value.status, 'unconnected');
	assert.equal(result.value.balance, undefined);
	assert.equal(service.record, undefined);
	assert.equal(service.deletes, 1);
	assert.equal((await service.read()).status, 'unconnected');
	service.dispose();
});

test('an unconnected read cannot cancel an explicit verification in progress', async () => {
	const service = fixture();
	const started = Promise.withResolvers();
	const response = Promise.withResolvers();
	service.respond((_url, { signal }) => { started.resolve(signal); return response.promise; });
	const pending = service.connect(await connectInput(service));
	const signal = await started.promise;
	assert.equal((await service.read()).status, 'unconnected');
	assert.equal(signal.aborted, false);
	response.resolve(json(SELF));
	assert.equal((await pending).ok, true);
	service.dispose();
});

test('a replaced grant during verification is not overwritten by a late response', async () => {
	const service = fixture();
	const started = Promise.withResolvers();
	const response = Promise.withResolvers();
	service.respond(() => { started.resolve(); return response.promise; });
	const pending = service.connect(await connectInput(service));
	await started.promise;
	service.setRecord(record('another-client-token'));
	response.resolve(json(SELF));
	const result = await pending;
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'configuration-changed');
	assert.equal(service.writes, 0);
	assert.equal(service.record.payload.token, 'another-client-token');
	service.dispose();
});

test('disposal cancels verification and prevents persistence', async () => {
	const service = fixture();
	const started = Promise.withResolvers();
	service.respond((_url, { signal }) => { started.resolve(); return new Promise((_resolve, reject) => {
		signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
	}); });
	const pending = service.connect(await connectInput(service));
	await started.promise;
	service.dispose();
	assert.equal((await pending).ok, false);
	assert.equal(service.writes, 0);
});

function routesFixture() {
	const routes = new Map();
	const disposers = [];
	let connects = 0;
	let disconnects = 0;
	const browserPeer = { principal: { kind: 'owner' } };
	const apiPeer = { principal: { kind: 'owner' } };
	const connection = { browserPeer,
		admit(request) {
			if (request.headers.get('origin') === 'https://evil.example') return { rejection: 403 };
			const cookie = request.headers.get('cookie');
			return cookie === 'browser' ? { peer: browserPeer } : cookie === 'api' ? { peer: apiPeer } : { rejection: 401 };
		},
		fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } }
	};
	const ctx = { get: (name) => name === 'connection' ? connection : undefined, effect: (fn) => { disposers.push(fn()); } };
	const service = { read: async () => ({ status: 'unconnected' }),
		connect: async () => { connects += 1; return { ok: true, value: { status: 'ready' } }; },
		disconnect: async () => { disconnects += 1; return { ok: true, value: { status: 'unconnected' } }; } };
	installAccountRoutes(ctx, service);
	return { routes, ctx, get connects() { return connects; }, get disconnects() { return disconnects; }, cleanup() { disposers.reverse().forEach((fn) => fn()); } };
}
const bindingRequest = (cookie = 'browser', input = { action: 'connect', revision: 'opaque' }, headers = {}) => new Request('http://127.0.0.1' + BINDING_PATH, {
	method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-dsh-usage-action': 'account-binding', ...headers }, body: typeof input === 'string' ? input : JSON.stringify(input)
});

test('binding is strictly browser-only: unauthenticated and generic owner API Peers cannot grant/revoke', async () => {
	const fixture = routesFixture();
	const route = fixture.routes.get(BINDING_PATH);
	assert.deepEqual(route.methods, ['POST']);
	assert.equal(route.requestBody, 'streaming');
	for (const action of ['connect', 'disconnect']) {
		assert.equal((await route.fetch(bindingRequest('', { action, revision: 'opaque' }))).status, 401);
		assert.equal((await route.fetch(bindingRequest('api', { action, revision: 'opaque' }))).status, 403);
		assert.equal((await route.fetch(bindingRequest('browser', { action, revision: 'opaque' }, { origin: 'https://evil.example' }))).status, 403);
	}
	assert.equal(fixture.connects + fixture.disconnects, 0);
	assert.equal((await route.fetch(bindingRequest())).status, 200);
	assert.equal(fixture.connects, 1);
	fixture.cleanup();
	assert.equal(fixture.routes.size, 0);
});

test('binding requires the UI action header, bounded JSON and known fields', async () => {
	const fixture = routesFixture();
	const route = fixture.routes.get(BINDING_PATH);
	assert.equal((await route.fetch(bindingRequest('browser', undefined, { 'x-dsh-usage-action': '' }))).status, 415);
	for (const body of ['{not-json', 'x'.repeat(13 * 1024), { action: 'connect', revision: 'opaque', arbitrary: 'private' }, null, [], { action: 'login' }]) {
		const response = await route.fetch(bindingRequest('browser', body));
		assert.equal(response.status, 400);
		assert.equal((await response.text()).includes('private'), false);
	}
	assert.equal(fixture.connects, 0);
	fixture.cleanup();
});

test('account read requires authenticated browser, and no GET/HEAD receives a body', async () => {
	const fixture = routesFixture();
	const route = fixture.routes.get(ACCOUNT_PATH);
	assert.equal(route.requestBody, 'buffered');
	assert.deepEqual(route.methods, ['GET', 'HEAD']);
	assert.equal((await route.fetch(new Request('http://127.0.0.1' + ACCOUNT_PATH))).status, 401);
	assert.equal((await route.fetch(new Request('http://127.0.0.1' + ACCOUNT_PATH, { headers: { cookie: 'api' } }))).status, 403);
	const response = await route.fetch(new Request('http://127.0.0.1' + ACCOUNT_PATH, { method: 'HEAD', headers: { cookie: 'browser' } }));
	assert.equal(response.body, null);
	fixture.cleanup();
});

test('legacy balance resources now use Connection admission instead of exposing provider data publicly', async () => {
	const fixture = routesFixture();
	let reads = 0;
	const read = authenticatedResource(fixture.ctx, async () => { reads += 1; return json({ status: 'ready' }); });
	assert.equal((await read(new Request('http://127.0.0.1/token-usage/balances'))).status, 401);
	assert.equal(reads, 0);
	assert.equal((await read(new Request('http://127.0.0.1/token-usage/balances', { headers: { cookie: 'browser' } }))).status, 200);
	assert.equal(reads, 1);
	fixture.cleanup();
});
