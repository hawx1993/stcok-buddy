# PostHog JS session replay methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Session replay methods

#### get_session_replay_url()

**Release Tag:** public

Returns the Replay url for the current session.

### Parameters

- **`options?`** (`{
        withTimestamp?: boolean;
        timestampLookBack?: number;
    }`) - Options for the URL.

### Returns

- `string`

### Examples

#### basic usage

```ts
// basic usage
posthog.get_session_replay_url()
```

#### timestamp

```ts
// timestamp
posthog.get_session_replay_url({ withTimestamp: true })
```

#### timestamp and lookback

```ts
// timestamp and lookback
posthog.get_session_replay_url({
  withTimestamp: true,
  timestampLookBack: 30 // look back 30 seconds
})
```

---

#### sessionRecordingStarted()

**Release Tag:** public

returns a boolean indicating whether session recording is currently running

### Returns

- `boolean`

### Examples

```ts
// Stop session recording if it's running
if (posthog.sessionRecordingStarted()) {
  posthog.stopSessionRecording()
}
```

---

#### startSessionRecording()

**Release Tag:** public

turns session recording on, and updates the config option `disable_session_recording` to false

### Parameters

- **`override?`** (`{
        sampling?: boolean;
        linked_flag?: boolean;
        url_trigger?: true;
        event_trigger?: true;
    } | true`) - optional boolean to override the default sampling behavior - ensures the next session recording to start will not be skipped by sampling or linked_flag config. `true` is shorthand for  sampling: true, linked_flag: true

### Returns

- `void`

### Examples

#### Start and ignore controls

```ts
// Start and ignore controls
posthog.startSessionRecording(true)
```

#### Start and override controls

```ts
// Start and override controls
posthog.startSessionRecording({
  // you don't have to send all of these
  sampling: true || false,
  linked_flag: true || false,
  url_trigger: true || false,
  event_trigger: true || false
})
```

---

#### stopSessionRecording()

**Release Tag:** public

turns session recording off, and updates the config option disable_session_recording to true

### Returns

- `void`

### Examples

```ts
// Stop session recording
posthog.stopSessionRecording()
```

---
