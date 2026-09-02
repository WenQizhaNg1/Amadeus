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

Run the explicit, billable LLM integration smoke test:

```bash
bun run smoke:llm
```
