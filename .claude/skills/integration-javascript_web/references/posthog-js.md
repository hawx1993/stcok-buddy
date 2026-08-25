# PostHog JavaScript Web SDK Reference Index

This file is intentionally short. The original long SDK reference has been split to keep Claude context small. Do not read all PostHog SDK shards upfront; read only the file matching the API area you are implementing or debugging.

| Need | Read |
| --- | --- |
| Constructor, core helpers, session ID, feature flag list, push/setIdentity | `posthog-js-core.md` |
| Error capture / exception autocapture | `posthog-js-error-tracking.md` |
| `identify`, `alias`, `reset`, person properties, groups, distinct ID | `posthog-js-identification.md` |
| Surveys | `posthog-js-surveys.md` |
| `capture`, event listeners, super properties, register / unregister | `posthog-js-capture.md` |
| Logs, LLM analytics, privacy opt-in/out | `posthog-js-logs-llm-privacy.md` |
| `init`, debug, page view ID, `set_config` | `posthog-js-initialization.md` |
| Session replay | `posthog-js-session-replay.md` |
| Feature flags, early access features, flag payloads and reloads | `posthog-js-feature-flags.md` |
| Toolbar and `shutdown` lifecycle | `posthog-js-toolbar-lifecycle.md` |
