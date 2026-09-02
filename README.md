# AMADEUS

Install dependencies:

```bash
bun install
```

Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY` and
`DEEPSEEK_MODEL`. Bun loads `.env` automatically.

Run the unit tests and type check:

```bash
bun test
bun run typecheck
```

Run the explicit, billable DeepSeek integration smoke test:

```bash
bun run smoke:llm
```
