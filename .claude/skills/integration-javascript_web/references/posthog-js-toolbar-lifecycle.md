# PostHog JS toolbar and lifecycle methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Toolbar methods

#### loadToolbar()

**Release Tag:** public

returns a boolean indicating whether the [toolbar](/docs/toolbar) loaded

### Parameters

- **`params`** (`ToolbarParams`) - Toolbar parameters.

### Returns

- `boolean`

### Examples

```ts
// Generated example for loadToolbar
posthog.loadToolbar();
```

---

### Lifecycle methods

#### shutdown()

**Release Tag:** public

Flushes any queued events and resolves once teardown is complete.

**Notes:**

This exists primarily for parity with the server-side [Node.js SDK](/docs/libraries/node), whose `shutdown()` you call once before a process exits. In the browser there is no process to exit — the SDK already flushes pending events on `pagehide`/`unload` — so this method is mostly a graceful no-op that best-effort flushes the request queues and always resolves.
It is safe to call in isomorphic teardown code (for example a Nuxt/Next module that calls `shutdown()` on both the server and the client) so the same symmetric cleanup works in either environment without throwing.

### Parameters

- **`_shutdownTimeoutMs?`** (`number`) - Accepted for call-site parity with the Node.js SDK. The browser flush is synchronous, so this is ignored.

### Returns

- `Promise<void>`

### Examples

```ts
// symmetric teardown that runs on both server and client
await posthog.shutdown()
```

---
