# PostHog JS error tracking methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Error tracking methods

#### addExceptionStep()

**Release Tag:** public

Add a breadcrumb-like step that will be attached to the next captured exception.

### Parameters

- **`message`** (`string`) - The step message.
- **`properties?`** (`Properties`) - Additional context for this step.

### Returns

- `void`

### Examples

```ts
posthog.addExceptionStep('Checkout button clicked', {
  checkout_id: 'ch_123',
})
```

---

#### captureException()

**Release Tag:** public

Capture a caught exception manually

### Parameters

- **`error`** (`unknown`) - The error or exception-like value to capture.
- **`additionalProperties?`** (`Properties`) - Any additional properties to add to the error event.

### Returns

**Union of:**
- `CaptureResult`
- `undefined`

### Examples

#### Capture a caught exception

```ts
// Capture a caught exception
try {
  // something that might throw
} catch (error) {
  posthog.captureException(error)
}
```

#### With additional properties

```ts
// With additional properties
posthog.captureException(error, {
  customProperty: 'value',
  anotherProperty: ['I', 'can be a list'],
  ...
})
```

---

#### startExceptionAutocapture()

**Release Tag:** public

turns exception autocapture on, and updates the config option `capture_exceptions` to the provided config (or `true`)

### Parameters

- **`config?`** (`ExceptionAutoCaptureConfig`) - optional configuration option to control the exception autocapture behavior

### Returns

- `void`

### Examples

#### Start with default exception autocapture rules. No-op if already enabled

```ts
// Start with default exception autocapture rules. No-op if already enabled
posthog.startExceptionAutocapture()
```

#### Start and override controls

```ts
// Start and override controls
posthog.startExceptionAutocapture({
  // you don't have to send all of these (unincluded values will use the default)
  capture_unhandled_errors: true || false,
  capture_unhandled_rejections: true || false,
  capture_console_errors: true || false
})
```

---

#### stopExceptionAutocapture()

**Release Tag:** public

turns exception autocapture off by updating the config option `capture_exceptions` to `false`

### Returns

- `void`

### Examples

```ts
// Stop capturing exceptions automatically
posthog.stopExceptionAutocapture()
```

---
