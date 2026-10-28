# AI provider setup

The application uses DeepSeek and the Gemini Developer API side by side. Neither the
Anthropic API nor its SDK is used. Provider adapters implement the `Provider` interface
inside `src/modules/ai`; product code uses `callModel`. No additional npm dependency is
needed.

## Configuration

Tasks run on one of two configured models, by role. `.env.local` says which provider,
model and key fill each role; code only says which role each task uses (decision 0015).
Either provider can fill either role.

```dotenv
AI_PRIMARY_PROVIDER=gemini            # gemini | deepseek
AI_PRIMARY_MODEL=gemini-3.5-flash-lite
AI_PRIMARY_API_KEY=your-key
AI_SECONDARY_PROVIDER=deepseek
AI_SECONDARY_MODEL=deepseek-flash
AI_SECONDARY_API_KEY=your-key
```

Check both with `pnpm ai:smoke` (one cheap call per role). A role's settings are required
only when one of its tasks is called, so the app boots without them, and an unset role
stops only its own tasks. Restart the web and worker processes after a change.

| Task | Role | Eval to run after changing the role's model |
| --- | --- | --- |
| `eligibility.extract-claims` | primary | `pnpm eval:eligibility` |
| `career-knowledge.extract-resume` | primary | none (personal data: keep it on a provider trusted with it) |
| `matching.extract-requirements` | secondary | `pnpm eval:matching` |
| `application-answers.read-questions` | secondary | none (every draft is accepted by the owner) |
| `application-answers.match-questions` | secondary | none (every pair is accepted by the owner) |

**Changing a model is a settings change, so the eval is on you.** The evals read the same
settings and store their extractions per model, so after a change they measure the new
model. As of 2026-10-27, DeepSeek Flash fails the eligibility eval (it hides jobs the
candidate can take) and passes the matching eval; see the eval reports.

There is no fallback: when a provider fails or runs out of credit (reported as "out of
credit (HTTP 402)"), its tasks wait and retry rather than run on the other role.

## DeepSeek

As checked on 2026-09-25, `deepseek-flash` serves DeepSeek V4.1 Flash. It is an alias that
DeepSeek moves to newer models, and traces record the alias, not the model behind it. The
adapter uses `/chat/completions`, JSON output mode, and a schema instruction in the system
message. JSON mode does not guarantee schema conformity; local Zod validation is always
applied. Thinking is disabled for these bounded structured-output calls, which keeps hidden
reasoning from consuming the task's output budget.

## Gemini

The adapter uses `generateContent` with a JSON response schema. It does not configure
Vertex AI authentication. Rates below are paid-tier rates; on the free tier, Google may
use the content, which is why resume reading stays on a paid key.

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

`pnpm test` uses stubbed HTTP responses and makes no paid model calls. Once both roles
are configured, run `pnpm ai:smoke` for one real structured-output request per role. It incurs provider usage. This proves provider
wiring, not eligibility quality; that needs the separate eligibility eval suite.

## Official references

- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek chat completion contract](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini GenerateContent reference](https://ai.google.dev/api/generate-content)
- [Gemini Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
