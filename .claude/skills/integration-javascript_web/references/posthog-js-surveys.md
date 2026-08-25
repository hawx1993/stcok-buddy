# PostHog JS surveys methods

> Split from `posthog-js.md`. Read only when the current integration step needs these API details.

### Surveys methods

#### cancelPendingSurvey()

**Release Tag:** public

Cancels a pending survey that is waiting to be displayed (e.g., due to a popup delay).

### Parameters

- **`surveyId`** (`string`) - The survey ID whose pending display should be cancelled.

### Returns

- `void`

### Examples

```ts
// Generated example for cancelPendingSurvey
posthog.cancelPendingSurvey();
```

---

#### canRenderSurvey()

**Release Tag:** deprecated

Checks the feature flags associated with this Survey to see if the survey can be rendered. This method is deprecated because it's synchronous and won't return the correct result if surveys are not loaded. Use `canRenderSurveyAsync` instead.

### Parameters

- **`surveyId`** (`string`) - The ID of the survey to check.

### Returns

**Union of:**
- `SurveyRenderReason`
- `null`

### Examples

```ts
// Generated example for canRenderSurvey
posthog.canRenderSurvey();
```

---

#### canRenderSurveyAsync()

**Release Tag:** public

Checks the feature flags associated with this Survey to see if the survey can be rendered.

### Parameters

- **`surveyId`** (`string`) - The ID of the survey to check.
- **`forceReload?`** (`boolean`) - If true, the survey will be reloaded from the server, Default: false

### Returns

- `Promise<SurveyRenderReason>`

### Examples

```ts
posthog.canRenderSurveyAsync(surveyId).then((result) => {
    if (result.visible) {
        // Survey can be rendered
        console.log('Survey can be rendered')
    } else {
        // Survey cannot be rendered
        console.log('Survey cannot be rendered:', result.disabledReason)
    }
})
```

---

#### displaySurvey()

**Release Tag:** public

Display a survey programmatically as either a popover or inline element.

### Parameters

- **`surveyId`** (`string`) - The survey ID to display.
- **`options?`** (`DisplaySurveyOptions`) - Display configuration. Defaults to a popover that respects dashboard conditions and delays.

### Returns

- `void`

### Examples

#### Display as popover (respects all conditions defined in the dashboard)

```ts
// Display as popover (respects all conditions defined in the dashboard)
posthog.displaySurvey('survey-id-123')
```

#### Display inline in a specific element

```ts
// Display inline in a specific element
posthog.displaySurvey('survey-id-123', {
  displayType: DisplaySurveyType.Inline,
  ignoreConditions: false,
  ignoreDelay: false,
  selector: '#survey-container'
})
```

#### Force display ignoring conditions and delays

```ts
// Force display ignoring conditions and delays
posthog.displaySurvey('survey-id-123', {
  displayType: DisplaySurveyType.Popover,
  ignoreConditions: true,
  ignoreDelay: true
})
```

---

#### getActiveMatchingSurveys()

**Release Tag:** public

Get surveys that should be enabled for the current user. See [fetching surveys documentation](/docs/surveys/implementing-custom-surveys#fetching-surveys-manually) for more details.

### Parameters

- **`callback`** (`SurveyCallback`) - The callback function will be called when the surveys are loaded or updated.
- **`forceReload?`** (`boolean`) - Whether to force a reload of the surveys.

### Returns

- `void`

### Examples

```ts
posthog.getActiveMatchingSurveys((surveys) => {
     // do something
})
```

---

#### getSurveys()

**Release Tag:** public

Get list of all surveys.

### Parameters

- **`callback`** (`SurveyCallback`) - Function that receives the array of surveys.
- **`forceReload?`** (`boolean`) - Optional boolean to force an API call for updated surveys.

### Returns

- `void`

### Examples

```ts
function callback(surveys, context) {
  // do something
}

posthog.getSurveys(callback, false)
```

---

#### onSurveysLoaded()

**Release Tag:** public

Register an event listener that runs when surveys are loaded.
Callback parameters: - surveys: Survey[]: An array containing all survey objects fetched from PostHog using the getSurveys method - context:  isLoaded: boolean, error?: string : An object indicating if the surveys were loaded successfully

### Parameters

- **`callback`** (`SurveyCallback`) - The callback function will be called when surveys are loaded or updated.

### Returns

- `() => void`

### Examples

```ts
posthog.onSurveysLoaded((surveys, context) => { // do something })
```

---

#### renderSurvey()

**Release Tag:** deprecated

Although we recommend using popover surveys and display conditions, if you want to show surveys programmatically without setting up all the extra logic needed for API surveys, you can render surveys programmatically with the renderSurvey method.
This takes a survey ID and an HTML selector to render an unstyled survey.

### Parameters

- **`surveyId`** (`string`) - The ID of the survey to render.
- **`selector`** (`string`) - The selector of the HTML element to render the survey on.

### Returns

- `void`

### Examples

```ts
posthog.renderSurvey(coolSurveyID, '#survey-container')
```

---
