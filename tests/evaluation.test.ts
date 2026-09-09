import { expect, test } from 'vitest';
import { evaluateCase } from '../src/evaluation/corpus.js';
import { corpus } from './fixtures/corpus/cases.js';

test.each(corpus)('$id: $description', async (fixture) => {
  const result = await evaluateCase(fixture);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
  expect(result.llmRequests).toBe(0);
});
