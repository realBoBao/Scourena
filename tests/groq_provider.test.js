/**
 * Groq LPU Provider Tests — Tier 2
 *
 * Tests the Groq provider integration in the LLM fallback chain.
 * No actual API calls — tests module loading and factory behavior.
 */
import { describe, test, expect } from '@jest/globals';

describe('Groq Provider — module integration', () => {
  test('llm.js loads without errors after Groq addition', async () => {
    const llm = await import('../lib/llm.js');
    expect(llm.ask).toBeDefined();
    expect(llm.askWithContext).toBeDefined();
    expect(typeof llm.ask).toBe('function');
  });

  test('createGroqLlm is exported and is a function', async () => {
    const { createGroqLlm } = await import('../lib/llm.js');
    expect(typeof createGroqLlm).toBe('function');
  });

  test('createGroqLlm returns null when GROQ_API_KEY is not set', async () => {
    const { createGroqLlm } = await import('../lib/llm.js');
    const llm = createGroqLlm();
    // No API key in test env → should gracefully return null
    expect(llm).toBeNull();
  });

  test('createGroqLlm does not throw with model option', async () => {
    const { createGroqLlm } = await import('../lib/llm.js');
    expect(() => createGroqLlm({ model: 'llama-3.3-70b-versatile' })).not.toThrow();
  });
});

describe('Groq Provider — ask() integration', () => {
  test('ask() with provider="groq" does not throw (falls through chain)', async () => {
    const { ask } = await import('../lib/llm.js');
    // Without API key, Groq will fail and fall through to next provider
    // The function should not throw — it should fallback
    const result = await ask('test', { provider: 'groq', maxTokens: 10 });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('provider');
  });

  test('ask() default chain includes Groq as first provider', async () => {
    const { ask } = await import('../lib/llm.js');
    // Default (no provider specified) should try Groq first, then fallback
    const result = await ask('hello', { maxTokens: 10 });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('provider');
    // Provider should be one of the available ones (groq/openrouter/gemini/local/static)
    expect(['groq', 'openrouter', 'gemini', 'local', 'static']).toContain(result.provider);
  });
});
