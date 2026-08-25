# PostHog JS capture, register and event methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Capture methods

#### capture()

**Release Tag:** public

Captures an event with optional properties and configuration.

**Notes:**

You can capture arbitrary object-like values as events. [Learn about capture best practices](/docs/product-analytics/capture-events)

### Parameters

- **`event_name`** (`EventName`) - The name of the event (e.g., 'Sign Up', 'Button Click', 'Purchase')
- **`properties?`** (`Properties | null`) - Properties to include with the event describing the user or event details
- **`options?`** (`CaptureOptions`) - Optional configuration for the capture request

### Returns

**Union of:**
- `CaptureResult`
- `undefined`

### Examples

```ts
// basic event capture
posthog.capture('cta-button-clicked', {
    button_name: 'Get Started',
    page: 'homepage'
})
```

---

#### on()

**Release Tag:** public

Exposes a set of events that PostHog will emit. e.g. `eventCaptured` is emitted immediately before trying to send an event
Unlike `onFeatureFlags` and `onSessionId` these are not called when the listener is registered, the first callback will be the next event _after_ registering a listener
Available events: - `eventCaptured`: Emitted immediately before trying to send an event - `featureFlagsReloading`: Emitted when feature flags are being reloaded (e.g. after `identify()`, `group()`, or `reloadFeatureFlags()`)

### Parameters

- **`event`** (`'eventCaptured' | 'featureFlagsReloading'`) - The event to listen for.
- **`cb`** (`(...args: any[]) => void`) - The callback function to call when the event is emitted.

### Returns

- `() => void`

### Examples

####

```ts
posthog.on('eventCaptured', (event) => {
  console.log(event)
})
```

#### Track when feature flags are reloading to show a loading state

```ts
// Track when feature flags are reloading to show a loading state
posthog.on('featureFlagsReloading', () => {
  console.log('Feature flags are being reloaded...')
})
```

---

#### register_for_session()

**Release Tag:** public

Registers super properties for the current session only.

**Notes:**

Session super properties are automatically added to all events during the current browser session. Unlike regular super properties, these are cleared when the session ends and are stored in sessionStorage.

### Parameters

- **`properties`** (`Properties`) - An associative array of properties to store about the user

### Returns

- `void`

### Examples

#### register session-specific properties

```ts
// register session-specific properties
posthog.register_for_session({
    current_page_type: 'checkout',
    ab_test_variant: 'control'
})
```

#### register properties for user flow tracking

```ts
// register properties for user flow tracking
posthog.register_for_session({
    selected_plan: 'pro',
    completed_steps: 3,
    flow_id: 'signup_flow_v2'
})
```

---

#### register_once()

**Release Tag:** public

Registers super properties only if they haven't been set before.

**Notes:**

Unlike `register()`, this method will not overwrite existing super properties. Use this for properties that should only be set once, like signup date or initial referrer.

### Parameters

- **`properties`** (`Properties`) - An associative array of properties to store about the user
- **`default_value?`** (`Property`) - Value to override if already set in super properties (ex: 'False') Default: 'None'
- **`days?`** (`number`) - How many days since the users last visit to store the super properties

### Returns

- `void`

### Examples

#### register once-only properties

```ts
// register once-only properties
posthog.register_once({
    first_login_date: new Date().toISOString(),
    initial_referrer: document.referrer
})
```

#### override existing value if it matches default

```ts
// override existing value if it matches default
posthog.register_once(
    { user_type: 'premium' },
    'unknown'  // overwrite if current value is 'unknown'
)
```

---

#### register()

**Release Tag:** public

Registers super properties that are included with all events.

**Notes:**

Super properties are stored in persistence and automatically added to every event you capture. These values will overwrite any existing super properties with the same keys.

### Parameters

- **`properties`** (`Properties`) - properties to store about the user
- **`days?`** (`number`) - How many days since the user's last visit to store the super properties

### Returns

- `void`

### Examples

#### register a single property

```ts
// register a single property
posthog.register({ plan: 'premium' })
```

#### register multiple properties

```ts
// register multiple properties
posthog.register({
    email: 'user@example.com',
    account_type: 'business',
    signup_date: '2023-01-15'
})
```

#### register with custom expiration

```ts
// register with custom expiration
posthog.register({ campaign: 'summer_sale' }, 7) // expires in 7 days
```

---

#### unregister_for_session()

**Release Tag:** public

Removes a session super property from the current session.

**Notes:**

This will stop the property from being automatically included in future events for this session. The property is removed from sessionStorage.

### Parameters

- **`property`** (`string`) - The name of the session super property to remove

### Returns

- `void`

### Examples

```ts
// remove a session property
posthog.unregister_for_session('current_flow')
```

---

#### unregister()

**Release Tag:** public

Removes a super property from persistent storage.

**Notes:**

This will stop the property from being automatically included in future events. The property will be permanently removed from the user's profile.

### Parameters

- **`property`** (`string`) - The name of the super property to remove

### Returns

- `void`

### Examples

```ts
// remove a super property
posthog.unregister('plan_type')
```

---
