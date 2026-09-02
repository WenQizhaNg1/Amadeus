import { z } from 'zod';

const environmentSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().min(1),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().trim().min(1),
});

export interface AmadeusConfig {
  deepseek: {
    apiKey: string;
    baseURL: string;
    model: string;
  };
}

export class ConfigurationError extends Error {
  constructor(fields: string[]) {
    super(`Invalid or missing configuration: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(
  environment: Record<string, string | undefined> = Bun.env,
): AmadeusConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map((issue) => String(issue.path[0] ?? 'unknown')),
      ),
    ];
    throw new ConfigurationError(fields);
  }

  return {
    deepseek: {
      apiKey: parsed.data.DEEPSEEK_API_KEY,
      baseURL: parsed.data.DEEPSEEK_BASE_URL,
      model: parsed.data.DEEPSEEK_MODEL,
    },
  };
}
