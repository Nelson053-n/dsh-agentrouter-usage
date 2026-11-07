window.__ModuleLoader__.load({
	id: '@local/token-usage',
	factory(require) {
		const React = require('react');
		const ReactDOM = require('react-dom');
		const h = React.createElement;

		/** Dictionary namespace owned by this plugin. */
		const NS = 'token-usage';

		/**
		 * DeepSeek bills in CNY per 1M tokens, in two daily bands: the published
		 * table is the idle price, and Beijing weekday 09:00-12:00 / 14:00-18:00
		 * charges double. `DEEPSEEK_PEAK` selects the band this panel prices with.
		 */
		const CNY_PER_USD = 7.2;
		const DEEPSEEK_PEAK = false;
		const DEEPSEEK_CNY = {
			// https://api-docs.deepseek.com/quick_start/pricing (idle band)
			'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, cacheWrite: 0, output: 4 },
			'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, cacheWrite: 0, output: 13.5 }
		};

		/** One DeepSeek CNY row converted to the USD-per-1M shape the panel prices with. */
		function deepseekUsd(row) {
			const band = DEEPSEEK_PEAK ? 2 : 1;
			return {
				cacheHit: (row.cacheHit * band) / CNY_PER_USD,
				cacheMiss: (row.cacheMiss * band) / CNY_PER_USD,
				cacheWrite: (row.cacheWrite * band) / CNY_PER_USD,
				output: (row.output * band) / CNY_PER_USD
			};
		}

		/**
		 * USD per 1M tokens for exact model ids. These are the numbers the panel
		 * prices with: edit them to match your plan, then reload the page. An
		 * unknown model id falls back to `default`.
		 */
		const PRICING = {
			default: deepseekUsd(DEEPSEEK_CNY['deepseek-flash']),
			'deepseek-flash': deepseekUsd(DEEPSEEK_CNY['deepseek-flash']),
			'deepseek-v4-pro': deepseekUsd(DEEPSEEK_CNY['deepseek-v4-pro'])
		};

		/**
		 * OpenAI API list prices for the Codex models, USD per 1M tokens
		 * (standard, short context: input / cached input / 30m cache write / output).
		 * They are what the same tokens would cost without the ChatGPT subscription.
		 */
		const OPENAI_PRICING = {
			'gpt-6-astra': { cacheMiss: 10, cacheHit: 1, cacheWrite: 12.5, output: 50 },
			'gpt-6.1-sol': { cacheMiss: 2, cacheHit: 0.1, cacheWrite: 2.5, output: 10 },
			'gpt-6.1-terra': { cacheMiss: 1, cacheHit: 0.05, cacheWrite: 1.25, output: 5 },
			'gpt-6-luna': { cacheMiss: 0.1, cacheHit: 0.01, cacheWrite: 0.125, output: 0.5 },
			'gpt-6-sol': { cacheMiss: 2, cacheHit: 0.2, cacheWrite: 2.5, output: 10 },
			'gpt-5.6-sol': { cacheMiss: 4, cacheHit: 0.4, cacheWrite: 5, output: 20 },
			'gpt-5.6-terra': { cacheMiss: 2, cacheHit: 0.2, cacheWrite: 2.5, output: 12 },
			'gpt-5.6-luna': { cacheMiss: 0.2, cacheHit: 0.02, cacheWrite: 0.25, output: 1.2 }
		};

		/**
		 * Anthropic rate cards by family and minimum version, from the published
		 * price list (USD per 1M tokens, 5-minute cache writes). Versioned ids such
		 * as `claude-opus-5-5` match the highest row whose `min` they reach, so a
		 * new point release keeps the family's current rates.
		 */
		const ANTHROPIC_FAMILIES = {
			opus: [
				{ min: 5.5, rate: { cacheMiss: 4, cacheHit: 0.2, cacheWrite: 5, output: 20 } },
				{ min: 4.5, rate: { cacheMiss: 5, cacheHit: 0.5, cacheWrite: 6.25, output: 25 } },
				{ min: 0, rate: { cacheMiss: 15, cacheHit: 1.5, cacheWrite: 18.75, output: 75 } }
			],
			sonnet: [
				{ min: 5.5, rate: { cacheMiss: 2, cacheHit: 0.1, cacheWrite: 2.5, output: 10 } },
				{ min: 5, rate: { cacheMiss: 2, cacheHit: 0.2, cacheWrite: 2.5, output: 10 } },
				{ min: 0, rate: { cacheMiss: 3, cacheHit: 0.3, cacheWrite: 3.75, output: 15 } }
			],
			haiku: [
				{ min: 5.5, rate: { cacheMiss: 0.1, cacheHit: 0.01, cacheWrite: 0.125, output: 0.5 } },
				{ min: 0, rate: { cacheMiss: 1, cacheHit: 0.1, cacheWrite: 1.25, output: 5 } }
			],
			fable: [
				{ min: 5.1, rate: { cacheMiss: 10, cacheHit: 0.25, cacheWrite: 12.5, output: 50 } },
				{ min: 0, rate: { cacheMiss: 10, cacheHit: 1, cacheWrite: 12.5, output: 50 } }
			],
			mythos: [
				{ min: 5.1, rate: { cacheMiss: 10, cacheHit: 0.25, cacheWrite: 12.5, output: 50 } },
				{ min: 0, rate: { cacheMiss: 10, cacheHit: 1, cacheWrite: 12.5, output: 50 } }
			]
		};

		const PER_TOKENS = 1e6;

		const zh = {
			'pill.cost': '≈ {cost}',
			'dialog.title': '会话用量与费用',
			'dialog.model': '模型',
			'dialog.unknownModel': '默认费率',
			'dialog.input': '输入（未命中缓存）',
			'dialog.cacheRead': '缓存读取',
			'dialog.cacheWrite': '缓存写入',
			'dialog.output': '输出',
			'dialog.total': '合计',
			'dialog.cacheRate': '缓存命中率',
			'dialog.saved': '缓存节省',
			'dialog.note': '按插件内置费率估算，仅供参考，不是账单。',
			'dialog.close': '关闭',
			'panel.label': '用量',
			'panel.title': '用量与余额',
			'panel.refresh': '刷新',
			'panel.totalTokens': '累计令牌',
			'panel.totalCost': '估算费用',
			'panel.sessions': '会话数：{count}',
			'panel.sessionsLabel': '会话数',
			'panel.defaultRate': '按默认费率估算',
			'panel.unused': '暂无使用',
			'panel.moreModels': '另有 {count} 个模型暂无使用',
			'panel.byDay': '按日期',
			'panel.today': '今天',
			'panel.yesterday': '昨天',
			'panel.month': '近 30 天',
			'panel.byProject': '按项目',
			'panel.moreProjects': '另有 {count} 个项目',
			'panel.agentrouter': 'AgentRouter',
			'panel.agentrouterConnect': '连接账户',
			'panel.agentrouterConnected': '账户已连接（ID {id}）',
			'panel.agentrouterDisconnect': '断开账户',
			'panel.agentrouterConfirmDisconnect': '确认断开',
			'panel.agentrouterCancel': '取消',
			'panel.agentrouterConsent': '允许读取账户余额并在本地保存此令牌',
			'panel.agentrouterSave': '验证并保存',
			'panel.agentrouterSaving': '正在验证…',
			'panel.agentrouterToken': '账户访问令牌（Access token）',
			'panel.agentrouterUserId': '用户 ID（New-Api-User）',
			'panel.agentrouterDestination': '令牌发送到：{origin}',
			'panel.agentrouterAccountHelp': '在 AgentRouter 个人账户页面获取 Access token 和用户 ID；不是 sk- 模型 API 密钥。不要在聊天中发送令牌。',
			'panel.agentrouterAccountWarning': '此令牌可能具有账户管理权限。插件仅通过只读 API 查询余额，并使用 Harness 本地凭据存储；不保存到聊天或浏览器存储。',
			'panel.agentrouterAccountBalance': '账户余额',
			'panel.agentrouterAccountUsed': '账户累计支出：{amount}',
			'panel.agentrouterAccountRequests': '账户请求数：{count}',
			'panel.agentrouterAccountRefused': '账户拒绝了令牌或用户 ID',
			'panel.agentrouterAccountInput': '请填写有效的 Access token 和数字用户 ID',
			'panel.agentrouterWrongToken': '需要账户 Access token，不是 sk- 模型密钥',
			'panel.agentrouterStorage': '无法访问 Harness 凭据存储',
			'panel.agentrouterBusy': '另一项账户操作正在进行，请稍后重试',
			'panel.agentrouterBrowserOnly': '只能在已认证的 Harness 页面中连接账户',
			'panel.agentrouterKeyUnavailable': '密钥额度 API 不可用',
			'panel.agentrouterKey': '密钥剩余额度',
			'panel.agentrouterUnlimited': '密钥未设额度上限',
			'panel.agentrouterUsed': '密钥累计已用：{amount}',
			'panel.agentrouterAccount': '账户余额：{amount}',
			'panel.agentrouterExpires': '密钥到期：{date}',
			'panel.agentrouterExpired': '密钥已于 {date} 到期',
			'panel.agentrouterNoExpiry': '密钥无到期时间',
			'panel.agentrouterNote': '密钥额度不等于账户余额，也不保证模型可用。',
			'panel.agentrouterQuotaUnits': '{amount} 额度单位',
			'panel.agentrouterDshTokens': 'DSH：{count} 个令牌',
			'panel.agentrouterDshMessages': '{messages} 次回复 · {sessions} 个会话',
			'panel.agentrouterUpdated': '更新于 {date}',
			'panel.agentrouterStale': '更新失败，显示之前的数据',
			'panel.agentrouterProviderMissing': 'AgentRouter 集成不可用',
			'panel.agentrouterAuth': 'AgentRouter 拒绝了此密钥',
			'panel.agentrouterForbidden': '无权读取密钥用量',
			'panel.agentrouterWaf': 'AgentRouter 返回了防护验证页面',
			'panel.agentrouterNetwork': '无法连接 AgentRouter',
			'panel.agentrouterFormat': '用量 API 返回了未知格式',
			'panel.agentrouterRateLimited': '请求过于频繁，请稍后刷新',
			'panel.agentrouterConfiguration': '无法读取 AgentRouter 设置，请刷新',
			'panel.openrouter': 'OpenRouter 余额',
			'panel.anthropic': 'Anthropic 余额',
			'panel.adminRequired': '需要 Admin 密钥',
			'panel.billingRights': '账单 API 不可用',
			'panel.anthropicSpend': '本月支出',
			'panel.cached': '缓存',
			'panel.noKey': '未保存密钥',
			'panel.unavailable': '不可用',
			'panel.creditsUsed': '已用 {used}，共 {total}',
			'panel.codex': 'Codex（订阅）',
			'panel.codexToday': '今天',
			'panel.codexWeekTokens': '近 7 天',
			'panel.codexTotal': '累计',
			'panel.codexWeek': '每周限额',
			'panel.codexWindow': '每 {hours} 小时限额',
			'panel.codexLeft': '剩余 {percent}%',
			'panel.codexReset': '重置',
			'panel.codexSource': '令牌数来自 Codex CLI 日志；DSH 内的临时线程不保存',
			'panel.codexTag': 'Codex · 订阅',
			'panel.codexApiCost': '按 API 价格计算',
			'panel.codexUsage': '已用 {percent}%',
			'panel.codexRing': '时间 {time}% · 令牌 {used}%',
			'panel.structure': '构成',
			'panel.byModel': '按模型',
			'panel.model': '模型',
			'panel.balance': '余额',
			'panel.toppedUp': '充值余额',
			'panel.bonus': '赠金余额',
			'panel.balanceUnavailable': '登录后查看',
			'panel.loading': '加载中…',
			'panel.error': '无法获取数据',
			'panel.note': '令牌数来自会话投影缓存；费用按插件内置费率估算，不是账单。',
			'panel.retry': '重试'
		};

		const en = {
			'pill.cost': '≈ {cost}',
			'dialog.title': 'Session usage and cost',
			'dialog.model': 'Model',
			'dialog.unknownModel': 'Default rates',
			'dialog.input': 'Input (cache miss)',
			'dialog.cacheRead': 'Cache read',
			'dialog.cacheWrite': 'Cache write',
			'dialog.output': 'Output',
			'dialog.total': 'Total',
			'dialog.cacheRate': 'Cache hit rate',
			'dialog.saved': 'Saved by cache',
			'dialog.note': 'Estimated from the plugin’s built-in rates — approximate, not a bill.',
			'dialog.close': 'Close',
			'panel.label': 'Usage',
			'panel.title': 'Usage and balance',
			'panel.refresh': 'Refresh',
			'panel.totalTokens': 'Total tokens',
			'panel.totalCost': 'Estimated cost',
			'panel.sessions': 'Sessions: {count}',
			'panel.sessionsLabel': 'Sessions',
			'panel.defaultRate': 'Estimated with default rates',
			'panel.unused': 'No usage yet',
			'panel.moreModels': 'and {count} more models without usage',
			'panel.byDay': 'By day',
			'panel.today': 'Today',
			'panel.yesterday': 'Yesterday',
			'panel.month': 'Last 30 days',
			'panel.byProject': 'By project',
			'panel.moreProjects': 'and {count} more projects',
			'panel.agentrouter': 'AgentRouter',
			'panel.agentrouterConnect': 'Connect account',
			'panel.agentrouterConnected': 'Account connected (ID {id})',
			'panel.agentrouterDisconnect': 'Disconnect account',
			'panel.agentrouterConfirmDisconnect': 'Confirm disconnect',
			'panel.agentrouterCancel': 'Cancel',
			'panel.agentrouterConsent': 'Allow balance reads and local storage of this token',
			'panel.agentrouterSave': 'Verify and save',
			'panel.agentrouterSaving': 'Verifying…',
			'panel.agentrouterToken': 'Account access token',
			'panel.agentrouterUserId': 'User ID (New-Api-User)',
			'panel.agentrouterDestination': 'Token destination: {origin}',
			'panel.agentrouterAccountHelp': 'Get the access token and user ID from your AgentRouter personal account page; this is not the sk- model API key. Do not send the token in chat.',
			'panel.agentrouterAccountWarning': 'This token may have account-management privileges. The plugin only reads balance APIs and uses the local Harness credential store; it does not save the token in chat or browser storage.',
			'panel.agentrouterAccountBalance': 'Account balance',
			'panel.agentrouterAccountUsed': 'Spent by account: {amount}',
			'panel.agentrouterAccountRequests': 'Account requests: {count}',
			'panel.agentrouterAccountRefused': 'The account rejected the token or user ID',
			'panel.agentrouterAccountInput': 'Enter a valid access token and numeric user ID',
			'panel.agentrouterWrongToken': 'Use the account access token, not an sk- model key',
			'panel.agentrouterStorage': 'Harness credential storage is unavailable',
			'panel.agentrouterBusy': 'Another account operation is running; retry shortly',
			'panel.agentrouterBrowserOnly': 'Account connection requires the authenticated Harness page',
			'panel.agentrouterKeyUnavailable': 'Key quota API is unavailable',
			'panel.agentrouterKey': 'Remaining key quota',
			'panel.agentrouterUnlimited': 'No key quota limit',
			'panel.agentrouterUsed': 'Used by this key: {amount}',
			'panel.agentrouterAccount': 'Account balance: {amount}',
			'panel.agentrouterExpires': 'Key expires: {date}',
			'panel.agentrouterExpired': 'Key expired: {date}',
			'panel.agentrouterNoExpiry': 'Key does not expire',
			'panel.agentrouterNote': 'Key quota is not the account balance and does not guarantee model availability.',
			'panel.agentrouterQuotaUnits': '{amount} quota units',
			'panel.agentrouterDshTokens': 'DSH: {count} tokens',
			'panel.agentrouterDshMessages': '{messages} replies · {sessions} sessions',
			'panel.agentrouterUpdated': 'Updated {date}',
			'panel.agentrouterStale': 'Refresh failed; showing earlier data',
			'panel.agentrouterProviderMissing': 'AgentRouter integration is unavailable',
			'panel.agentrouterAuth': 'AgentRouter rejected this key',
			'panel.agentrouterForbidden': 'Key usage access denied',
			'panel.agentrouterWaf': 'AgentRouter returned a protection page',
			'panel.agentrouterNetwork': 'Could not reach AgentRouter',
			'panel.agentrouterFormat': 'Usage API returned an unknown format',
			'panel.agentrouterRateLimited': 'Too many requests; refresh later',
			'panel.agentrouterConfiguration': 'Could not read AgentRouter settings; refresh',
			'panel.openrouter': 'OpenRouter balance',
			'panel.anthropic': 'Anthropic balance',
			'panel.adminRequired': 'Admin key required',
			'panel.billingRights': 'Billing API unavailable',
			'panel.anthropicSpend': 'Spent this month',
			'panel.cached': 'cached',
			'panel.noKey': 'No saved key',
			'panel.unavailable': 'Unavailable',
			'panel.creditsUsed': 'used {used} of {total}',
			'panel.codex': 'Codex (subscription)',
			'panel.codexToday': 'Today',
			'panel.codexWeekTokens': 'Last 7 days',
			'panel.codexTotal': 'All time',
			'panel.codexWeek': 'Weekly limit',
			'panel.codexWindow': '{hours}-hour limit',
			'panel.codexLeft': '{percent}% left',
			'panel.codexReset': 'Resets',
			'panel.codexSource': 'Token counts come from Codex CLI logs; DSH ephemeral threads are not saved',
			'panel.codexTag': 'Codex · subscription',
			'panel.codexApiCost': 'At API prices',
			'panel.codexUsage': '{percent}% used',
			'panel.codexRing': 'time {time}% · tokens {used}%',
			'panel.structure': 'Breakdown',
			'panel.byModel': 'By model',
			'panel.model': 'Model',
			'panel.balance': 'Balance',
			'panel.toppedUp': 'Topped-up balance',
			'panel.bonus': 'Granted balance',
			'panel.balanceUnavailable': 'Sign in to view',
			'panel.loading': 'Loading…',
			'panel.error': 'Could not load usage data',
			'panel.note': 'Token counts come from the session projection cache; cost is estimated from the plugin’s built-in rates, not a bill.',
			'panel.retry': 'Retry'
		};

		const ru = {
			'pill.cost': '≈ {cost}',
			'dialog.title': 'Токены и стоимость',
			'dialog.model': 'Модель',
			'dialog.unknownModel': 'Базовый тариф',
			'dialog.input': 'Ввод (без кэша)',
			'dialog.cacheRead': 'Чтение кэша',
			'dialog.cacheWrite': 'Запись кэша',
			'dialog.output': 'Вывод',
			'dialog.total': 'Итого',
			'dialog.cacheRate': 'Попадание в кэш',
			'dialog.saved': 'Сэкономлено кэшем',
			'dialog.note': 'Оценка по встроенным тарифам плагина — приблизительно, не счёт.',
			'dialog.close': 'Закрыть',
			'panel.label': 'Использование',
			'panel.title': 'Использование и баланс',
			'panel.refresh': 'Обновить',
			'panel.totalTokens': 'Всего токенов',
			'panel.totalCost': 'Оценка стоимости',
			'panel.sessions': 'Сессий: {count}',
			'panel.sessionsLabel': 'Сессий',
			'panel.defaultRate': 'Оценка по базовым тарифам',
			'panel.unused': 'Пока не использовалась',
			'panel.moreModels': 'и ещё {count} моделей без использования',
			'panel.byDay': 'По дням',
			'panel.today': 'Сегодня',
			'panel.yesterday': 'Вчера',
			'panel.month': 'За 30 дней',
			'panel.byProject': 'По проектам',
			'panel.moreProjects': 'и ещё {count} проектов',
			'panel.agentrouter': 'AgentRouter',
			'panel.agentrouterConnect': 'Подключить кабинет',
			'panel.agentrouterConnected': 'Кабинет подключён (ID {id})',
			'panel.agentrouterDisconnect': 'Отключить кабинет',
			'panel.agentrouterConfirmDisconnect': 'Подтвердить отключение',
			'panel.agentrouterCancel': 'Отмена',
			'panel.agentrouterConsent': 'Разрешаю чтение баланса и локальное хранение токена',
			'panel.agentrouterSave': 'Проверить и сохранить',
			'panel.agentrouterSaving': 'Проверка…',
			'panel.agentrouterToken': 'Токен кабинета (Access token)',
			'panel.agentrouterUserId': 'ID пользователя (New-Api-User)',
			'panel.agentrouterDestination': 'Токен передаётся: {origin}',
			'panel.agentrouterAccountHelp': 'Access token и ID возьмите на личной странице кабинета AgentRouter. Это не API-ключ моделей sk-. Не отправляйте токен в чат.',
			'panel.agentrouterAccountWarning': 'Токен может иметь права управления аккаунтом. Плагин использует только API чтения баланса и штатное локальное хранилище Harness; токен не сохраняется в чате или хранилище браузера.',
			'panel.agentrouterAccountBalance': 'Баланс аккаунта',
			'panel.agentrouterAccountUsed': 'Расход аккаунта: {amount}',
			'panel.agentrouterAccountRequests': 'Запросов аккаунта: {count}',
			'panel.agentrouterAccountRefused': 'Кабинет отклонил токен или ID пользователя',
			'panel.agentrouterAccountInput': 'Укажите токен кабинета и числовой ID пользователя',
			'panel.agentrouterWrongToken': 'Нужен Access token кабинета, а не ключ моделей sk-',
			'panel.agentrouterStorage': 'Хранилище учётных данных Harness недоступно',
			'panel.agentrouterBusy': 'Другая операция кабинета ещё выполняется; повторите позже',
			'panel.agentrouterBrowserOnly': 'Подключение доступно только на авторизованной странице Harness',
			'panel.agentrouterKeyUnavailable': 'API квоты ключа недоступен',
			'panel.agentrouterKey': 'Остаток квоты ключа',
			'panel.agentrouterUnlimited': 'Без лимита ключа',
			'panel.agentrouterUsed': 'Использовано ключом: {amount}',
			'panel.agentrouterAccount': 'Баланс аккаунта: {amount}',
			'panel.agentrouterExpires': 'Ключ действует до: {date}',
			'panel.agentrouterExpired': 'Ключ истёк: {date}',
			'panel.agentrouterNoExpiry': 'Бессрочный ключ',
			'panel.agentrouterNote': 'Квота ключа — не баланс аккаунта и не гарантия доступности моделей.',
			'panel.agentrouterQuotaUnits': '{amount} ед. квоты',
			'panel.agentrouterDshTokens': 'DSH: {count} токенов',
			'panel.agentrouterDshMessages': 'Ответов: {messages} · Сессий: {sessions}',
			'panel.agentrouterUpdated': 'Обновлено: {date}',
			'panel.agentrouterStale': 'Обновить не удалось; показаны предыдущие данные',
			'panel.agentrouterProviderMissing': 'Интеграция AgentRouter недоступна',
			'panel.agentrouterAuth': 'AgentRouter отклонил ключ',
			'panel.agentrouterForbidden': 'Нет доступа к статистике ключа',
			'panel.agentrouterWaf': 'AgentRouter вернул страницу защиты',
			'panel.agentrouterNetwork': 'Не удалось связаться с AgentRouter',
			'panel.agentrouterFormat': 'Неизвестный формат ответа API статистики',
			'panel.agentrouterRateLimited': 'Слишком частые запросы; обновите позже',
			'panel.agentrouterConfiguration': 'Не удалось прочитать настройки AgentRouter; обновите данные',
			'panel.openrouter': 'Баланс OpenRouter',
			'panel.anthropic': 'Баланс Anthropic',
			'panel.adminRequired': 'Нужен Admin-ключ',
			'panel.billingRights': 'Биллинг-API недоступен',
			'panel.anthropicSpend': 'Расход за месяц',
			'panel.cached': 'из кэша',
			'panel.noKey': 'Ключ не сохранён',
			'panel.unavailable': 'Недоступно',
			'panel.creditsUsed': 'использовано {used} из {total}',
			'panel.codex': 'Codex (подписка)',
			'panel.codexToday': 'Сегодня',
			'panel.codexWeekTokens': 'За 7 дней',
			'panel.codexTotal': 'Всего',
			'panel.codexWeek': 'Недельный лимит',
			'panel.codexWindow': 'Лимит на {hours} ч',
			'panel.codexLeft': 'осталось {percent}%',
			'panel.codexReset': 'Сброс',
			'panel.codexSource': 'токены — из журналов Codex CLI; запуски из DSH идут во временных тредах и не сохраняются',
			'panel.codexTag': 'Codex · подписка',
			'panel.codexApiCost': 'По ценам API',
			'panel.codexUsage': 'использовано {percent}%',
			'panel.codexRing': 'время {time}% · токены {used}%',
			'panel.structure': 'Структура',
			'panel.byModel': 'По моделям',
			'panel.model': 'Модель',
			'panel.balance': 'Баланс',
			'panel.toppedUp': 'Пополненный',
			'panel.bonus': 'Бонусный',
			'panel.balanceUnavailable': 'Войдите, чтобы посмотреть',
			'panel.loading': 'Загрузка…',
			'panel.error': 'Не удалось получить данные',
			'panel.note': 'Токены берутся из кэша проекций сессий; стоимость — оценка по встроенным тарифам плагина, а не счёт.',
			'panel.retry': 'Повторить'
		};

		const PILL_STYLE = {
			boxSizing: 'border-box',
			border: 'none',
			borderRadius: 'var(--dsw-radius-sm)',
			background: 'transparent',
			color: 'var(--dsw-alias-label-tertiary)',
			font: 'inherit',
			fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
			lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
			fontVariantNumeric: 'tabular-nums',
			whiteSpace: 'nowrap',
			display: 'inline-flex',
			alignItems: 'center',
			gap: '6px',
			padding: '1px 8px',
			cursor: 'pointer'
		};

		const OVERLAY_STYLE = {
			position: 'fixed',
			inset: 0,
			zIndex: 2147483000,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '16px',
			background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24))'
		};

		const CARD_STYLE = {
			boxSizing: 'border-box',
			width: 'min(360px, calc(100vw - 32px))',
			background: 'var(--dsw-alias-bg-layer-1, #fff)',
			border: '1px solid var(--dsw-alias-border)',
			borderRadius: 'var(--dsw-radius-md)',
			boxShadow: 'var(--dsw-shadow-lv3)',
			color: 'var(--dsw-alias-label-primary)',
			padding: '14px 16px 12px',
			font: 'inherit',
			fontSize: '13px',
			lineHeight: 1.5
		};

		const MUTED = { color: 'var(--dsw-alias-label-secondary)' };
		const NUM = { fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' };

		/** Thousands-separated integer token count. */
		function formatTokens(value) {
			return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
		}

		/** Small-money display: more decimals while the amount is below a cent. */
		function formatCost(usd) {
			if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
			if (usd < 0.01) return '$' + usd.toFixed(4);
			if (usd < 1) return '$' + usd.toFixed(3);
			return '$' + usd.toFixed(2);
		}

		/** Published Anthropic rate for a versioned Claude id, or undefined for other ids. */
		function anthropicRate(model) {
			if (typeof model !== 'string') return undefined;
			// `claude-opus-5-5`, `claude-opus-5.5`, and `claude-sonnet-4-5-20250929` all read as family + major.minor;
			// any trailing date group is ignored.
			const match = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/.exec(model);
			if (match === null) return undefined;
			const rows = ANTHROPIC_FAMILIES[match[1]];
			const version = Number(`${match[2]}.${match[3] ?? '0'}`);
			for (const row of rows) if (version >= row.min) return row.rate;
			return rows[rows.length - 1].rate;
		}

		/** Rates for one model id, falling back to the default row. */
		function rateFor(model) {
			if (model !== null && model !== undefined) {
				if (PRICING[model] !== undefined) return PRICING[model];
				if (OPENAI_PRICING[model] !== undefined) return OPENAI_PRICING[model];
			}
			return anthropicRate(model) ?? PRICING.default;
		}

		/** Whether this model id has its own rate row instead of the default one. */
		function hasRate(model) {
			if (model === null || model === undefined) return false;
			return (
				PRICING[model] !== undefined ||
				OPENAI_PRICING[model] !== undefined ||
				anthropicRate(model) !== undefined
			);
		}

		/** A zeroed token bucket set, so the panel renders before any data arrives. */
		function emptyTotals() {
			return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
		}

		/** Sum of the four disjoint billing buckets. */
		function totalOf(buckets) {
			return (
				(buckets?.uncachedInputTokens ?? 0) +
				(buckets?.cacheReadTokens ?? 0) +
				(buckets?.cacheWriteTokens ?? 0) +
				(buckets?.outputTokens ?? 0)
			);
		}

		/** USD cost of one aggregated bucket group priced by the group's model. */
		function costOf(buckets, model) {
			const rate = rateFor(model);
			return (
				((buckets?.uncachedInputTokens ?? 0) * rate.cacheMiss +
					(buckets?.cacheReadTokens ?? 0) * rate.cacheHit +
					(buckets?.cacheWriteTokens ?? 0) * rate.cacheWrite +
					(buckets?.outputTokens ?? 0) * rate.output) /
				PER_TOKENS
			);
		}

		/** Platform-style amount with its currency symbol and sub-cent precision. */
		function formatMoney(amount, currency) {
			const value = Number(amount);
			if (!Number.isFinite(value)) return String(amount);
			const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : '';
			const text = Math.abs(value) < 0.01 && value !== 0 ? value.toFixed(4) : value.toFixed(2);
			return symbol + text;
		}

		/** Fold the durable token-usage projection into tokens and USD. */
		function summarize(usage, model) {
			const rate = rateFor(model);
			const uncached = usage.uncachedInputTokens ?? 0;
			const cacheRead = usage.cacheReadTokens ?? 0;
			const cacheWrite = usage.cacheWriteTokens ?? 0;
			const output = usage.outputTokens ?? 0;
			const billed = uncached + cacheRead + cacheWrite;
			const costInput = (uncached * rate.cacheMiss + cacheRead * rate.cacheHit + cacheWrite * rate.cacheWrite) / PER_TOKENS;
			const costOutput = (output * rate.output) / PER_TOKENS;
			return {
				uncached,
				cacheRead,
				cacheWrite,
				output,
				billed,
				totalTokens: billed + output,
				cost: {
					input: (uncached * rate.cacheMiss) / PER_TOKENS,
					cacheRead: (cacheRead * rate.cacheHit) / PER_TOKENS,
					cacheWrite: (cacheWrite * rate.cacheWrite) / PER_TOKENS,
					output: costOutput
				},
				totalCost: costInput + costOutput,
				saved: (cacheRead * Math.max(0, rate.cacheMiss - rate.cacheHit)) / PER_TOKENS,
				hitRate: billed > 0 ? (cacheRead / billed) * 100 : null
			};
		}

		/** Local calendar day key, matching the host ledger's day buckets. */
		function dateKey(offsetDays) {
			const date = new Date();
			date.setDate(date.getDate() - offsetDays);
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return `${date.getFullYear()}-${month}-${day}`;
		}

		/** Shared cache for the host ledger, so the dock pill and the panel fetch once. */
		let ledgerCache = { at: 0, value: null, inflight: null };

		/** Fetch the per-model/per-day ledger, sharing one in-flight request. */
		function fetchLedger() {
			const now = Date.now();
			if (ledgerCache.value !== null && now - ledgerCache.at < 20_000) return Promise.resolve(ledgerCache.value);
			if (ledgerCache.inflight !== null) return ledgerCache.inflight;
			ledgerCache.inflight = fetch('/token-usage/summary', {
				cache: 'no-store',
				headers: { accept: 'application/json' }
			})
				.then((response) => (response.ok ? response.json() : null))
				.then((value) => {
					ledgerCache = { at: Date.now(), value, inflight: null };
					return value;
				})
				.catch(() => {
					ledgerCache.inflight = null;
					return null;
				});
			return ledgerCache.inflight;
		}

		/** One session's per-model rows, or null when the ledger has no entry yet. */
		function ledgerSession(ledger, sessionId) {
			if (ledger === null || sessionId === undefined) return null;
			const entry = ledger?.bySession?.[sessionId];
			return entry?.byModel?.length ? entry : null;
		}

		/** USD cost of one ledger row list. */
		function modelsCost(models) {
			return (models ?? []).reduce((sum, group) => sum + costOf(group, group.model), 0);
		}

		function Row({ label, tokens, cost }) {
			return h(
				'div',
				{ style: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '12px', padding: '3px 0' } },
				h('span', { style: MUTED }, label),
				h('span', { style: NUM }, tokens),
				h('span', { style: { ...NUM, minWidth: '62px' } }, cost)
			);
		}

		/** The details dialog: per-model or per-bucket tokens and money, totals, cache savings. */
		function CostDialog({ t, model, summary, models, onClose }) {
			React.useEffect(() => {
				const onKey = (event) => {
					if (event.key === 'Escape') onClose();
				};
				document.addEventListener('keydown', onKey);
				return () => document.removeEventListener('keydown', onKey);
			}, [onClose]);

			const hitRate = summary.hitRate === null ? null : Math.round(summary.hitRate * 10) / 10;
			const title = t('dialog.title');
			const perModel = Array.isArray(models) && models.length > 0 ? models : null;
			const totalTokens = perModel === null ? summary.totalTokens : perModel.reduce((sum, group) => sum + totalOf(group), 0);
			const totalCost = perModel === null ? summary.totalCost : modelsCost(perModel);

			return h(
				'div',
				{
					style: OVERLAY_STYLE,
					onPointerDown: (event) => {
						if (event.target === event.currentTarget) onClose();
					}
				},
				h(
					'div',
					{
						role: 'dialog',
						'aria-modal': 'true',
						'aria-label': title,
						'data-token-usage-dialog': '',
						style: CARD_STYLE
					},
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' } },
						h('span', { style: { fontWeight: 600 } }, title),
						h('span', { style: { ...MUTED, fontSize: '12px' } }, formatCost(totalCost))
					),
					perModel === null &&
						h(
							'div',
							{ style: { ...MUTED, fontSize: '12px', marginTop: '2px' } },
							t('dialog.model') + ': ' + (model ?? t('dialog.unknownModel'))
						),
					h('div', {
						style: {
							height: '1px',
							background: 'var(--dsw-alias-separator-primary)',
							margin: '10px 0 8px'
						}
					}),
					perModel === null
						? h(
								'div',
								null,
								h(Row, {
									label: t('dialog.input'),
									tokens: formatTokens(summary.uncached),
									cost: formatCost(summary.cost.input)
								}),
								h(Row, {
									label: t('dialog.cacheRead'),
									tokens: formatTokens(summary.cacheRead),
									cost: formatCost(summary.cost.cacheRead)
								}),
								h(Row, {
									label: t('dialog.cacheWrite'),
									tokens: formatTokens(summary.cacheWrite),
									cost: formatCost(summary.cost.cacheWrite)
								}),
								h(Row, {
									label: t('dialog.output'),
									tokens: formatTokens(summary.output),
									cost: formatCost(summary.cost.output)
								})
							)
						: h(
								'div',
								null,
								perModel.map((group) =>
									h(Row, {
										key: group.model,
										label: group.model === 'unknown' ? t('dialog.unknownModel') : group.model,
										tokens: formatTokens(totalOf(group)),
										cost: formatCost(costOf(group, group.model))
									})
								)
							),
					h('div', {
						style: {
							height: '1px',
							background: 'var(--dsw-alias-separator-primary)',
							margin: '8px 0 6px'
						}
					}),
					h(Row, {
						label: t('dialog.total'),
						tokens: formatTokens(totalTokens),
						cost: formatCost(totalCost)
					}),
					perModel === null &&
						hitRate !== null &&
						h(Row, { label: t('dialog.cacheRate'), tokens: hitRate + '%', cost: '' }),
					perModel === null &&
						summary.saved > 0 &&
						h(Row, { label: t('dialog.saved'), tokens: '', cost: '−' + formatCost(summary.saved) }),
					h(
						'span',
						{ style: { ...MUTED, display: 'block', fontSize: '11px', marginTop: '8px' } },
						t('dialog.note')
					),
					h(
						'div',
						{ style: { display: 'flex', justifyContent: 'flex-end', marginTop: '10px' } },
						h(
							'button',
							{
								type: 'button',
								onClick: onClose,
								style: {
									font: 'inherit',
									padding: '4px 12px',
									borderRadius: 'var(--dsw-radius-sm)',
									border: '1px solid var(--dsw-alias-border)',
									background: 'var(--dsw-alias-bg-layer-2, transparent)',
									color: 'var(--dsw-alias-label-primary)',
									cursor: 'pointer'
								}
							},
							t('dialog.close')
						)
					)
				)
			);
		}

		/** Stable stand-ins so the hook order never depends on the injected props. */
		function useNoProjection() {
			return undefined;
		}

		function identityText(key) {
			return key;
		}

		/** Dock pill: the session's cost, opening the full breakdown. */
		function UsageCostPill(props) {
			const [open, setOpen] = React.useState(false);
			const [ledgerModels, setLedgerModels] = React.useState(null);
			const useProjection = typeof props.useProjection === 'function' ? props.useProjection : useNoProjection;
			const t = typeof props.t === 'function' ? props.t : identityText;
			const usage = useProjection('tokenUsage');
			const selection = useProjection('modelSelection');
			const model = selection?.lastUsed?.model ?? selection?.pending?.model ?? null;
			const sessionId = props.sessionId;
			const usageKey =
				usage === undefined || usage === null
					? ''
					: `${usage.uncachedInputTokens}/${usage.cacheReadTokens}/${usage.cacheWriteTokens}/${usage.outputTokens}`;

			// The ledger prices every turn by the model that actually served it, so a
			// mid-session switch keeps both halves of the bill.
			React.useEffect(() => {
				let alive = true;
				fetchLedger().then((ledger) => {
					if (!alive) return;
					const entry = ledgerSession(ledger, sessionId);
					setLedgerModels(entry?.byModel ?? null);
				});
				return () => {
					alive = false;
				};
			}, [sessionId, usageKey]);

			if (usage === undefined || usage === null) return null;
			const summary = summarize(usage, model);
			const perModel = ledgerModels !== null && ledgerModels.length > 0 ? ledgerModels : null;
			const totalTokens =
				perModel === null ? summary.totalTokens : perModel.reduce((sum, group) => sum + totalOf(group), 0);
			const totalCost = perModel === null ? summary.totalCost : modelsCost(perModel);
			if (totalTokens === 0 && totalCost === 0) return null;

			const label = t('pill.cost', { cost: formatCost(totalCost) });

			return h(
				React.Fragment,
				null,
				h(
					'span',
					{ style: { display: 'inline-flex', minWidth: 0 } },
					h(
						'button',
						{
							type: 'button',
							'data-token-usage-pill': '',
							title: label,
							'aria-label': label,
							'aria-haspopup': 'dialog',
							'aria-expanded': open,
							onClick: () => setOpen(true),
							style: PILL_STYLE
						},
						h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label)
					)
				),
				open &&
					ReactDOM.createPortal(
						h(CostDialog, { t, model, summary, models: perModel, onClose: () => setOpen(false) }),
						document.body
					)
			);
		}

		/** Sidebar glyph for the Usage panel, drawn with currentColor. */
		function UsagePanelIcon({ size = 16 }) {
			return h(
				'svg',
				{ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
				h('rect', { x: 2.5, y: 4.5, width: 19, height: 15, rx: 3.5, stroke: 'currentColor', strokeWidth: 1.6 }),
				h('path', { d: 'M3 9.5h18', stroke: 'currentColor', strokeWidth: 1.6 }),
				h('path', { d: 'M7 14.5v2.2M12 13v3.7M17 15.2v1.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })
			);
		}

		/** Chart palette: theme state tokens with neutral fallbacks for other themes. */
		const CHART = {
			cacheRead: 'var(--dsw-alias-state-business-primary, #2b7fd4)',
			uncached: 'var(--dsw-alias-label-tertiary, #8a8f98)',
			output: 'var(--dsw-alias-state-success-primary, #1f9d55)',
			cacheWrite: 'var(--dsw-alias-state-warn-primary, #b7791f)'
		};

		/** Share of a part in a total, as a display percentage; 0 for an empty total. */
		function percentOf(value, total) {
			if (!(total > 0)) return 0;
			return (value / total) * 100;
		}

		/** Small percentage label: one decimal below 10%, whole numbers above. */
		function percentText(value, total) {
			if (!(value > 0)) return '0%';
			const share = percentOf(value, total);
			return (share < 10 ? share.toFixed(1) : Math.round(share).toString()) + '%';
		}

		/** Donut of token composition; `pathLength` keeps every segment in percent units. */
		function Donut({ segments, size = 148, thickness = 16, center, caption, ariaLabel }) {
			const total = segments.reduce((sum, segment) => sum + segment.value, 0);
			const radius = (size - thickness) / 2 - 3;
			const middle = size / 2;
			let offset = 0;
			const arcs = [];
			const gap = 1.2;
			for (const segment of segments) {
				if (!(segment.value > 0)) continue;
				const share = percentOf(segment.value, total);
				// Slices below half a percent are sub-pixel on this ring and would only
				// smear into their neighbour; the legend still reports them exactly.
				if (share < 0.5) {
					offset += share;
					continue;
				}
				const arc = Math.max(0.6, share - gap);
				arcs.push(
					h('circle', {
						key: segment.key,
						cx: middle,
						cy: middle,
						r: radius,
						fill: 'none',
						stroke: segment.color,
						strokeWidth: thickness,
						pathLength: 100,
						strokeDasharray: `${arc} ${100 - arc}`,
						strokeDashoffset: -(offset + gap / 2),
						transform: `rotate(-90 ${middle} ${middle})`
					})
				);
				offset += share;
			}
			return h(
				'svg',
				{ viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': ariaLabel },
				h('circle', {
					cx: middle,
					cy: middle,
					r: radius,
					fill: 'none',
					stroke: 'var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.06))',
					strokeWidth: thickness,
					strokeLinecap: 'round'
				}),
				arcs,
				h(
					'text',
					{
						x: middle,
						y: middle + 2,
						textAnchor: 'middle',
						fill: 'var(--dsw-alias-label-primary)',
						style: { fontSize: '20px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }
					},
					center
				),
				h(
					'text',
					{
						x: middle,
						y: middle + 18,
						textAnchor: 'middle',
						fill: 'var(--dsw-alias-label-tertiary)',
						style: { fontSize: '10px' }
					},
					caption
				)
			);
		}

		function StatTile({ label, value }) {
			return h(
				'div',
				{ style: { minWidth: '72px' } },
				h('div', { style: { fontSize: '16px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 } }, value),
				h('div', { style: { ...MUTED, fontSize: '11px', lineHeight: 1.3 } }, label)
			);
		}

		function LegendRow({ color, label, tokens, percent }) {
			return h(
				'div',
				{
					style: {
						display: 'grid',
						gridTemplateColumns: '10px 1fr auto auto',
						gap: '10px',
						alignItems: 'center',
						padding: '5px 0'
					}
				},
				h('span', {
					style: { width: '9px', height: '9px', borderRadius: '50%', background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }
				}),
				h('span', { style: { ...MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
				h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, tokens),
				h(
					'span',
					{
						style: {
							...MUTED,
							fontVariantNumeric: 'tabular-nums',
							minWidth: '46px',
							textAlign: 'center',
							padding: '1px 8px',
							borderRadius: '999px',
							background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04))',
							fontSize: '11px'
						}
					},
					percent
				)
			);
		}

		/** One model row: a usage bar when the model was used, a muted track when it was not. */
		function ModelBar({ name, subtitle, detail, share, color, note }) {
			return h(
				'div',
				{ style: { padding: '7px 0' } },
				h(
					'div',
					{ style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px' } },
					h(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'baseline',
								gap: '6px',
								minWidth: 0,
								overflow: 'hidden'
							}
						},
						h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
						subtitle !== undefined && h('span', { style: { ...MUTED, fontSize: '11px', whiteSpace: 'nowrap' } }, subtitle)
					),
					h('span', { style: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, detail)
				),
				h(
					'div',
					{
						style: {
							height: '7px',
							marginTop: '6px',
							borderRadius: '999px',
							background: 'var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.06))',
							overflow: 'hidden'
						}
					},
					share !== null &&
						h('div', {
							style: {
								width: Math.max(1.5, Math.min(100, share)) + '%',
								height: '100%',
								borderRadius: '999px',
								background: color
							}
					})
				),
				note !== undefined && h('div', { style: { ...MUTED, fontSize: '11px', marginTop: '4px' } }, note)
			);
		}

		/** Two-ring gauge: the outer ring is time elapsed in the window, the inner one is usage. */
		function Gauge({ size = 96, thickness = 8, outer, inner, center }) {
			const middle = size / 2;
			const gap = 6;
			const radiusOuter = (size - thickness) / 2 - 1;
			const radiusInner = radiusOuter - thickness - gap;
			const clamp = (value) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
			const ring = (radius, percent, stroke, key, opacity) => [
				h('circle', {
					key: `${key}-track`,
					cx: middle,
					cy: middle,
					r: radius,
					fill: 'none',
					stroke: 'var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.06))',
					strokeWidth: thickness
				}),
				h('circle', {
					key,
					cx: middle,
					cy: middle,
					r: radius,
					fill: 'none',
					stroke,
					strokeOpacity: opacity,
					strokeWidth: thickness,
					pathLength: 100,
					strokeDasharray: `${clamp(percent)} ${100 - clamp(percent)}`,
					transform: `rotate(-90 ${middle} ${middle})`,
					strokeLinecap: 'round'
				})
			];
			return h(
				'svg',
				{ viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': center },
				ring(radiusOuter, outer, 'var(--dsw-alias-label-tertiary, #8a8f98)', 'outer', 0.45),
				ring(radiusInner, inner, 'var(--dsw-alias-state-business-primary, #2b7fd4)', 'inner', 1),
				h(
					'text',
					{
						x: middle,
						y: middle + 4,
						textAnchor: 'middle',
						fill: 'var(--dsw-alias-label-primary)',
						style: { fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }
					},
					center
				)
			);
		}

		function agentRouterError(reason, t) {
			const keys = {
				unauthorized: 'panel.agentrouterAuth', forbidden: 'panel.agentrouterForbidden',
				waf: 'panel.agentrouterWaf', network: 'panel.agentrouterNetwork', timeout: 'panel.agentrouterNetwork',
				'invalid-response': 'panel.agentrouterFormat', 'rate-limited': 'panel.agentrouterRateLimited',
				configuration: 'panel.agentrouterConfiguration', 'configuration-changed': 'panel.agentrouterConfiguration',
				'account-refused': 'panel.agentrouterAccountRefused', 'invalid-input': 'panel.agentrouterAccountInput',
				'wrong-token-kind': 'panel.agentrouterWrongToken', storage: 'panel.agentrouterStorage',
				busy: 'panel.agentrouterBusy', 'browser-only': 'panel.agentrouterBrowserOnly',
				unsupported: 'panel.agentrouterKeyUnavailable'
			};
			return t(keys[reason] ?? 'panel.unavailable');
		}

		/** A user-only authority grant: no chat, localStorage, or token readback. */
		function AgentRouterBinding({ account, onAction, onUpdated, t }) {
			const binding = account?.binding;
			const [open, setOpen] = React.useState(false);
			const [confirm, setConfirm] = React.useState(false);
			const [userId, setUserId] = React.useState('');
			const [token, setToken] = React.useState('');
			const [consent, setConsent] = React.useState(false);
			const [pending, setPending] = React.useState(false);
			const [error, setError] = React.useState(null);
			const request = React.useRef(null);
			React.useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
			const act = async (action) => {
				if (request.current !== null || pending || typeof onAction !== 'function' || !binding) return;
				if (action === 'connect' && !consent) return;
				const active = new AbortController();
				request.current = active;
				setPending(true);
				setError(null);
				try {
					const result = await onAction({ action, revision: binding.revision,
						...(action === 'connect' ? { userId, token, origin: binding.connectOrigin } : {}) }, active.signal);
					if (active.signal.aborted || request.current !== active) return;
					if (!result?.ok) setError(result?.reason ?? 'network');
					else { setOpen(false); setConfirm(false); setConsent(false); onUpdated?.(result.value); }
				} catch { if (!active.signal.aborted && request.current === active) setError('network'); }
				finally {
					if (request.current === active) { setToken(''); setPending(false); request.current = null; }
				}
			};
			const button = { font: 'inherit', fontSize: '12px', padding: '5px 9px', borderRadius: '5px',
				border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
				color: 'var(--dsw-alias-label-primary)', cursor: pending ? 'default' : 'pointer' };
			const input = { boxSizing: 'border-box', width: '100%', minWidth: 0, font: 'inherit', fontSize: '12px',
				padding: '6px 8px', marginTop: '3px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border-l2)',
				background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' };
			return h('div', { style: { marginTop: '12px', fontSize: '11px' } },
				binding?.configured && h('div', { style: MUTED }, t('panel.agentrouterConnected', { id: binding.userId })),
				binding?.origin && h('div', { style: { ...MUTED, marginTop: '4px', overflowWrap: 'anywhere' } }, binding.origin),
				error !== null && h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', marginTop: '6px' } }, agentRouterError(error, t)),
				binding?.configured
					? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
						!confirm
							? h('button', { type: 'button', disabled: pending, style: button, onClick: () => setConfirm(true) }, t('panel.agentrouterDisconnect'))
							: h(React.Fragment, null,
								h('button', { type: 'button', disabled: pending, style: button, onClick: () => act('disconnect') }, t('panel.agentrouterConfirmDisconnect')),
								h('button', { type: 'button', disabled: pending, style: button, onClick: () => setConfirm(false) }, t('panel.agentrouterCancel'))))
					: !open
						? h('button', { type: 'button', style: { ...button, marginTop: '8px' },
							disabled: !binding?.available || typeof onAction !== 'function', onClick: () => { setOpen(true); setError(null); } }, t('panel.agentrouterConnect'))
						: h('form', { onSubmit: (event) => { event.preventDefault(); act('connect'); }, style: { marginTop: '8px' } },
							h('div', { style: { ...MUTED, lineHeight: 1.5 } }, t('panel.agentrouterAccountHelp')),
							h('div', { style: { ...MUTED, marginTop: '6px', overflowWrap: 'anywhere' } }, t('panel.agentrouterDestination', { origin: binding?.connectOrigin ?? '—' })),
							h('label', { style: { display: 'block', marginTop: '8px' } }, t('panel.agentrouterUserId'),
								h('input', { type: 'text', inputMode: 'numeric', pattern: '[0-9]+', required: true, maxLength: 16,
									value: userId, disabled: pending, autoComplete: 'off', style: input, onChange: (event) => setUserId(event.target.value) })),
							h('label', { style: { display: 'block', marginTop: '8px' } }, t('panel.agentrouterToken'),
								h('input', { type: 'password', required: true, maxLength: 4096, value: token, disabled: pending,
									autoComplete: 'new-password', spellCheck: false, autoCapitalize: 'none', style: input,
									onChange: (event) => setToken(event.target.value) })),
							h('div', { style: { ...MUTED, lineHeight: 1.5, marginTop: '8px' } }, t('panel.agentrouterAccountWarning')),
							h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '8px', lineHeight: 1.5 } },
								h('input', { type: 'checkbox', required: true, checked: consent, disabled: pending, onChange: (event) => setConsent(event.target.checked) }),
								t('panel.agentrouterConsent')),
							h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } },
								h('button', { type: 'submit', style: button, disabled: pending || !consent || !binding?.available }, t(pending ? 'panel.agentrouterSaving' : 'panel.agentrouterSave')),
								h('button', { type: 'button', style: button, disabled: pending, onClick: () => { setOpen(false); setToken(''); setConsent(false); setError(null); } }, t('panel.agentrouterCancel'))))
			);
		}

		/** Actual account balance, optional key quota, and DSH token counts are separate figures. */
		function AgentRouterCard({ source, usage, account, onAccountAction, onAccountUpdated, t }) {
			const keyReady = source?.status === 'ready';
			const accountReady = account?.status === 'ready';
			const amount = (value, origin) => !Number.isFinite(value) ? '—' :
				origin?.currency === 'USD' || origin?.currency === 'CNY' ? formatMoney(value, origin.currency) :
				t('panel.agentrouterQuotaUnits', { amount: formatTokens(value) });
			const date = (ms) => new Date(ms).toLocaleString(undefined, {
				day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
			const detail = { ...MUTED, fontSize: '11px', marginTop: '4px', overflowWrap: 'anywhere' };
			const active = accountReady ? account : keyReady ? source : null;
			return h('div', { 'data-usage-provider': 'agentrouter', style: { minWidth: 0, overflowWrap: 'anywhere' } },
				h('div', { style: { ...MUTED, fontSize: '11px' } }, t('panel.agentrouter')),
				accountReady && h(React.Fragment, null,
					h('div', { style: { fontSize: '24px', fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' } }, amount(account.balance, account)),
					h('div', { style: detail }, t('panel.agentrouterAccountBalance')),
					account.used !== null && h('div', { style: detail }, t('panel.agentrouterAccountUsed', { amount: amount(account.used, account) })),
					Number.isFinite(account.requests) && h('div', { style: detail }, t('panel.agentrouterAccountRequests', { count: formatTokens(account.requests) }))),
				account?.binding?.configured && !accountReady && h('div', { role: 'status', style: detail }, agentRouterError(account.reason, t)),
				keyReady && h(React.Fragment, null,
					h('div', { style: { ...detail, fontSize: accountReady ? '12px' : '18px', fontWeight: 600 } }, source.unlimited
						? t('panel.agentrouterUnlimited') : t('panel.agentrouterKey') + ': ' + amount(source.balance, source)),
					h('div', { style: detail }, t('panel.agentrouterUsed', { amount: amount(source.used, source) })),
					!accountReady && source.account !== undefined && h('div', { style: detail }, t('panel.agentrouterAccount', { amount: amount(source.account.balance, source) })),
					h('div', { style: detail }, source.expiresAt === null ? t('panel.agentrouterNoExpiry') :
						t(source.expiresAt * 1000 <= Date.now() ? 'panel.agentrouterExpired' : 'panel.agentrouterExpires', { date: date(source.expiresAt * 1000) }))),
				!keyReady && !accountReady && h('div', { style: detail }, source?.status === 'missing' ? t('panel.noKey') :
					source?.status === 'provider-unavailable' ? t('panel.agentrouterProviderMissing') : agentRouterError(source?.reason, t)),
				active?.stale === true && h('div', { role: 'status', style: { ...detail, color: 'var(--dsw-alias-state-warn-primary)' } }, t('panel.agentrouterStale')),
				Number.isFinite(active?.at) && h('div', { style: detail }, t('panel.agentrouterUpdated', { date: date(active.at) })),
				usage !== undefined && h('div', { style: { ...detail, marginTop: '8px' } }, t('panel.agentrouterDshTokens', { count: formatTokens(totalOf(usage)) })),
				usage !== undefined && h('div', { style: detail }, t('panel.agentrouterDshMessages', { messages: formatTokens(usage.messages), sessions: formatTokens(usage.sessions) })),
				keyReady && h('div', { style: { ...detail, marginTop: '8px' } }, t('panel.agentrouterNote')),
				h(AgentRouterBinding, { account, onAction: onAccountAction, onUpdated: onAccountUpdated, t })
			);
		}

		/** Whole-profile usage panel: totals, composition donut, model bars, account balance. */
		function UsagePanel(props) {
			const t = typeof props.t === 'function' ? props.t : identityText;
			const [state, setState] = React.useState({ loading: true, summary: null, balance: null, catalog: null, balances: null, codex: null, agentRouterAccount: null });
			const generation = React.useRef(0);
			const load = React.useCallback(() => {
				const current = ++generation.current;
				setState((previous) => ({ ...previous, loading: true }));
				const safe = (fn) => Promise.resolve().then(() => typeof fn === 'function' ? fn() : null).catch(() => null);
				Promise.all([props.loadSummary, props.loadBalance, props.loadModels, props.loadBalances, props.loadCodex, props.loadAgentRouterAccount].map(safe)).then(
					([summary, balance, catalog, balances, codex, agentRouterAccount]) => {
						if (generation.current !== current) return;
						setState({ loading: false, summary, balance, catalog, balances, codex, agentRouterAccount });
					}
				);
			}, [props.loadSummary, props.loadBalance, props.loadModels, props.loadBalances, props.loadCodex, props.loadAgentRouterAccount]);
			React.useEffect(() => { load(); return () => { generation.current += 1; }; }, [load]);
			const accountUpdated = (value) => {
				generation.current += 1;
				setState((previous) => ({ ...previous, loading: false, agentRouterAccount: value }));
			};

			const { loading, summary, balance, catalog, balances, codex, agentRouterAccount } = state;
			const totals = summary?.totals ?? emptyTotals();
			const totalTokens = totalOf(totals);
			const billed = totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
			const hitRate = percentOf(totals.cacheReadTokens, billed);
			const counted = summary?.sessions?.counted ?? 0;
			const totalCost =
				summary === null ? 0 : (summary.byModel ?? []).reduce((sum, group) => sum + costOf(group, group.model), 0);
			const segments = [
				{ key: 'cacheRead', color: CHART.cacheRead, value: totals.cacheReadTokens, key2: 'dialog.cacheRead' },
				{ key: 'output', color: CHART.output, value: totals.outputTokens, key2: 'dialog.output' },
				{ key: 'uncached', color: CHART.uncached, value: totals.uncachedInputTokens, key2: 'dialog.input' },
				{ key: 'cacheWrite', color: CHART.cacheWrite, value: totals.cacheWriteTokens, key2: 'dialog.cacheWrite' }
			];

			const wallets = balance?.status === 'ready' ? (balance.value ?? []) : null;
			const bonuses = balance?.status === 'ready' ? (balance.bonusWallets ?? []) : null;
			const card = {
				border: '1px solid var(--dsw-alias-border)',
				borderRadius: 'var(--dsw-radius-lg, var(--dsw-radius-md))',
				background: 'var(--dsw-alias-bg-layer-1, transparent)',
				padding: '16px 18px'
			};

			/** One headline figure: big value, a muted sub-line, and an optional sparkline. */
			const heroCard = (label, value, sub, spark) =>
				h(
					'div',
					{
						className: 'dshUsageHero',
						style: {
							...card,
							backgroundImage:
								'linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-state-business-primary, #2b7fd4) 10%, transparent), transparent 65%)'
						}
					},
					h('div', { style: { ...MUTED, fontSize: '12px' } }, label),
					h(
						'div',
						{
							style: {
								fontSize: 'clamp(18px, 1.9vw, 26px)',
								fontWeight: 600,
								lineHeight: 1.15,
								letterSpacing: '-0.02em',
								marginTop: '4px',
								fontVariantNumeric: 'tabular-nums',
								whiteSpace: 'nowrap'
							}
						},
						value
					),
					sub !== undefined &&
						(Array.isArray(sub) ? sub : [sub]).map((line, index) =>
							h(
								'div',
								{ key: index, style: { ...MUTED, fontSize: '11px', marginTop: index === 0 ? '4px' : '1px', whiteSpace: 'nowrap' } },
								line
							)
						),
					spark !== undefined &&
						h(
							'svg',
							{
								viewBox: '0 0 100 30',
								preserveAspectRatio: 'none',
								width: '100%',
								height: '30',
								style: { marginTop: '8px', display: 'block', opacity: 0.85 }
							},
							h('path', {
								d: spark,
								fill: 'none',
								stroke: 'var(--dsw-alias-state-business-primary, #2b7fd4)',
								strokeWidth: 1.5,
								vectorEffect: 'non-scaling-stroke'
							})
						)
				);

			// The catalog only supplies display names and provider labels for the
			// models that already spent tokens; unused models stay out of the list.
			const catalogModels = [];
			const catalogSeen = new Set();
			for (const group of catalog?.groups ?? []) {
				for (const model of group.models ?? []) {
					if (catalogSeen.has(model.id)) continue;
					catalogSeen.add(model.id);
					catalogModels.push({ id: model.id, name: model.name ?? model.id, provider: group.name ?? group.id });
				}
			}
			const modelRows = (summary?.byModel ?? [])
				.filter((group) => totalOf(group) > 0)
				.map((group) => {
					const known = catalogModels.find((model) => model.id === group.model);
					return {
						key: group.model,
						name: known?.name ?? (group.model === 'unknown' ? t('dialog.unknownModel') : group.model),
						subtitle: known?.provider,
						group,
						share: percentOf(totalOf(group), totalTokens)
					};
				});
			const codexGroups = (codex?.byModel ?? []).filter((group) => totalOf(group) > 0);
			const codexTokensTotal = codexGroups.reduce((sum, group) => sum + totalOf(group), 0);
			const codexCost = codexGroups.reduce(
				(sum, group) => (OPENAI_PRICING[group.model] === undefined ? sum : sum + costOf(group, group.model)),
				0
			);
			const allTokens = totalTokens + codexTokensTotal;
			for (const group of codexGroups) {
				modelRows.push({
					key: `codex:${group.model}`,
					name: group.model,
					subtitle: t('panel.codexTag'),
					group,
					share: percentOf(totalOf(group), allTokens),
					subscription: true
				});
			}

			const days = summary?.byDay ?? [];
			const byDate = new Map(days.map((day) => [day.date, day]));
			const series = [];
			for (let offset = 13; offset >= 0; offset -= 1) {
				const key = dateKey(offset);
				series.push({ date: key, day: byDate.get(key) ?? null });
			}
			const costOfDay = (day) => (day === null || day === undefined ? 0 : modelsCost(day.models));
			const maxDayCost = Math.max(...series.map((point) => costOfDay(point.day)), 0.000001);
			const sparkPath = series
				.map((point, index) => {
					const x = (index / Math.max(1, series.length - 1)) * 100;
					const y = 28 - (costOfDay(point.day) / maxDayCost) * 26;
					return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
				})
				.join(' ');
			const todayCost = costOfDay(byDate.get(dateKey(0)));
			const yesterdayCost = costOfDay(byDate.get(dateKey(1)));
			const monthCost = days.slice(0, 30).reduce((sum, day) => sum + costOfDay(day), 0);

			const projects = (summary?.byProject ?? [])
				.map((entry) => ({
					project: entry.project,
					sessions: entry.sessions,
					tokens: totalOf(entry),
					cost: modelsCost(entry.models)
				}))
				.filter((entry) => entry.cost > 0 || entry.tokens > 0)
				.sort((a, b) => b.cost - a.cost);
			const projectRows = projects.slice(0, 10);
			const hiddenProjects = projects.length - projectRows.length;
			const codexLimits = [];
			for (const window of [codex?.rateLimits?.primary, codex?.rateLimits?.secondary]) {
				if (window === null || window === undefined || typeof window.usedPercent !== 'number') continue;
				const seconds = window.windowSeconds ?? 0;
				const resetsAt = typeof window.resetsAt === 'number' ? window.resetsAt : null;
				const startMs = resetsAt !== null && seconds > 0 ? resetsAt * 1000 - seconds * 1000 : null;
				codexLimits.push({
					key: `${seconds}`,
					label:
						seconds >= 604800
							? t('panel.codexWeek')
							: t('panel.codexWindow', { hours: Math.max(1, Math.round(seconds / 3600)) }),
					remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)),
					usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
					elapsedPercent:
						startMs === null
							? 0
							: Math.max(0, Math.min(100, ((Date.now() - startMs) / (seconds * 1000)) * 100)),
					resets:
						resetsAt !== null
							? new Date(resetsAt * 1000).toLocaleString(undefined, {
									day: '2-digit',
									month: '2-digit',
									hour: '2-digit',
									minute: '2-digit'
								})
							: null
				});
			}
			const openRouter = balances?.sources?.openrouter;
			const anthropic = balances?.sources?.anthropic;

			return h(
				'div',
				{
					style: {
						boxSizing: 'border-box',
						height: '100%',
						overflowY: 'auto',
						padding: '28px 32px 44px',
						color: 'var(--dsw-alias-label-primary)'
					}
				},
				h(
					'div',
					{ style: { maxWidth: '780px', margin: '0 auto' } },
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
						h('h1', { style: { fontSize: '20px', fontWeight: 600, margin: 0 } }, t('panel.title')),
						h(
							'button',
							{
								type: 'button',
								onClick: load,
								disabled: loading,
								style: {
									font: 'inherit',
									fontSize: '13px',
									padding: '5px 14px',
									borderRadius: 'var(--dsw-radius-sm)',
									border: '1px solid var(--dsw-alias-border)',
									background: 'var(--dsw-alias-bg-layer-2, transparent)',
									color: 'var(--dsw-alias-label-primary)',
									cursor: loading ? 'default' : 'pointer',
									opacity: loading ? 0.6 : 1
								}
							},
							t('panel.refresh')
						)
					),
					loading && summary === null && h('div', { style: { ...MUTED, marginTop: '16px' } }, t('panel.loading')),
					!loading && summary === null &&
						h('div', { style: { ...MUTED, marginTop: '16px' } }, t('panel.error') + ' — ' + t('panel.retry')),
					summary !== null &&
						h(
							'div',
							null,
							h(
								'style',
								null,
								'@keyframes dshUsageGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}.dshUsageBar{transform-origin:left center;animation:dshUsageGrow .8s cubic-bezier(.2,.7,.2,1) both}.dshUsageHero{transition:transform .15s ease}.dshUsageHero:hover{transform:translateY(-1px)}'
							),
							h(
								'div',
								{
									style: {
										display: 'grid',
										gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
										gap: '12px',
										marginTop: '18px'
									}
								},
								heroCard(
									t('panel.totalTokens'),
									formatTokens(allTokens),
									[
										'DSH · ' + formatTokens(totalTokens),
										'Codex · ' + formatTokens(codexTokensTotal)
									],
									sparkPath
								),
								heroCard(
									t('panel.totalCost'),
									formatCost(totalCost),
									t('panel.codexApiCost') + ' ' + formatCost(codexCost)
								),
								heroCard(
									t('dialog.cacheRate'),
									hitRate < 10 ? hitRate.toFixed(1) + '%' : Math.round(hitRate) + '%',
									formatTokens(totals.cacheReadTokens) + ' ' + t('dialog.cacheRead').toLowerCase()
								),
								heroCard(
									t('panel.sessionsLabel'),
									String(counted),
									t('panel.codex') + ': ' + String(codex?.sessions ?? 0)
								)
							),
							h(
								'div',
								{
									style: {
										display: 'grid',
										gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)',
										gap: '12px',
										marginTop: '12px'
									}
								},
								h(
									'div',
									{ style: { ...card, display: 'flex', flexDirection: 'column' } },
									h('div', { style: { ...MUTED, fontSize: '12px', marginBottom: '10px' } }, t('panel.structure')),
									h(
										'div',
										{
											style: {
												display: 'flex',
												gap: '24px',
												alignItems: 'center',
												flexWrap: 'wrap',
												marginTop: 'auto',
												marginBottom: 'auto'
											}
										},
										h(Donut, {
											segments,
											center: hitRate < 10 ? hitRate.toFixed(1) + '%' : Math.round(hitRate) + '%',
											caption: t('dialog.cacheRate'),
											ariaLabel: t('panel.structure')
										}),
										h(
											'div',
											{ style: { flex: '1 1 300px', minWidth: '260px' } },
											segments.map((segment) =>
												h(LegendRow, {
													key: segment.key,
													color: segment.color,
													label: t(segment.key2),
													tokens: formatTokens(segment.value),
													percent: percentText(segment.value, totalTokens)
												})
											)
										)
									)
								),
								codex !== null &&
									h(
										'div',
										{ style: { ...card, display: 'flex', flexDirection: 'column', justifyContent: 'center' } },
										h(
											'div',
											{ style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' } },
											h(
												'div',
												{ style: { fontSize: '13px', fontWeight: 600 } },
												t('panel.codex') +
													(codex.rateLimits?.planType ? ' · ' + codex.rateLimits.planType : '') +
													(codex.stale === true ? ' · ' + t('panel.cached') : '')
											),
											h('div', { style: { ...MUTED, fontSize: '11px' } }, formatCost(codexCost) + ' API')
										),
										codexLimits.map((limit) =>
											h(
												'div',
												{
													key: limit.key,
													style: {
														display: 'flex',
														gap: '14px',
														alignItems: 'center',
														marginTop: '12px'
													}
												},
												h(Gauge, {
													outer: limit.elapsedPercent,
													inner: limit.usedPercent,
													center: Math.round(limit.remaining) + '%'
												}),
												h(
													'div',
													{ style: { minWidth: 0 } },
													h('div', { style: { fontSize: '12px', fontWeight: 600 } }, limit.label),
													h(
														'div',
														{ style: { ...MUTED, fontSize: '11px', marginTop: '2px' } },
														t('panel.codexLeft', { percent: Math.round(limit.remaining) })
													),
													h(
														'div',
														{ style: { ...MUTED, fontSize: '11px' } },
														t('panel.codexRing', {
															time: Math.round(limit.elapsedPercent ?? 0),
															used: Math.round(limit.usedPercent)
														})
													),
													limit.resets !== null &&
														h(
															'div',
															{ style: { ...MUTED, fontSize: '11px' } },
															t('panel.codexReset') + ': ' + limit.resets
														)
												)
											)
										),
										h(
											'div',
											{ style: { display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '14px' } },
											h(StatTile, { label: t('panel.codexToday'), value: formatTokens(codex.tokens?.today ?? 0) }),
											h(StatTile, { label: t('panel.codexWeekTokens'), value: formatTokens(codex.tokens?.week ?? 0) }),
											h(StatTile, { label: t('panel.codexTotal'), value: formatTokens(codex.tokens?.total ?? 0) })
										),
										h('div', { style: { ...MUTED, fontSize: '11px', marginTop: '10px' } }, t('panel.codexSource'))
									)
							),
							h(
								'div',
								{ style: { ...card, marginTop: '12px' } },
								h('div', { style: { ...MUTED, fontSize: '12px' } }, t('panel.balance')),
								h(
									'div',
									{ style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px', marginTop: '6px' } },
									h(
										'div',
										null,
										wallets === null
											? h('div', { style: { ...MUTED, fontSize: '13px', marginTop: '6px' } }, t('panel.balanceUnavailable'))
											: h(
													'div',
													null,
													h(
														'div',
														{ style: { fontSize: '24px', fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' } },
														wallets.length === 0
															? '—'
															: wallets.map((wallet) => formatMoney(wallet.balance, wallet.currency)).join(' · ')
													),
													h('div', { style: { ...MUTED, fontSize: '12px', marginTop: '2px' } }, t('panel.toppedUp')),
													h(
														'div',
														{ style: { ...MUTED, fontSize: '12px', marginTop: '8px' } },
														t('panel.bonus') +
															': ' +
															(bonuses === null || bonuses.length === 0
																? '—'
																: bonuses.map((wallet) => formatMoney(wallet.balance, wallet.currency)).join(' · '))
													)
												)
									),
									h(
										'div',
										null,
										h('div', { style: { ...MUTED, fontSize: '11px' } }, t('panel.openrouter')),
										openRouter?.status === 'ready'
											? h(
													React.Fragment,
													null,
													h(
														'div',
														{ style: { fontSize: '24px', fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' } },
														formatMoney(openRouter.balance, 'USD')
													),
													h(
														'div',
														{ style: { ...MUTED, fontSize: '11px' } },
														t('panel.creditsUsed', {
															used: formatMoney(openRouter.used, 'USD'),
															total: formatMoney(openRouter.total, 'USD')
														}) + (openRouter.stale === true ? ' · ' + t('panel.cached') : '')
													)
												)
											: h('div', { style: { ...MUTED, fontSize: '12px', marginTop: '4px' } }, t(openRouter?.status === 'missing' ? 'panel.noKey' : 'panel.unavailable'))
									),
									h(AgentRouterCard, {
										source: balances?.sources?.agentrouter,
										usage: summary?.byProvider?.find((row) => row.provider === 'agentrouter'),
										account: agentRouterAccount,
										onAccountAction: props.agentRouterAccountAction,
										onAccountUpdated: accountUpdated,
										t
									}),
									h(
										'div',
										null,
										h('div', { style: { ...MUTED, fontSize: '11px' } }, t('panel.anthropic')),
										anthropic?.status === 'ready'
											? h(
													React.Fragment,
													null,
													h(
														'div',
														{ style: { fontSize: '24px', fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' } },
														formatMoney(anthropic.monthCost ?? 0, 'USD')
													),
													h(
														'div',
														{ style: { ...MUTED, fontSize: '11px' } },
														t('panel.anthropicSpend') +
															(anthropic.org ? ' · ' + anthropic.org : '') +
															(anthropic.stale === true ? ' · ' + t('panel.cached') : '')
													)
												)
											: h(
													'div',
													{ style: { ...MUTED, fontSize: '12px', marginTop: '4px' } },
													t(
														anthropic?.status === 'no-billing'
															? 'panel.billingRights'
															: anthropic?.status === 'admin-required'
																? 'panel.adminRequired'
																: 'panel.unavailable'
													)
												)
									)
								)
							),
							h(
								'div',
								{ style: { ...card, marginTop: '12px' } },
								h('div', { style: { ...MUTED, fontSize: '12px', marginBottom: '6px' } }, t('panel.byModel')),
								modelRows.map((row, index) => {
									const priced =
										row.subscription !== true || OPENAI_PRICING[row.group.model] !== undefined;
									return h(ModelBar, {
										key: row.key,
										name: row.name,
										subtitle: row.subtitle,
										detail:
											formatTokens(totalOf(row.group)) +
											' · ' +
											(priced ? formatCost(costOf(row.group, row.group.model)) : '—') +
											' · ' +
											percentText(totalOf(row.group), allTokens),
										share: row.share,
										color: row.subscription
											? 'var(--dsw-alias-state-warn-primary, #b7791f)'
											: index === 0
												? CHART.cacheRead
												: 'var(--dsw-alias-label-tertiary, #8a8f98)',
										note: hasRate(row.group.model) ? undefined : t('panel.defaultRate')
									});
								})
							),
							h(
								'div',
								{ style: { ...card, marginTop: '12px' } },
								h('div', { style: { ...MUTED, fontSize: '12px', marginBottom: '10px' } }, t('panel.byDay')),
								h(
									'div',
									{ style: { display: 'flex', gap: '22px', flexWrap: 'wrap' } },
									h(StatTile, { label: t('panel.today'), value: formatCost(todayCost) }),
									h(StatTile, { label: t('panel.yesterday'), value: formatCost(yesterdayCost) }),
									h(StatTile, { label: t('panel.month'), value: formatCost(monthCost) })
								),
								h(
									'div',
									{ style: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '56px', marginTop: '16px' } },
									series.map((point) => {
										const cost = costOfDay(point.day);
										return h(
											'div',
											{
												key: point.date,
												title:
													point.date +
													' · ' +
													formatCost(cost) +
													' · ' +
													formatTokens(point.day === null ? 0 : totalOf(point.day)),
												style: {
													flex: '1 1 0',
													height: '100%',
													display: 'flex',
													flexDirection: 'column',
													justifyContent: 'flex-end'
												}
											},
											h('div', {
												style: {
													height: Math.max(2, (cost / maxDayCost) * 100) + '%',
													borderRadius: '5px 5px 2px 2px',
													background:
														cost > 0
															? 'var(--dsw-alias-state-business-primary, #2b7fd4)'
															: 'var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.06))'
												}
											})
										);
									})
								),
								h(
									'div',
									{ style: { ...MUTED, fontSize: '11px', marginTop: '6px', display: 'flex', justifyContent: 'space-between' } },
									series[0].date.slice(5),
									series[series.length - 1].date.slice(5)
								)
							),
							h(
								'div',
								{ style: { ...card, marginTop: '12px' } },
								h('div', { style: { ...MUTED, fontSize: '12px', marginBottom: '6px' } }, t('panel.byProject')),
								projectRows.map((row) =>
									h(ModelBar, {
										key: row.project,
										name: row.project,
										subtitle: String(row.sessions),
										detail:
											formatCost(row.cost) +
											' · ' +
											formatTokens(row.tokens) +
											' · ' +
											percentText(row.cost, totalCost),
										share: percentOf(row.cost, Math.max(totalCost, 0.000001)),
										color: 'var(--dsw-alias-state-business-primary, #2b7fd4)'
									})
								),
								hiddenProjects > 0 &&
									h(
										'div',
										{ style: { ...MUTED, fontSize: '11px', marginTop: '6px' } },
										t('panel.moreProjects', { count: hiddenProjects })
									)
							),
							h('div', { style: { ...MUTED, fontSize: '12px', marginTop: '16px' } }, t('panel.note'))
						)
				)
			);
		}
		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'token-usage: dictionaries');
				const t = ctx.locale.bind(NS);

				const loadSummary = async () => {
					try {
						const response = await fetch('/token-usage/summary', {
							cache: 'no-store',
							headers: { accept: 'application/json' }
						});
						if (!response.ok) return null;
						return await response.json();
					} catch {
						return null;
					}
				};

				const loadBalance = async () => {
					try {
						const account = ctx.get('remote.account');
						if (account === undefined) return null;
						const version = globalThis.__DSH_BOOT__?.release?.version ?? '0.0.0';
						const active = ctx.locale.getSnapshot?.()?.active ?? 'en';
						const result = await account.getBalance({
							version,
							locale: active,
							timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
						});
						return result?.ok ? result.value : null;
					} catch {
						return null;
					}
				};

				const loadCodex = async () => {
					try {
						const response = await fetch('/token-usage/codex', {
							cache: 'no-store',
							headers: { accept: 'application/json' }
						});
						if (!response.ok) return null;
						return await response.json();
					} catch {
						return null;
					}
				};

				const loadBalances = async () => {
					try {
						const response = await fetch('/token-usage/balances', {
							cache: 'no-store',
							headers: { accept: 'application/json' }
						});
						if (!response.ok) return null;
						return await response.json();
					} catch {
						return null;
					}
				};

				const loadAgentRouterAccount = async () => {
					try {
						const response = await fetch('/api/token-usage/agentrouter/account', {
							cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' }
						});
						if (!response.ok) return null;
						return await response.json();
					} catch { return null; }
				};
				const agentRouterAccountAction = async (input, signal) => {
					try {
						const response = await fetch('/api/token-usage/agentrouter/account/binding', {
							method: 'POST', cache: 'no-store', credentials: 'same-origin', signal,
							headers: { 'content-type': 'application/json', accept: 'application/json', 'x-dsh-usage-action': 'account-binding' },
							body: JSON.stringify(input)
						});
						if (!response.headers.get('content-type')?.includes('application/json')) return { ok: false, reason: response.status === 401 || response.status === 403 ? 'browser-only' : 'network' };
						return await response.json();
					} catch { return { ok: false, reason: 'network' }; }
				};

				const loadModels = async () => {
					try {
						const session = ctx.get('remote.session');
						if (session === undefined) return null;
						const result = await session.modelCatalog();
						if (!result?.ok) return null;
						return result.value ?? null;
					} catch {
						return null;
					}
				};

				ctx.slots.inject('conversation.composer.dock', () =>
					ctx.slots.register(
						{
							name: 'conversation.composer.dock',
							id: 'token-usage',
							order: 2,
							locale: NS,
							inject: (sessionId) => ({ sessionId })
						},
						UsageCostPill
					)
				);

				ctx.slots.inject('sidebar.panellist', () =>
					ctx.slots.register(
						{
							name: 'sidebar.panellist',
							id: 'usage',
							order: 20,
							label: () => t('panel.label'),
							locale: NS
						},
						UsagePanelIcon
					)
				);

				ctx.slots.inject('main', () =>
					ctx.slots.register(
						{
							name: 'main',
							key: 'usage',
							locale: NS,
							inject: () => ({ loadSummary, loadBalance, loadModels, loadBalances, loadCodex, loadAgentRouterAccount, agentRouterAccountAction })
						},
						UsagePanel
					)
				);
			}
		};
	}
});
