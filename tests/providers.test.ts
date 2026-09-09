import { expect, test } from 'vitest';
import { createRepairTransport } from '../src/core/agent/providers.js';

test.each(['openai', 'anthropic'] as const)('sends only snippet and diff to %s and extracts completed text', async (provider) => {
  let body: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json(provider === 'openai'
      ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'submit({ count: 3 })' }] }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'submit({ count: 3 })' }] });
  };
  const repair = createRepairTransport({ provider, model: 'explicit-test-model', apiKey: 'test-key' }, fetcher);
  const request = { snippet: 'submit({ count: "3" })', changes: [] };
  expect(await repair(request, AbortSignal.timeout(1000))).toBe('submit({ count: 3 })');
  const input = provider === 'openai' ? body.input : (body.messages as { content: string }[])[0]?.content;
  expect(JSON.parse(String(input))).toEqual(request);
  expect(body.model).toBe('explicit-test-model');
  if (provider === 'openai') expect(body.store).toBe(false);
});
