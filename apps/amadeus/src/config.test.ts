import { describe, expect, test } from 'bun:test';

import { ConfigurationError, loadConfig } from './config.ts';

describe('loadConfig', () => {
  test('loads and trims DeepSeek configuration', () => {
    expect(
      loadConfig({
        DEEPSEEK_API_KEY: ' secret ',
        DEEPSEEK_BASE_URL: 'https://example.com',
        DEEPSEEK_MODEL: ' model-name ',
      }),
    ).toEqual({
      deepseek: {
        apiKey: 'secret',
        baseURL: 'https://example.com',
        model: 'model-name',
      },
    });
  });

  test('uses the official API URL by default', () => {
    const config = loadConfig({
      DEEPSEEK_API_KEY: 'secret',
      DEEPSEEK_MODEL: 'model-name',
    });

    expect(config.deepseek.baseURL).toBe('https://api.deepseek.com');
  });

  test('reports field names without exposing their values', () => {
    const leakedValue = 'do-not-leak-this-value';

    try {
      loadConfig({
        DEEPSEEK_API_KEY: leakedValue,
        DEEPSEEK_BASE_URL: 'not-a-url',
      });
      throw new Error('Expected configuration validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain('DEEPSEEK_BASE_URL');
      expect((error as Error).message).toContain('DEEPSEEK_MODEL');
      expect((error as Error).message).not.toContain(leakedValue);
    }
  });
});
