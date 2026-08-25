# PostHog JS initialization methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Initialization methods

#### debug()

**Release Tag:** public

Enables or disables debug mode for detailed logging.

**Notes:**

Debug mode logs all PostHog calls to the browser console for troubleshooting. Can also be enabled by adding `?__posthog_debug=true` to the URL.

### Parameters

- **`debug?`** (`boolean`) - If true, will enable debug mode.

### Returns

- `void`

### Examples

#### enable debug mode

```ts
// enable debug mode
posthog.debug(true)
```

#### disable debug mode

```ts
// disable debug mode
posthog.debug(false)
```

---

#### getPageViewId()

**Release Tag:** public

Returns the current page view ID.

### Returns

**Union of:**
- `string`
- `undefined`

### Examples

```ts
// Generated example for getPageViewId
posthog.getPageViewId();
```

---

#### init()

**Release Tag:** public

Initializes a new instance of the PostHog capturing object.

**Notes:**

All new instances are added to the main posthog object as sub properties (such as `posthog.library_name`) and also returned by this function. [Learn more about configuration options](https://posthog.com/docs/libraries/js/config)

### Parameters

- **`token`** (`string`) - Your PostHog API token
- **`config?`** (`OnlyValidKeys<Partial<PostHogConfig>, Partial<PostHogConfig>>`) - A dictionary of config options to override
- **`name?`** (`string`) - The name for the new posthog instance that you want created

### Returns

- `PostHog`

### Examples

#### basic initialization

```ts
// basic initialization
posthog.init('<ph_project_api_key>', {
    api_host: '<ph_client_api_host>'
})
```

#### multiple instances

```ts
// multiple instances
posthog.init('<ph_project_api_key>', {}, 'project1')
posthog.init('<ph_project_api_key>', {}, 'project2')
```

---

#### set_config()

**Release Tag:** public

Updates the configuration of the PostHog instance.

### Parameters

- **`config`** (`Partial<PostHogConfig>`) - A dictionary of new configuration values to update

### Returns

- `void`

### Examples

```ts
// Generated example for set_config
posthog.set_config();
```

---
