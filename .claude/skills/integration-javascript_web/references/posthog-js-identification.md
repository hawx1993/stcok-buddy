# PostHog JS identification and group methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Identification methods

#### alias()

**Release Tag:** public

Creates an alias linking two distinct user identifiers. Learn more about [identifying users](/docs/product-analytics/identify)

**Notes:**

PostHog will use this to link two distinct_ids going forward (not retroactively). Call this when a user signs up to connect their anonymous session with their account.

### Parameters

- **`alias`** (`string`) - A unique identifier that you want to use for this user in the future.
- **`original?`** (`string`) - The current identifier being used for this user.

### Returns

**Union of:**
- `CaptureResult`
- `void`
- `number`

### Examples

#### link anonymous user to account on signup

```ts
// link anonymous user to account on signup
posthog.alias('user_12345')
```

#### explicit alias with original ID

```ts
// explicit alias with original ID
posthog.alias('user_12345', 'anonymous_abc123')
```

---

#### createPersonProfile()

**Release Tag:** public

Creates a person profile for the current user, if they don't already have one and config.person_profiles is set to 'identified_only'. Produces a warning and does not create a profile if config.person_profiles is set to 'never'. Learn more about [person profiles](/docs/product-analytics/identify)

### Returns

- `void`

### Examples

```ts
posthog.createPersonProfile()
```

---

#### get_distinct_id()

**Release Tag:** public

Returns the current distinct ID for the user.

**Notes:**

This is either the auto-generated ID or the ID set via `identify()`. The distinct ID is used to associate events with users in PostHog.

### Returns

- `string`

### Examples

#### get the current user ID

```ts
// get the current user ID
const userId = posthog.get_distinct_id()
console.log('Current user:', userId)
```

#### use in loaded callback

```ts
// use in loaded callback
posthog.init('token', {
    loaded: (posthog) => {
        const id = posthog.get_distinct_id()
        // use the ID
    }
})
```

---

#### get_property()

**Release Tag:** public

Returns the value of a super property. Returns undefined if the property doesn't exist.

**Notes:**

get_property() can only be called after the PostHog library has finished loading. init() has a loaded function available to handle this automatically.

### Parameters

- **`property_name`** (`string`) - The name of the super property you want to retrieve

### Returns

**Union of:**
- `Property`
- `undefined`

### Examples

```ts
// grab value for '$user_id' after the posthog library has loaded
posthog.init('<YOUR PROJECT TOKEN>', {
    loaded: function(posthog) {
        user_id = posthog.get_property('$user_id');
    }
});
```

---

#### getGroups()

**Release Tag:** public

Returns the current groups.

### Returns

- `Record<string, any>`

### Examples

```ts
// Generated example for getGroups
posthog.getGroups();
```

---

#### getSessionProperty()

**Release Tag:** public

Returns the value of the session super property named property_name. If no such property is set, getSessionProperty() will return the undefined value.

**Notes:**

This is based on browser-level `sessionStorage`, NOT the PostHog session. getSessionProperty() can only be called after the PostHog library has finished loading. init() has a loaded function available to handle this automatically.

### Parameters

- **`property_name`** (`string`) - The name of the session super property you want to retrieve

### Returns

**Union of:**
- `Property`
- `undefined`

### Examples

```ts
// grab value for 'user_id' after the posthog library has loaded
posthog.init('YOUR PROJECT TOKEN', {
    loaded: function(posthog) {
        user_id = posthog.getSessionProperty('user_id');
    }
});
```

---

#### group()

**Release Tag:** public

Associates the user with a group for group-based analytics. Learn more about [groups](/docs/product-analytics/group-analytics)

**Notes:**

Groups allow you to analyze users collectively (e.g., by organization, team, or account). This sets the group association for all subsequent events and reloads feature flags.

### Parameters

- **`groupType`** (`string`) - Group type (example: 'organization')
- **`groupKey`** (`string`) - Group key (example: 'org::5')
- **`groupPropertiesToSet?`** (`Properties`) - Optional properties to set for group

### Returns

- `void`

### Examples

#### associate user with an organization

```ts
// associate user with an organization
posthog.group('organization', 'org_12345', {
    name: 'Acme Corp',
    plan: 'enterprise'
})
```

#### associate with multiple group types

```ts
// associate with multiple group types
posthog.group('organization', 'org_12345')
posthog.group('team', 'team_67890')
```

---

#### identify()

**Release Tag:** public

Associates a user with a unique identifier instead of an auto-generated ID. Learn more about [identifying users](/docs/product-analytics/identify)

**Notes:**

By default, PostHog assigns each user a randomly generated `distinct_id`. Use this method to replace that ID with your own unique identifier (like a user ID from your database).

### Parameters

- **`new_distinct_id?`** (`string`) - A string that uniquely identifies a user. If not provided, the distinct_id currently in the persistent store (cookie or localStorage) will be used.
- **`userPropertiesToSet?`** (`Properties`) - Optional: An associative array of properties to store about the user. Note: For feature flag evaluations, if the same key is present in the userPropertiesToSetOnce, it will be overwritten by the value in userPropertiesToSet.
- **`userPropertiesToSetOnce?`** (`Properties`) - Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.

### Returns

- `void`

### Examples

#### basic identification

```ts
// basic identification
posthog.identify('user_12345')
```

#### identify with user properties

```ts
// identify with user properties
posthog.identify('user_12345', {
    email: 'user@example.com',
    plan: 'premium'
})
```

#### identify with set and set_once properties

```ts
// identify with set and set_once properties
posthog.identify('user_12345',
    { last_login: new Date() },  // updates every time
    { signup_date: new Date() }  // sets only once
)
```

---

#### onSessionId()

**Release Tag:** public

Register an event listener that runs whenever the session id or window id change. If there is already a session id, the listener is called immediately in addition to being called on future changes.
Can be used, for example, to sync the PostHog session id with a backend session.

### Parameters

- **`callback`** (`SessionIdChangedCallback`) - The callback function will be called once a session id is present or when it or the window id are updated.

### Returns

- `() => void`

### Examples

```ts
posthog.onSessionId(function(sessionId, windowId) { // do something })
```

---

#### reset()

**Release Tag:** public

Resets all user data and starts a fresh session.
⚠️ **Warning**: Only call this when a user logs out. Calling at the wrong time can cause split sessions.
This clears: - Session ID and super properties - User identification (sets new random distinct_id) - Cached data and consent settings

### Parameters

- **`reset_device_id?`** (`boolean`) - Whether to generate a new device ID as well as a new distinct ID.

### Returns

- `void`

### Examples

#### reset on user logout

```ts
// reset on user logout
function logout() {
    posthog.reset()
    // redirect to login page
}
```

#### reset and generate new device ID

```ts
// reset and generate new device ID
posthog.reset(true)  // also resets device_id
```

---

#### resetGroups()

**Release Tag:** public

Resets only the group properties of the user currently logged in. Learn more about [groups](/docs/product-analytics/group-analytics)

### Returns

- `void`

### Examples

```ts
posthog.resetGroups()
```

---

#### setInternalOrTestUser()

**Release Tag:** public

Marks the current user as a test user by setting the `$internal_or_test_user` person property to `true`. This also enables person processing for the current user.
This is useful for using in a cohort your internal/test filters for your posthog org.

### Returns

- `void`

### Examples

```ts
// Manually mark as test user
posthog.setInternalOrTestUser()

// Or use internal_or_test_user_hostname config for automatic detection
posthog.init('token', { internal_or_test_user_hostname: 'localhost' })
```

---

#### setPersonProperties()

**Release Tag:** public

Sets properties on the person profile associated with the current `distinct_id`. Learn more about [identifying users](/docs/product-analytics/identify)

**Notes:**

Updates user properties that are stored with the person profile in PostHog. If `person_profiles` is set to `identified_only` and no profile exists, this will create one.

### Parameters

- **`userPropertiesToSet?`** (`Properties`) - Optional: An associative array of properties to store about the user. Note: For feature flag evaluations, if the same key is present in the userPropertiesToSetOnce, it will be overwritten by the value in userPropertiesToSet.
- **`userPropertiesToSetOnce?`** (`Properties`) - Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.

### Returns

- `void`

### Examples

#### set user properties

```ts
// set user properties
posthog.setPersonProperties({
    email: 'user@example.com',
    plan: 'premium'
})
```

#### set properties

```ts
// set properties
posthog.setPersonProperties(
    { name: 'Max Hedgehog' },  // $set properties
    { initial_url: '/blog' }   // $set_once properties
)
```

---

#### unsetPersonProperties()

**Release Tag:** public

Removes properties from the person profile associated with the current `distinct_id`. Learn more about [identifying users](/docs/product-analytics/identify)

**Notes:**

Deletes the given person properties from the person profile in PostHog. This is the counterpart to  — instead of hand-passing `$unset` inside a `capture()` call, you can remove properties with a dedicated method. If `person_profiles` is set to `never`, this call is ignored.

### Parameters

- **`propertyNames`** (`string | string[]`) - The name (or names) of the person properties to remove.

### Returns

- `void`

### Examples

#### remove a single property

```ts
// remove a single property
posthog.unsetPersonProperties('plan')
```

#### remove multiple properties

```ts
// remove multiple properties
posthog.unsetPersonProperties(['plan', 'email'])
```

---
