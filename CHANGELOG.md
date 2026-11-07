# Changelog

## 0.3.1 — shareable distribution

- Exported the Host ledger and Web usage panel into a clean, portable Git project.
- Added installation/account setup instructions, dependency-free checks and CI.
- Excluded profile/credential/session data and private screenshots.
- Required Harness Connection admission for the summary and Codex routes as well as provider-balance routes.
- Kept the separately maintained model provider as an explicit `dsh-llm-agentrouter@2.6.1` installation dependency, not a vendored copy.

## 0.3.0 — dashboard account balance

- Browser-only AgentRouter account connect/disconnect flow.
- Verified dashboard access token and numeric user ID before saving a Host grant.
- Account balance/usage DTO without private profile fields or token readback.
- Origin pinning, bounded requests, stale-data markers and credential-aware caches.

## 0.2.0 — AgentRouter usage

- Provider-attributed DSH tokens, replies and sessions.
- Conditional key-quota support separate from account balance.
- AgentRouter card with localized states and API error handling.
