# AMADEUS

Install dependencies:

```bash
bun install
```

Copy `.env.example` to `.env` and set the generic `LLM_API_KEY`,
`LLM_BASE_URL`, and `LLM_MODEL` values for an OpenAI-compatible endpoint. Bun
loads `.env` automatically. API protocol details remain in the bootstrap code;
AMADEUS core receives only an Agents SDK `Model`.

Run the unit tests and type check:

```bash
bun test
bun run typecheck
```

Start the text-mode backend. Each non-empty stdin line becomes one Turn;
`Ctrl+C`, `SIGTERM`, or stdin EOF closes AMADEUS and then its model provider:

```bash
bun start
```

Run the explicit, billable LLM integration smoke test:

```bash
bun run smoke:llm
```
