/**
 * Contract smoke test for the browser bundle: it must register one lazy factory
 * under the package name, return a plugin, and leave one dock entry after apply.
 */
import assert from 'node:assert/strict';

let loaded;
globalThis.window = {
	__ModuleLoader__: {
		load(module) {
			loaded = module;
		}
	}
};

await import('../client.js');

assert.equal(loaded.id, '@local/token-usage');

const React = {
	Fragment: Symbol('Fragment'),
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
	useState: (value) => [value, () => {}],
	useEffect: () => {},
	useCallback: (fn) => fn,
	useMemo: (fn) => fn(),
	useRef: (value) => ({ current: value })
};

/** Every text leaf of a rendered element tree, in order. */
function textOf(node) {
	if (node === null || node === undefined || node === false) return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (!Array.isArray(node) && typeof node === 'object' && 'children' in node) return node.children.map(textOf).join(' ');
	return '';
}

/** Resolve `key` from the English dictionary and interpolate `{name}` placeholders. */
function translate(key, params) {
	const template = dictionaries['token-usage'].en[key] ?? key;
	return template.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''));
}

const plugin = loaded.factory((request) => {
	if (request === 'react') return React;
	if (request === 'react-dom') return { createPortal: () => null };
	throw new Error(`unexpected module request: ${request}`);
});

assert.deepEqual(plugin.inject, ['slots', 'locale']);

const dictionaries = {};
const registrations = new Map();
const slots = [];
const ctx = {
	effect(fn) {
		return fn();
	},
	get() {
		return undefined;
	},
	locale: {
		register(ns, value) {
			dictionaries[ns] = value;
			return () => {};
		},
		bind() {
			return translate;
		},
		getSnapshot() {
			return { active: 'ru' };
		}
	},
	slots: {
		inject(name, body) {
			slots.push(name);
			body();
		},
		register(options, component) {
			assert.equal(typeof component, 'function');
			registrations.set(options.name, { options, component });
			return () => {};
		}
	}
};

plugin.apply(ctx);

assert.deepEqual(slots, ['conversation.composer.dock', 'sidebar.panellist', 'main']);

const dock = registrations.get('conversation.composer.dock');
assert.equal(dock.options.id, 'token-usage');
assert.equal(dock.options.locale, 'token-usage');

const panelRow = registrations.get('sidebar.panellist');
assert.equal(panelRow.options.id, 'usage');
assert.equal(typeof panelRow.options.label, 'function');

const mainPanel = registrations.get('main');
assert.equal(mainPanel.options.key, 'usage');
assert.equal(typeof mainPanel.options.inject, 'function');
assert.deepEqual(Object.keys(mainPanel.options.inject()), ['loadSummary', 'loadBalance', 'loadModels', 'loadBalances', 'loadCodex', 'loadAgentRouterAccount', 'agentRouterAccountAction']);

const dockComponent = dock.component;

const [zh, en, ru] = [dictionaries['token-usage'].zh, dictionaries['token-usage'].en, dictionaries['token-usage'].ru];
const expected = Object.keys(zh).sort();
assert.deepEqual(Object.keys(en).sort(), expected);
assert.deepEqual(Object.keys(ru).sort(), expected);

// The panel renders its own loading state without touching fetch.
const panelText = textOf(mainPanel.component({ t: translate, loadSummary: () => Promise.resolve(null), loadBalance: () => Promise.resolve(null) }));
assert.ok(panelText.includes('Usage and balance'), `expected the panel title in "${panelText}"`);

// Cost math: 1 000 uncached + 10 000 cache reads + 500 output on deepseek-flash.
const usage = {
	uncachedInputTokens: 1000,
	cacheReadTokens: 10000,
	cacheWriteTokens: 0,
	outputTokens: 500
};
const projections = { tokenUsage: usage, modelSelection: { lastUsed: { model: 'deepseek-flash' } } };
const tree = dockComponent({ t: translate, useProjection: (key) => projections[key] });
const label = textOf(tree);
assert.ok(label.includes('$0.0004'), `expected ~ $0.0004 in "${label}"`);

// An unknown model id keeps working through the default rate row.
const fallback = textOf(
	dockComponent({
		t: translate,
		useProjection: (key) =>
			key === 'modelSelection' ? { lastUsed: { model: 'some-unlisted-model' } } : projections[key]
	})
);
assert.ok(fallback.includes('$0.0004'));

// No billed usage renders nothing.
assert.equal(dockComponent({ t: translate, useProjection: () => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }) }), null);

// Anthropic family rates: Opus 5.5 is $4 / $0.20 / $20 per 1M input, cache read, output.
const opusUsage = { uncachedInputTokens: 1000, cacheReadTokens: 10000, cacheWriteTokens: 0, outputTokens: 500 };
const opusLabel = (model) =>
	textOf(
		dockComponent({
			t: translate,
			useProjection: (key) =>
				key === 'modelSelection' ? { lastUsed: { model } } : key === 'tokenUsage' ? opusUsage : undefined
		})
	);
assert.ok(opusLabel('claude-opus-5-5').includes('$0.016'), `expected the Opus 5.5 rate in "${opusLabel('claude-opus-5-5')}"`);
// A date-suffixed id keeps the same family rate.
assert.ok(opusLabel('claude-opus-5-5-20260101').includes('$0.016'), 'date suffix must not change the rate');
// Sonnet 4.5 is cheaper: $3 / $0.30 / $15.
assert.ok(opusLabel('claude-sonnet-4-5').includes('$0.013'), `expected the Sonnet 4.5 rate in "${opusLabel('claude-sonnet-4-5')}"`);

console.log('ok: bundle contract, inject face, dock registration, dictionary parity, cost math, and Anthropic rates');
