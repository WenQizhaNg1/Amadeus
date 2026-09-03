# AMADEUS

Install dependencies:

```bash
bun install
```

Copy `.env.example` to `.env` and set the generic `LLM_API_KEY`,
`LLM_BASE_URL`, and `LLM_MODEL` values for an OpenAI-compatible endpoint. Bun
loads `.env` automatically. The bootstrap uses the Responses API explicitly;
the configured endpoint must support that protocol. AMADEUS core receives only
an Agents SDK `Model`.

Run the unit tests and type check:

```bash
bun test
bun run typecheck
```

The database schema is declared in
`apps/amadeus/src/storage/schema.ts`. After changing it, generate a migration:

```bash
bun run db:generate
```

Migrations are applied automatically when AMADEUS opens the database. The
Drizzle schema intentionally does not support databases created by the earlier
`bun:sqlite` implementation; move the old `data/amadeus.db` aside before the
first start if one exists.

Start the text-mode backend. Each non-empty stdin line becomes one Turn;
`Ctrl+C`, `SIGTERM`, or stdin EOF closes AMADEUS and then its model provider:

```bash
bun start
```

Run the explicit, billable LLM integration smoke test:

```bash
bun run smoke:llm
```
