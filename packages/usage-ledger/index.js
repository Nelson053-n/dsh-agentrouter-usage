import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { agentRouterConnection, createAgentRouterReader } from './agentrouter.js';
import { authenticatedResource, createAgentRouterAccount, installAccountRoutes } from './agentrouter-account.js';

/**
 * Token ledger for the Usage panel.
 *
 * The durable projections only carry one aggregate per session, so they cannot
 * say which model spent what after a mid-session switch, nor when the tokens
 * were spent. This row replays each session's log through the query service and
 * attributes every assistant message's usage to its own request route
 * (`message.source`) and its own timestamp.
 */
const ROUTE = '/token-usage/summary';
const BALANCES_ROUTE = '/token-usage/balances';
const CODEX_ROUTE = '/token-usage/codex';
const TTL_MS = 45_000;
const MAX_DAYS = 40;
const FIELDS = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'];

function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/** One `refs:` entry of the harness credentials file, or the environment variable. */
function readCredential(name) {
	const fromEnv = process.env[name];
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
	try {
		const text = readFileSync(join(dshHome(), '.credentials.yaml'), 'utf8');
		let inRefs = false;
		for (const line of text.split('\n')) {
			if (/^refs:\s*$/.test(line)) {
				inRefs = true;
				continue;
			}
			if (inRefs && /^\S/.test(line)) break;
			if (!inRefs) continue;
			const match = new RegExp(`^\\s+${name}:\\s*(.+?)\\s*$`).exec(line);
			if (match !== null) return match[1].replace(/^['"]|['"]$/g, '');
		}
	} catch {
		// without a credentials file every balance source reports `missing`
	}
	return undefined;
}

/** Session titles live in the projection cache, not in the event log. */
function readTitle(sessionId) {
	try {
		const doc = JSON.parse(
			readFileSync(join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), 'utf8')
		);
		const title = doc?.record?.rows?.title?.val;
		return typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined;
	} catch {
		return undefined;
	}
}

function emptyBuckets() {
	return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
}

function addUsage(target, usage) {
	target.uncachedInputTokens += usage.inputTokens ?? 0;
	target.cacheReadTokens += usage.cacheReadTokens ?? 0;
	target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
	target.outputTokens += usage.outputTokens ?? 0;
}

function totalOf(buckets) {
	return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens;
}

/** Local calendar day of one event, as YYYY-MM-DD. */
function dayKey(ms) {
	const date = new Date(typeof ms === 'number' ? ms : Date.now());
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

function group(map, key) {
	let buckets = map.get(key);
	if (buckets === undefined) {
		buckets = emptyBuckets();
		map.set(key, buckets);
	}
	return buckets;
}

/** Fold every session's assistant usage into model, day, and session ledgers. */
async function collect(sessionQuery) {
	const sessions = await sessionQuery.listSessions();
	const byModel = new Map();
	const byDayModel = new Map();
	const byProject = new Map();
	const bySession = {};
	const modelSessions = new Map();
	const projectSessions = new Map();
	const byProvider = new Map();
	const providerSessions = new Map();
	let counted = 0;
	let firstAt;
	let lastAt;

	for (const entry of sessions) {
		const id = entry?.header?.id ?? entry?.id;
		if (id === undefined) continue;
		let read;
		try {
			read = await sessionQuery.readSession(id);
		} catch {
			continue;
		}
		const cwd = read?.session?.cwd;
		const project = readTitle(id) ?? (typeof cwd === 'string' ? basename(cwd) : 'unknown');
		const events = read?.events ?? [];
		const sessionModels = new Map();
		const sessionTotals = emptyBuckets();
		let sawUsage = false;
		for (const event of events) {
			if (event.type !== 'assistant/message') continue;
			const usage = event.data?.usage;
			if (usage === undefined) continue;
			const model = event.data?.message?.source?.model ?? 'unknown';
			const provider = event.data?.message?.source?.provider ?? 'unknown';
			const providerTotals = group(byProvider, provider);
			addUsage(providerTotals, usage);
			providerTotals.messages = (providerTotals.messages ?? 0) + 1;
			const seen = providerSessions.get(provider) ?? new Set();
			seen.add(id);
			providerSessions.set(provider, seen);
			const day = dayKey(event.time);
			const dayModels = byDayModel.get(day) ?? new Map();
			byDayModel.set(day, dayModels);
			addUsage(group(dayModels, model), usage);
			addUsage(group(byModel, model), usage);
			const projectModels = byProject.get(project) ?? new Map();
			byProject.set(project, projectModels);
			addUsage(group(projectModels, model), usage);
			addUsage(group(sessionModels, model), usage);
			addUsage(sessionTotals, usage);
			sawUsage = true;
			if (typeof event.time === 'number') {
				firstAt = firstAt === undefined ? event.time : Math.min(firstAt, event.time);
				lastAt = lastAt === undefined ? event.time : Math.max(lastAt, event.time);
			}
		}
		if (!sawUsage) continue;
		counted += 1;
		projectSessions.set(project, (projectSessions.get(project) ?? 0) + 1);
		bySession[id] = {
			totals: sessionTotals,
			byModel: [...sessionModels.entries()]
				.map(([model, buckets]) => ({ model, ...buckets }))
				.sort((a, b) => totalOf(b) - totalOf(a))
		};
		for (const [model, buckets] of sessionModels) {
			if (totalOf(buckets) > 0) modelSessions.set(model, (modelSessions.get(model) ?? 0) + 1);
		}
	}

	const totals = emptyBuckets();
	for (const buckets of byModel.values()) {
		for (const field of FIELDS) totals[field] += buckets[field];
	}

	const days = [...byDayModel.entries()]
		.sort(([a], [b]) => (a < b ? 1 : -1))
		.slice(0, MAX_DAYS)
		.map(([date, models]) => {
			const dayTotals = emptyBuckets();
			for (const buckets of models.values()) {
				for (const field of FIELDS) dayTotals[field] += buckets[field];
			}
			return {
				date,
				...dayTotals,
				models: [...models.entries()]
					.map(([model, buckets]) => ({ model, ...buckets }))
					.sort((a, b) => totalOf(b) - totalOf(a))
			};
		});

	return {
		generatedAt: Date.now(),
		source: 'session-logs',
		available: true,
		sessions: { total: sessions.length, counted },
		totals,
		byModel: [...byModel.entries()]
			.map(([model, buckets]) => ({ model, sessions: modelSessions.get(model) ?? 0, ...buckets }))
			.sort((a, b) => totalOf(b) - totalOf(a)),
		byDay: days,
		byProvider: [...byProvider.entries()]
			.map(([provider, buckets]) => ({ provider, ...buckets, sessions: providerSessions.get(provider)?.size ?? 0 }))
			.sort((a, b) => totalOf(b) - totalOf(a)),
		byProject: [...byProject.entries()]
			.map(([project, models]) => {
				const projectTotals = emptyBuckets();
				for (const buckets of models.values()) {
					for (const field of FIELDS) projectTotals[field] += buckets[field];
				}
				return {
					project,
					sessions: projectSessions.get(project) ?? 0,
					...projectTotals,
					models: [...models.entries()]
						.map(([model, buckets]) => ({ model, ...buckets }))
						.sort((a, b) => totalOf(b) - totalOf(a))
				};
			})
			.sort((a, b) => totalOf(b) - totalOf(a)),
		bySession,
		firstAt,
		lastAt
	};
}

/** OpenRouter credit balance from the stored API key. */
async function openRouterBalance() {
	const key = readCredential('OPENROUTER_API_KEY');
	if (key === undefined) return { status: 'missing' };
	try {
		const response = await fetch('https://openrouter.ai/api/v1/credits', {
			headers: { authorization: `Bearer ${key}` }
		});
		if (!response.ok) return { status: 'failed', code: response.status };
		const body = await response.json();
		const total = Number(body?.data?.total_credits);
		const used = Number(body?.data?.total_usage);
		if (!Number.isFinite(total) || !Number.isFinite(used)) return { status: 'failed' };
		return { status: 'ready', currency: 'USD', total, used, balance: total - used };
	} catch {
		return { status: 'failed' };
	}
}

/** Anthropic exposes no credit-balance API; an Admin key can at least read the org and its cost report. */
async function anthropicBalance() {
	const key = readCredential('ANTHROPIC_ADMIN_KEY') ?? readCredential('ANTHROPIC_API_KEY');
	if (key === undefined) return { status: 'missing' };
	const headers = { 'x-api-key': key, 'anthropic-version': '2026-10-21', accept: 'application/json' };
	try {
		const me = await fetch('https://api.anthropic.com/v1/organizations/me', { headers });
		if (!me.ok) {
			return { status: me.status === 401 ? 'admin-required' : 'failed', code: me.status };
		}
		const org = await me.json();
		const start = new Date();
		start.setDate(1);
		const starting = start.toISOString().slice(0, 10);
		const ending = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
		const report = await fetch(
			`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${starting}&ending_at=${ending}`,
			{ headers }
		);
		if (!report.ok) {
			return { status: 'no-billing', org: org?.name ?? null, code: report.status };
		}
		const body = await report.json();
		let total = 0;
		for (const bucket of body?.data ?? []) {
			for (const result of bucket?.results ?? []) {
				const amount = Number(result?.amount);
				if (Number.isFinite(amount)) total += amount;
			}
		}
		return { status: 'ready', org: org?.name ?? null, monthCost: total / 100, currency: 'USD' };
	} catch {
		return { status: 'failed' };
	}
}

/** Last good balance snapshot, so one failed provider call never blanks the panel. */
function balancesCachePath() {
	return join(dshHome(), 'storages', 'usage-ledger', 'balances.json');
}

function readBalanceCache() {
	try {
		return JSON.parse(readFileSync(balancesCachePath(), 'utf8')) ?? {};
	} catch {
		return {};
	}
}

function writeBalanceCache(value) {
	try {
		const path = balancesCachePath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
	} catch {
		// a read-only home still keeps the in-memory copy
	}
}

async function readBalances() {
	const [openrouter, anthropic] = await Promise.all([openRouterBalance(), anthropicBalance()]);
	const cached = readBalanceCache();
	const next = { ...cached };
	const sources = {};
	for (const [name, fresh] of Object.entries({ openrouter, anthropic })) {
		if (fresh.status === 'ready') {
			const value = { ...fresh, stale: false, at: Date.now() };
			sources[name] = value;
			next[name] = value;
		} else if (cached[name]?.status === 'ready') {
			sources[name] = { ...cached[name], stale: true };
		} else {
			sources[name] = fresh;
		}
	}
	if (JSON.stringify(next) !== JSON.stringify(cached)) writeBalanceCache(next);
	return { generatedAt: Date.now(), sources };
}

/** Codex OAuth tokens from the CLI's own auth file. */
function readCodexAuth() {
	try {
		const doc = JSON.parse(
			readFileSync(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json'), 'utf8')
		);
		const tokens = doc?.tokens ?? {};
		if (typeof tokens.access_token !== 'string') return null;
		return { access: tokens.access_token, account: tokens.account_id ?? '' };
	} catch {
		return null;
	}
}

/** Live plan windows from the ChatGPT backend the Codex CLI itself calls. */
async function codexLiveLimits() {
	const auth = readCodexAuth();
	if (auth === null) return null;
	try {
		const response = await fetch('https://chatgpt.com/backend-api/codex/usage', {
			headers: {
				authorization: `Bearer ${auth.access}`,
				'chatgpt-account-id': auth.account,
				'user-agent': 'codex-cli/0.153.4',
				accept: 'application/json'
			}
		});
		if (!response.ok) return null;
		const body = await response.json();
		const window = (value) =>
			value === null || value === undefined
				? null
				: {
						usedPercent: value.used_percent ?? null,
						windowSeconds: value.limit_window_seconds ?? null,
						resetsAt: value.reset_at ?? null
					};
		return {
			planType: body.plan_type ?? null,
			primary: window(body.rate_limit?.primary_window),
			secondary: window(body.rate_limit?.secondary_window),
			credits: body.credits ?? null
		};
	} catch {
		return null;
	}
}

/** Codex writes one rollout JSONL per thread; token_count events carry usage and the plan's limits. */
async function collectCodex() {
	const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
	const cutoff = Date.now() - 30 * 86_400_000;
	const files = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith('.jsonl')) {
				try {
					const stats = statSync(path);
					if (stats.mtimeMs >= cutoff) files.push({ path, mtime: stats.mtimeMs });
				} catch {
					// unreadable rollout: skip
				}
			}
		}
	};
	walk(root);
	files.sort((a, b) => b.mtime - a.mtime);

	const today = dayKey(Date.now());
	const weekAgo = Date.now() - 7 * 86_400_000;
	let todayTokens = 0;
	let weekTokens = 0;
	let totalTokens = 0;
	let counted = 0;
	let latest = null;
	const byModel = new Map();

	for (const file of files.slice(0, 300)) {
		let text;
		try {
			text = readFileSync(file.path, 'utf8');
		} catch {
			continue;
		}
		let previous = null;
		let previousUsage = null;
		let sawAny = false;
		let model = 'unknown';
		for (const line of text.split('\n')) {
			if (line.includes('turn_context')) {
				try {
					const event = JSON.parse(line);
					if (event.type === 'turn_context' && typeof event.payload?.model === 'string') {
						model = event.payload.model;
					}
				} catch {
					// a torn line never carries the model
				}
				continue;
			}
			if (!line.includes('token_count')) continue;
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			const payload = event.payload;
			if (payload?.type !== 'token_count') continue;
			const info = payload.info?.total_token_usage;
			if (info === undefined) continue;
			const total = Number(info.total_tokens ?? 0);
			if (!Number.isFinite(total)) continue;
			const delta = previous === null ? total : Math.max(0, total - previous);
			const usageDelta = {
				input: Number(info.input_tokens ?? 0) - (previousUsage?.input ?? 0),
				cached: Number(info.cached_input_tokens ?? 0) - (previousUsage?.cached ?? 0),
				write: Number(info.cache_write_input_tokens ?? 0) - (previousUsage?.write ?? 0),
				output: Number(info.output_tokens ?? 0) - (previousUsage?.output ?? 0)
			};
			previousUsage = {
				input: Number(info.input_tokens ?? 0),
				cached: Number(info.cached_input_tokens ?? 0),
				write: Number(info.cache_write_input_tokens ?? 0),
				output: Number(info.output_tokens ?? 0)
			};
			previous = total;
			sawAny = true;
			const at = Date.parse(event.timestamp);
			if (Number.isFinite(at)) {
				if (dayKey(at) === today) todayTokens += delta;
				if (at >= weekAgo) weekTokens += delta;
			}
			totalTokens += delta;
			const buckets = group(byModel, model);
			buckets.uncachedInputTokens += Math.max(0, usageDelta.input - Math.max(0, usageDelta.cached));
			buckets.cacheReadTokens += Math.max(0, usageDelta.cached);
			buckets.cacheWriteTokens += Math.max(0, usageDelta.write);
			buckets.outputTokens += Math.max(0, usageDelta.output);
			if (payload.rate_limits !== undefined && (latest === null || (at || 0) > latest.at)) {
				latest = { at: at || 0, limits: payload.rate_limits };
			}
		}
		if (sawAny) counted += 1;
	}

	const live = await codexLiveLimits();
	return {
		generatedAt: Date.now(),
		available: files.length > 0,
		sessions: counted,
		tokens: { today: todayTokens, week: weekTokens, total: totalTokens },
		byModel: [...byModel.entries()]
			.map(([name, buckets]) => ({ model: name, ...buckets }))
			.sort((a, b) => totalOf(b) - totalOf(a)),
		rateLimits:
			live ??
			(latest === null
				? null
				: {
						planType: latest.limits.plan_type ?? null,
						primary:
							latest.limits.primary === undefined
								? null
								: {
										usedPercent: latest.limits.primary.used_percent ?? null,
										windowSeconds:
											(latest.limits.primary.window_minutes ?? 0) * 60 || null,
										resetsAt: latest.limits.primary.resets_at ?? null
									},
						secondary:
							latest.limits.secondary === undefined
								? null
								: {
										usedPercent: latest.limits.secondary.used_percent ?? null,
										windowSeconds:
											(latest.limits.secondary.window_minutes ?? 0) * 60 || null,
										resetsAt: latest.limits.secondary.resets_at ?? null
									},
						credits: latest.limits.credits ?? null
					})
	};
}

/** Last good Codex snapshot, so a failed limit call or an unreadable log dir keeps the card alive. */
function codexSnapshotPath() {
	return join(dshHome(), 'storages', 'usage-ledger', 'codex.json');
}

function readCodexSnapshot() {
	try {
		return JSON.parse(readFileSync(codexSnapshotPath(), 'utf8')) ?? null;
	} catch {
		return null;
	}
}

function writeCodexSnapshot(value) {
	try {
		const path = codexSnapshotPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
	} catch {
		// in-memory cache still covers this process
	}
}

/** Merge a fresh Codex read over the last good snapshot, marking what came from the cache. */
function mergeCodex(fresh) {
	const cached = readCodexSnapshot();
	const merged = { ...fresh };
	let stale = false;
	if (merged.rateLimits === null && cached?.rateLimits !== undefined && cached.rateLimits !== null) {
		merged.rateLimits = cached.rateLimits;
		stale = true;
	}
	if (!(merged.tokens?.total > 0) && cached?.tokens?.total > 0) {
		merged.tokens = cached.tokens;
		stale = true;
	}
	merged.stale = stale;
	if (merged.rateLimits !== null || merged.tokens?.total > 0) writeCodexSnapshot(merged);
	return merged;
}

export const inject = ['webServer'];

export function apply(ctx) {
	const account = createAgentRouterAccount({
		getCredentials: () => ctx.get('credentials'),
		getConnection: () => agentRouterConnection(ctx)
	});
	ctx.effect(() => () => account.dispose(), 'usage-ledger: AgentRouter account');
	installAccountRoutes(ctx, account);
	const agentRouter = createAgentRouterReader({
		getConnection: () => agentRouterConnection(ctx),
		resolveCredential: async (ref) => {
			const credentials = ctx.get('credentials');
			return credentials === undefined ? undefined : (await credentials.resolve(ref))?.value;
		}
	});
	ctx.effect(() => () => agentRouter.dispose(), 'usage-ledger: AgentRouter reader');
	let cached;
	let cachedAt = 0;
	let inflight;

	const load = () => {
		const sessionQuery = ctx.get('sessionQuery');
		if (sessionQuery === undefined) {
			return Promise.resolve({
				generatedAt: Date.now(),
				source: 'unavailable',
				available: false,
				sessions: { total: 0, counted: 0 },
				totals: emptyBuckets(),
				byModel: [],
				byDay: [],
				bySession: {}
			});
		}
		return collect(sessionQuery);
	};

	const summary = () => {
		const now = Date.now();
		if (cached !== undefined && now - cachedAt < TTL_MS) return Promise.resolve(cached);
		if (inflight !== undefined) return inflight;
		inflight = load()
			.then((value) => {
				cached = value;
				cachedAt = Date.now();
				return value;
			})
			.catch((error) => {
				ctx.logger?.warn?.(error);
				return cached ?? { generatedAt: Date.now(), source: 'failed', available: false, sessions: { total: 0, counted: 0 }, totals: emptyBuckets(), byModel: [], byDay: [], bySession: {} };
			})
			.finally(() => {
				inflight = undefined;
			});
		return inflight;
	};

	let balancesCache;
	let balancesAt = 0;
	const balances = () => {
		const now = Date.now();
		if (balancesCache !== undefined && now - balancesAt < 60_000) return Promise.resolve(balancesCache);
		return readBalances()
			.then((value) => {
				balancesCache = value;
				balancesAt = Date.now();
				return value;
			})
			.catch((error) => {
				ctx.logger?.warn?.(error);
				return { generatedAt: Date.now(), sources: {} };
			});
	};

	let codexCache;
	let codexAt = 0;
	const codex = () => {
		const now = Date.now();
		if (codexCache !== undefined && now - codexAt < 90_000) return Promise.resolve(codexCache);
		return collectCodex()
			.then((value) => {
				const merged = mergeCodex(value);
				codexCache = merged;
				codexAt = Date.now();
				return merged;
			})
			.catch((error) => {
				ctx.logger?.warn?.(error);
				const cached = readCodexSnapshot();
				if (cached !== null) {
					codexCache = { ...cached, stale: true };
					return codexCache;
				}
				return { available: false, tokens: { today: 0, week: 0, total: 0 }, rateLimits: null, stale: false };
			});
	};

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: CODEX_ROUTE,
				resource: authenticatedResource(ctx, async () =>
					new Response(JSON.stringify(await codex()), {
						status: 200,
						headers: {
							'content-type': 'application/json; charset=utf-8',
							'cache-control': 'no-store'
						}
					}))
			}),
		'usage-ledger: codex route'
	);

	ctx.effect(
		() => ctx.webServer.register({
			kind: 'exact',
			path: '/token-usage/agentrouter',
			resource: authenticatedResource(ctx, async () => new Response(JSON.stringify(await agentRouter.read()), {
				status: 200,
				headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
			}))
		}),
		'usage-ledger: AgentRouter route'
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: BALANCES_ROUTE,
				resource: authenticatedResource(ctx, async () => {
					const [existing, agentrouter] = await Promise.all([balances(), agentRouter.read()]);
					return new Response(JSON.stringify({
						...existing,
						sources: { ...existing.sources, agentrouter }
					}), {
						status: 200,
						headers: {
							'content-type': 'application/json; charset=utf-8',
							'cache-control': 'no-store'
						}
					});
				})
			}),
		'usage-ledger: balances route'
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: ROUTE,
				resource: authenticatedResource(ctx, async () =>
					new Response(JSON.stringify(await summary()), {
						status: 200,
						headers: {
							'content-type': 'application/json; charset=utf-8',
							'cache-control': 'no-store'
						}
					}))
			}),
		'usage-ledger: summary route'
	);
}
