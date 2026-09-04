# Coding Instructions

Write simple, elegant, maintainable code.

* Follow KISS. Prefer the simplest solution that solves the actual problem.
* Avoid over-engineering, premature abstraction, unnecessary layers, wrappers, factories, and excessive generic design.
* Prefer clear, explicit code over clever code.
* Keep modules cohesive, interfaces small, and dependencies minimal.
* Avoid excessive defensive programming. Validate real external boundaries and handle realistic failures.
* Preserve useful error context. Do not silently swallow errors.
* When modifying code, make the smallest coherent change and avoid unrelated rewrites.
* Prefer existing project conventions before introducing new patterns.

## Project Conventions

* Use Bun as the runtime, package manager, script runner, and test runner.
* Write source code and tests in TypeScript. Use modern ECMAScript syntax and ES modules supported by the current `ESNext` target.
* Do not introduce CommonJS, legacy compatibility helpers, or transpiler-specific patterns.
* Preserve strict type safety. Avoid `any`, unchecked type assertions, and non-null assertions unless the boundary cannot be modeled more accurately.
* Use `import type` and `export type` for type-only dependencies.
* Include `.ts` extensions in relative imports and use the `node:` prefix for Node.js built-ins.
* Prefer `const`, `async`/`await`, optional chaining, nullish coalescing, and native platform APIs when they keep the code clearer.
* Keep production code under `apps/amadeus/src` and tests under `apps/amadeus/tests`, mirroring the source layout where practical.
* Avoid adding dependencies for small utilities that are straightforward to implement with existing platform or project APIs.

## Validation

* Add or update focused `bun:test` coverage when behavior changes or bugs are fixed.
* Run `bun run typecheck` and `bun test` after code changes.
* Run `bun run smoke:llm` only when explicitly needed. It calls an external model and may incur cost.

## Database

* Define schema changes in `apps/amadeus/src/storage/schema.ts`.
* Run `bun run db:generate` after schema changes and review the generated migration.
* Do not rewrite existing migrations that may already have been applied.

## Documentation

* Keep code comments and documentation concise, direct, and easy to understand.
* Explain intent, constraints, and important design decisions.
* Avoid verbose explanations and unnecessary repetition.
* Avoid the Chinese contrast pattern “不是……而是……”.
* Prefer short declarative sentences and straightforward descriptions.

## Network

Do not set persistent global proxy environment variables.

Try network access directly first. If it fails, retry using:

`http://127.0.0.1:10808`

Scope the proxy to the specific command or request only. Prefer a tool's native proxy option when available.
