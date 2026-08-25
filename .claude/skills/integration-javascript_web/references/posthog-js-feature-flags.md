# PostHog JS feature flag methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Feature flags methods

#### getEarlyAccessFeatures()

**Release Tag:** public

Get the list of early access features. To check enrollment status, use `isFeatureEnabled`. [Learn more in the docs](/docs/feature-flags/early-access-feature-management#option-2-custom-implementation)

### Parameters

- **`callback`** (`EarlyAccessFeatureCallback`) - The callback function will be called when the early access features are loaded.
- **`force_reload?`** (`boolean`) - Whether to force a reload of the early access features.
- **`stages?`** (`EarlyAccessFeatureStage[]`) - The stages of the early access features to load.

### Returns

- `void`

### Examples

```ts
const posthog = usePostHog()
const activeFlags = useActiveFeatureFlags()

const [activeBetas, setActiveBetas] = useState([])
const [inactiveBetas, setInactiveBetas] = useState([])
const [comingSoonFeatures, setComingSoonFeatures] = useState([])

useEffect(() => {
  posthog.getEarlyAccessFeatures((features) => {
    // Filter features by stage
    const betaFeatures = features.filter(feature => feature.stage === 'beta')
    const conceptFeatures = features.filter(feature => feature.stage === 'concept')

    setComingSoonFeatures(conceptFeatures)

    if (!activeFlags || activeFlags.length === 0) {
      setInactiveBetas(betaFeatures)
      return
    }

    const activeBetas = betaFeatures.filter(
            beta => activeFlags.includes(beta.flagKey)
        );
    const inactiveBetas = betaFeatures.filter(
            beta => !activeFlags.includes(beta.flagKey)
        );
    setActiveBetas(activeBetas)
    setInactiveBetas(inactiveBetas)
  }, true, ['concept', 'beta'])
}, [activeFlags])
```

---

#### getFeatureFlag()

**Release Tag:** public

Gets the value of a feature flag for the current user.

**Notes:**

Returns the feature flag value which can be a boolean, string, or undefined. Supports multivariate flags that can return custom string values.

### Parameters

- **`key`** (`string`) - Key of the feature flag.
- **`options?`** (`FeatureFlagOptions`) - Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server.

### Returns

**Union of:**
- `boolean`
- `string`
- `undefined`

### Examples

#### check boolean flag

```ts
// check boolean flag
if (posthog.getFeatureFlag('new-feature')) {
    // show new feature
}
```

#### check multivariate flag

```ts
// check multivariate flag
const variant = posthog.getFeatureFlag('button-color')
if (variant === 'red') {
    // show red button
}
```

---

#### getFeatureFlagPayload()

**Release Tag:** deprecated

Get feature flag payload value matching key for user (supports multivariate flags).

### Parameters

- **`key`** (`string`) - Key of the feature flag.

### Returns

- `JsonType`

### Examples

```ts
const betaFeature = posthog.getFeatureFlagResult('beta-feature')
if (betaFeature?.variant === 'some-value') {
     const someValue = betaFeature?.payload
     // do something
}
```

---

#### getFeatureFlagResult()

**Release Tag:** public

Get a feature flag evaluation result including both the flag value and payload.
By default, this method emits the `$feature_flag_called` event.

### Parameters

- **`key`** (`string`) - Key of the feature flag.
- **`options?`** (`FeatureFlagOptions`) - Options for the feature flag lookup.

### Returns

**Union of:**
- `FeatureFlagResult`
- `undefined`

### Examples

####

```ts
const result = posthog.getFeatureFlagResult('my-flag')
if (result?.enabled) {
    console.log('Flag is enabled with payload:', result.payload)
}
```

#### multivariate flag

```ts
// multivariate flag
const result = posthog.getFeatureFlagResult('button-color')
if (result?.variant === 'red') {
    showRedButton(result.payload)
}
```

---

#### isFeatureEnabled()

**Release Tag:** public

Checks if a feature flag is enabled for the current user.

**Notes:**

Returns true if the flag is enabled, false if disabled, or undefined if not found. This is a convenience method that treats any truthy value as enabled.

### Parameters

- **`key`** (`string`) - Key of the feature flag.
- **`options?`** (`FeatureFlagOptions`) - Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server.

### Returns

**Union of:**
- `boolean`
- `undefined`

### Examples

#### simple feature flag check

```ts
// simple feature flag check
if (posthog.isFeatureEnabled('new-checkout')) {
    showNewCheckout()
}
```

#### disable event tracking

```ts
// disable event tracking
if (posthog.isFeatureEnabled('feature', { send_event: false })) {
    // flag checked without sending $feature_flag_called event
}
```

---

#### onFeatureFlags()

**Release Tag:** public

Register an event listener that runs when feature flags become available or when they change. If there are flags, the listener is called immediately in addition to being called on future changes. Note that this is not called only when we fetch feature flags from the server, but also when they change in the browser.

### Parameters

- **`callback`** (`FeatureFlagsCallback`) - The callback function will be called once the feature flags are ready or when they are updated. It'll return a list of feature flags enabled for the user, the variants, and also a context object indicating whether we succeeded to fetch the flags or not.

### Returns

- `() => void`

### Examples

```ts
posthog.onFeatureFlags(function(featureFlags, featureFlagsVariants, { errorsLoading }) {
    // do something
})
```

---

#### reloadFeatureFlags()

**Release Tag:** public

Feature flag values are cached. If something has changed with your user and you'd like to refetch their flag values, call this method.

### Returns

- `void`

### Examples

```ts
posthog.reloadFeatureFlags()
```

---

#### resetGroupPropertiesForFlags()

**Release Tag:** public

Resets the group properties for feature flags.

### Parameters

- **`group_type?`** (`string`) - Optional group type to reset. If omitted, all group properties are reset.

### Returns

- `void`

### Examples

```ts
posthog.resetGroupPropertiesForFlags()
```

---

#### resetPersonPropertiesForFlags()

**Release Tag:** public

Resets the person properties for feature flags.

### Parameters

- **`reloadFeatureFlags?`** (`boolean`) - Whether to reload feature flags.

### Returns

- `void`

### Examples

####

```ts
posthog.resetPersonPropertiesForFlags()
```

#### Reset properties without reloading

```ts
// Reset properties without reloading
posthog.resetPersonPropertiesForFlags(false)
```

---

#### setGroupPropertiesForFlags()

**Release Tag:** public

Set override group properties for feature flags. This is used when dealing with new groups / where you don't want to wait for ingestion to update properties. Takes in an object, the key of which is the group type.

### Parameters

- **`properties`** (`{
        [type: string]: Properties;
    }`) - The properties to override, the key of which is the group type.
- **`reloadFeatureFlags?`** (`boolean`) - Whether to reload feature flags.

### Returns

- `void`

### Examples

#### Set properties with reload

```ts
// Set properties with reload
posthog.setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })
```

#### Set properties without reload

```ts
// Set properties without reload
posthog.setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } }, false)
```

---

#### setPersonPropertiesForFlags()

**Release Tag:** public

Sometimes, you might want to evaluate feature flags using properties that haven't been ingested yet, or were set incorrectly earlier. You can do so by setting properties the flag depends on with these calls:

### Parameters

- **`properties`** (`Properties`) - The properties to override.
- **`reloadFeatureFlags?`** (`boolean`) - Whether to reload feature flags.

### Returns

- `void`

### Examples

#### Set properties

```ts
// Set properties
posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'})
```

#### Set properties without reloading

```ts
// Set properties without reloading
posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'}, false)
```

---

#### updateEarlyAccessFeatureEnrollment()

**Release Tag:** public

Opt the user in or out of an early access feature. [Learn more in the docs](/docs/feature-flags/early-access-feature-management#option-2-custom-implementation)

### Parameters

- **`key`** (`string`) - The key of the feature flag to update.
- **`isEnrolled`** (`boolean`) - Whether the user is enrolled in the feature.
- **`stage?`** (`string`) - The stage of the feature flag to update.

### Returns

- `void`

### Examples

```ts
const toggleBeta = (betaKey) => {
  if (activeBetas.some(
    beta => beta.flagKey === betaKey
  )) {
    posthog.updateEarlyAccessFeatureEnrollment(
      betaKey,
      false
    )
    setActiveBetas(
      prevActiveBetas => prevActiveBetas.filter(
        item => item.flagKey !== betaKey
      )
    );
    return
  }

  posthog.updateEarlyAccessFeatureEnrollment(
    betaKey,
    true
  )
  setInactiveBetas(
    prevInactiveBetas => prevInactiveBetas.filter(
      item => item.flagKey !== betaKey
    )
  );
}

const registerInterest = (featureKey) => {
  posthog.updateEarlyAccessFeatureEnrollment(
    featureKey,
    true
  )
  // Update UI to show user has registered
}
```

---

#### updateFlags()

**Release Tag:** public

Manually update feature flag values without making a network request.
This is useful when you have feature flag values from an external source (e.g., server-side evaluation, edge middleware) and want to inject them into the client SDK.

### Parameters

- **`flags`** (`Record<string, boolean | string>`) - An object mapping flag keys to their values (boolean or string variant)
- **`payloads?`** (`Record<string, JsonType>`) - Optional object mapping flag keys to their JSON payloads
- **`options?`** (`{
        merge?: boolean;
    }`) - Optional settings. Use `{ merge: true }` to merge with existing flags instead of replacing.

### Returns

- `void`

### Examples

```ts
// Replace all flags with server-evaluated values
posthog.updateFlags({
  'my-flag': true,
  'my-experiment': 'variant-a'
})

// Merge with existing flags (update only specified flags)
posthog.updateFlags(
  { 'my-flag': true },
  undefined,
  { merge: true }
)

// With payloads
posthog.updateFlags(
  { 'my-flag': true },
  { 'my-flag': { some: 'data' } }
)
```

---
