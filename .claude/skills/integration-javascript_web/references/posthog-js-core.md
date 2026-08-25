# PostHog JS core and identity bootstrap methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

# PostHog JavaScript Web SDK

**SDK Version:** <version>

Posthog-js allows you to automatically capture usage and send events to PostHog.

## Categories

- Initialization
- Identification
- Capture
- Error tracking
- Surveys
- Logs
- LLM analytics
- Privacy
- Session replay
- Feature flags
- Toolbar
- Lifecycle

## PostHog

This is the SDK reference for the PostHog JavaScript Web SDK. You can learn more about example usage in the [JavaScript Web SDK documentation](/docs/libraries/js). You can also follow [framework specific guides](/docs/frameworks) to integrate PostHog into your project.
This SDK is designed for browser environments. Use the PostHog [Node.js SDK](/docs/libraries/node) for server-side usage.

### Other methods

#### PostHog()

**Release Tag:** public

Creates an uninitialized PostHog instance.

**Notes:**

Most browser applications should use the default exported singleton and call `posthog.init()`. Construct a new instance only when you need to manage a separate SDK instance manually.

### Returns

- `any`

### Examples

```ts
const instance = new PostHog()
instance.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })
```

---

#### clearIdentity()

**Release Tag:** public

Clear HMAC-based identity verification, reverting to anonymous mode.

### Returns

- `void`

### Examples

```ts
posthog.clearIdentity()
```

---

#### get_explicit_consent_status()

**Release Tag:** public

Returns the explicit consent status of the user.

**Notes:**

This can be used to check if the user has explicitly opted in or out of data capturing, or neither. This does not take the default config options into account, only whether the user has made an explicit choice, so this can be used to determine whether to show an initial cookie banner or not.

### Returns

**Union of:**
- `'granted'`
- `'denied'`
- `'pending'`

### Examples

```ts
const consentStatus = posthog.get_explicit_consent_status()
if (consentStatus === "granted") {
    // user has explicitly opted in
} else if (consentStatus === "denied") {
    // user has explicitly opted out
} else if (consentStatus === "pending"){
    // user has not made a choice, show consent banner
}
```

---

#### get_session_id()

**Release Tag:** public

Returns the current session_id.

**Notes:**

This should only be used for informative purposes. Any actual internal use case for the session_id should be handled by the sessionManager.

### Returns

- `string`

### Examples

```ts
// Generated example for get_session_id
posthog.get_session_id();
```

---

#### getAllFeatureFlags()

**Release Tag:** public

Returns all currently cached feature flags as `FeatureFlagResult`s. This is a synchronous read of the flags from the last load (no network request); call `reloadFeatureFlags()` first to refresh. Unlike `getFeatureFlag()`, it does not send a `$feature_flag_called` event.

### Returns

- `FeatureFlagResult[]`

### Examples

```ts
// Generated example for getAllFeatureFlags
posthog.getAllFeatureFlags();
```

---

#### push()

**Release Tag:** public

push() keeps the standard async-array-push behavior around after the lib is loaded. This is only useful for external integrations that do not wish to rely on our convenience methods (created in the snippet).

### Parameters

- **`item`** (`SnippetArrayItem`) - A `[function_name, ...args]` array to be executed.

### Returns

- `void`

### Examples

```ts
posthog.push(['register', { a: 'b' }]);
```

---

#### setIdentity()

**Release Tag:** public

Set HMAC-based identity verification.

**Notes:**

When set, products like conversations use server-verified identity (distinct_id + HMAC hash) instead of anonymous session identifiers. The hash should be computed server-side as HMAC-SHA256 of the distinct_id using the project's API secret.

### Parameters

- **`distinctId`** (`string`) - The verified user distinct_id
- **`hash`** (`string`) - HMAC-SHA256 of distinctId using the project API secret

### Returns

- `void`

### Examples

```ts
posthog.setIdentity('user_123', 'a1b2c3d4e5f6...')
```

---
