# AI provider setup

The application supports DeepSeek and the Gemini Developer API. Neither the
Anthropic API nor its SDK is used. Provider adapters implement the existing
`Provider` interface inside `src/modules/ai`; product code uses `callModel`.
No additional npm dependency is needed.

## DeepSeek

Set these values in `.env.local`:

```dotenv
AI_PROVIDER=deepseek
AI_API_KEY=your-key
MODEL_EXTRACTION=deepseek-flash
MODEL_REASONING=deepseek-v4-pro
```

As checked on 2026-09-25, `deepseek-flash` serves DeepSeek V4.1 Flash and
`deepseek-v4-pro` serves V4 Pro. The adapter uses `/chat/completions`, JSON output
mode, and a schema instruction in the system message. JSON mode does not guarantee
schema conformity; local Zod validation is always applied.

Thinking is disabled for these bounded structured-output calls, including the
reasoning tier. The tier currently selects a model, not a thinking mode. This
keeps hidden reasoning from consuming the task's output budget. Adding thinking
controls later requires appropriate task budgets and evaluation.

## Gemini

```dotenv
AI_PROVIDER=gemini
AI_API_KEY=your-key
MODEL_EXTRACTION=gemini-3.5-flash-lite
MODEL_REASONING=gemini-3.5-flash-lite
```

This is a low-cost text-model example, not an automatic latest-model selector.
The adapter uses `generateContent` with a JSON response schema. Other compatible
Gemini text model IDs can be selected by setting the model variables and adding
their rates below. This adapter does not configure Vertex AI authentication.

`AI_API_KEY` holds the credential for the provider selected by `AI_PROVIDER`.
When switching providers, replace its value with that provider's key and update
the model IDs. The key is required only on the first model call. Restart the web
and worker processes after changing configuration.

For existing installations, rename the selected provider's key variable in
`.env.local` to `AI_API_KEY`.

## New models and cost estimates

Model IDs are not restricted to a compiled enum. New versions require no adapter
change if they retain the supported API contract and structured text output.
Calls to a model with no configured price fail before sending a request.

Built-in rates are USD per million tokens:

| Provider/model | Uncached input | Output | Cached input |
| --- | ---: | ---: | ---: |
| `deepseek/deepseek-flash` | 0.30 | 1.20 | 0.006 |
| `deepseek/deepseek-v4-pro` | 1.32 | 3.96 | 0.044 |
| `gemini/gemini-3.5-flash-lite` | 0.30 | 2.50 | 0.03 |

`costMicroUsd` is an estimate rounded to integer micro-USD, not an invoice amount.
DeepSeek defaults use peak rates; actual off-peak charges may be lower. Gemini
defaults use standard paid text rates, not free-tier, batch, or priority rates.
No explicit cache is created, so storage charges are outside this estimate.

Override rates or add a new model with `AI_MODEL_PRICING`, a JSON object keyed by
`provider/model`. For example, the following selects the documented DeepSeek
Flash off-peak rates; it does not automatically switch rates by time:

```dotenv
AI_MODEL_PRICING={"deepseek/deepseek-flash":{"input":0.15,"output":0.6,"cacheRead":0.003}}
```

For a new model, use its actual API model ID in the key and supply verified
`input`, `output`, and `cacheRead` rates. Optional `cacheWrite` defaults to zero.
Update rates when model aliases or provider billing change.

Cached prompt tokens are excluded from uncached input counts. Gemini thinking
tokens are included in output usage; thought text is excluded from the JSON being
validated. DeepSeek completion usage is taken directly from the API.

## Failure behavior and verification

Both adapters validate HTTP response envelopes with Zod, use a 60-second request
timeout, and retry network errors and HTTP 408/409/429/5xx up to twice. HTTP error
bodies are not logged because they may echo private input. Refusals and truncated
outputs are surfaced without a validation retry. Invalid model JSON/schema output
gets one corrective retry through `callModel`.

`pnpm test` uses stubbed HTTP responses and makes no paid model calls. Once the
selected API key is configured, run `pnpm ai:smoke` for one real structured-output
request using `MODEL_EXTRACTION`. It incurs provider usage. This proves provider
wiring, not eligibility quality; that needs the separate eligibility eval suite.

## Official references

- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek chat completion contract](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini GenerateContent reference](https://ai.google.dev/api/generate-content)
- [Gemini Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
