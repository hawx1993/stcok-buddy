# PostHog JS logs, LLM analytics and privacy methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Logs methods

#### captureLog()

**Release Tag:** public

Capture a log entry and send it to the PostHog logs endpoint.

### Parameters

- **`options`** (`CaptureLogOptions`) - The log entry options

### Returns

- `void`

### Examples

```ts
posthog.captureLog({
  body: 'checkout completed',
  level: 'info',
  attributes: { order_id: 'ord_789', amount_cents: 4999 },
})
```

---

### LLM analytics methods

#### captureTraceFeedback()

**Release Tag:** public

Capture written user feedback for a LLM trace. Numeric values are converted to strings.

### Parameters

- **`traceId`** (`string | number`) - The trace ID to capture feedback for.
- **`userFeedback`** (`string`) - The feedback to capture.

### Returns

- `void`

### Examples

```ts
// Generated example for captureTraceFeedback
posthog.captureTraceFeedback();
```

---

#### captureTraceMetric()

**Release Tag:** public

Capture a metric for a LLM trace. Numeric values are converted to strings.

### Parameters

- **`traceId`** (`string | number`) - The trace ID to capture the metric for.
- **`metricName`** (`string`) - The name of the metric to capture.
- **`metricValue`** (`string | number | boolean`) - The value of the metric to capture.

### Returns

- `void`

### Examples

```ts
// Generated example for captureTraceMetric
posthog.captureTraceMetric();
```

---

### Privacy methods

#### clear_opt_in_out_capturing()

**Release Tag:** public

Clear the user's opt in/out status of data capturing and cookies/localstorage for this PostHog instance

### Returns

- `void`

### Examples

```ts
// Generated example for clear_opt_in_out_capturing
posthog.clear_opt_in_out_capturing();
```

---

#### has_opted_in_capturing()

**Release Tag:** public

Checks if the user has opted into data capturing.

**Notes:**

Returns the current consent status for event tracking and data persistence.

### Returns

- `boolean`

### Examples

```ts
if (posthog.has_opted_in_capturing()) {
    // show analytics features
}
```

---

#### has_opted_out_capturing()

**Release Tag:** public

Checks if the user has opted out of data capturing.

**Notes:**

Returns the current consent status for event tracking and data persistence.

### Returns

- `boolean`

### Examples

```ts
if (posthog.has_opted_out_capturing()) {
    // disable analytics features
}
```

---

#### is_capturing()

**Release Tag:** public

Checks whether the PostHog library is currently capturing events.
Usually this means that the user has not opted out of capturing, but the exact behaviour can be controlled by some config options.
Additionally, if the cookieless_mode is set to `'on_reject'`, we will capture events in cookieless mode if the user has opted out or been defaulted to opt-out.

### Returns

- `boolean`

### Examples

```ts
// Generated example for is_capturing
posthog.is_capturing();
```

---

#### opt_in_capturing()

**Release Tag:** public

Opts the user into data capturing and persistence.

**Notes:**

Enables event tracking and data persistence (cookies/localStorage) for this PostHog instance. By default, captures an `$opt_in` event unless disabled.

### Parameters

- **`options?`** (`{
        captureEventName?: EventName | null | false; /** event name to be used for capturing the opt-in action */
        captureProperties?: Properties; /** set of properties to be captured along with the opt-in action */
    }`) - A dictionary of opt-in options.

### Returns

- `void`

### Examples

#### simple opt-in

```ts
// simple opt-in
posthog.opt_in_capturing()
```

#### opt-in with custom event and properties

```ts
// opt-in with custom event and properties
posthog.opt_in_capturing({
    captureEventName: 'Privacy Accepted',
    captureProperties: { source: 'banner' }
})
```

#### opt-in without capturing event

```ts
// opt-in without capturing event
posthog.opt_in_capturing({
    captureEventName: false
})
```

---

#### opt_out_capturing()

**Release Tag:** public

Opts the user out of data capturing and persistence.

**Notes:**

Disables event tracking and data persistence (cookies/localStorage) for this PostHog instance. If `opt_out_persistence_by_default` is true, SDK persistence will also be disabled.

### Returns

- `void`

### Examples

```ts
// opt user out (e.g., on privacy settings page)
posthog.opt_out_capturing()
```

---
