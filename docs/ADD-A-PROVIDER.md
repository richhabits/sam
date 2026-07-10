# Add an AI provider

SAM is **brain-agnostic by design**: adding a new model provider is a config drop, not a rewrite. This is
the future-proofing — SAM rides every new model without waiting for a release, and is never tied to one
vendor.

## The Provider interface

```ts
interface Provider {
  id: string;                    // "groq", "cerebras", …
  tier: "local" | "free" | "premium";
  label: string;                 // shown in the router badge, e.g. `groq:llama-3.3-70b`
  run: (system: string, prompt: string, key: string) => Promise<string>;
}
```

Most providers are OpenAI-compatible, so adding one is a single line using the shared helper:

```ts
// server/models.ts — in the PROVIDERS array
{ id: "myprovider", tier: "free",
  label: `myprovider:${MYPROVIDER_MODEL}`,
  run: (s, p, k) => callOpenAICompat("https://api.myprovider.com/v1", MYPROVIDER_MODEL, s, p, k) },
```

Then add the key + model env vars (pooled keys use the `*_API_KEYS` convention so several keys rotate):

```bash
# .env
MYPROVIDER_API_KEYS=key1,key2
MYPROVIDER_MODEL=some-model-name
```

That's it. The cascade router now considers it at its tier:

- **local** → tried first, never a paid API (your Ollama).
- **free** → free cloud tiers, auto-rotating across keys.
- **premium** → only reached on explicit opt-in (`DEFAULT_TIER=premium`) or a failed cheap-tier self-check.

## Non-OpenAI shapes

If the API isn't OpenAI-compatible, write a small `run()` that calls it and returns the completion string
— the router only needs `(system, prompt, key) => Promise<string>`. Keep the request minimal; don't send
anything you don't need to (and never the local preference profile — see `preferences.ts`).

## Free-first stays law

New providers slot into the tier system; they don't change the rule that SAM routes to the **cheapest
capable brain first**. A premium provider is reached only when the user opts in. That's what keeps the
reproducible **~86% cheaper** benchmark true no matter how many providers exist.
