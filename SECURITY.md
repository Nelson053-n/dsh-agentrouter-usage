# Security policy

## Never share secrets

Do not commit, paste into an issue or attach to a screenshot:

- AgentRouter model API keys or dashboard access tokens;
- Authorization/Cookie headers, browser storage exports or a full account response;
- Harness credential stores, profiles, session logs or balance-cache files;
- Codex OAuth auth files, SSH keys or personal environment files.

This repository is a source distribution. Each user supplies their own credentials in their own Harness instance. Do not distribute a preconfigured profile to colleagues.

## Account binding

The dashboard token may grant broader account-management permissions at AgentRouter. This plugin uses it only for the read-only `/api/user/self` endpoint and sends no credential to `/api/status`.

A token is saved only after verification and an exact matching user ID. The grant lives in the Host's credential service, is pinned to the HTTPS origin explicitly shown in the connection form, and is never returned in API responses. Disconnect removes only this plugin-owned grant.

The local Harness credential provider is not a security boundary against programs running as the same OS user. We do not promise encryption or protection from a fully privileged local agent.

## Access and transport

The distribution requires Harness Connection admission for every ledger HTTP summary. Only the authenticated browser Peer may create or revoke an account binding. An ordinary API Peer, even with the owner principal, cannot perform these grant actions.

Origin/Host checks, a dedicated action header, bounded JSON, form revisions, request timeouts and cache invalidation protect the supported paths. These are not a substitute for HTTPS when serving Harness over a network. Do not expose an unauthenticated custom carrier.

The additional OpenRouter/Anthropic/Codex integrations can use locally available provider credentials when their panel is opened. Codex support may read the CLI's own auth file and local rollouts. No such files belong in this repository.

## Reporting

Report ordinary bugs through repository issues with secrets and personal data removed. For a sensitive vulnerability, contact the repository owner privately first; do not publish an exploit with a real account token.

If a token was accidentally shared, revoke/replace it at the provider and update affected integrations. Removing it from the latest commit does not remove it from Git history.
