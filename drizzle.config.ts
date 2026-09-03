import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './apps/amadeus/src/storage/schema.ts',
  out: './drizzle',
});
