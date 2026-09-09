import type { EvaluationCase } from '../../../src/evaluation/corpus.js';

/** Compact, repository-owned fixtures. Expected observations are literal business outcomes. */
const operationDoc = (operationId: string) => ({
  openapi: '3.1.0', info: { title: 'Evaluation API', version: '1' },
  paths: { '/people': { get: { operationId, responses: { '200': { description: 'OK' } } } } },
});

export const corpus: EvaluationCase[] = [{
  id: 'operation-rename-through-barrel',
  description: 'Rename an SDK operation through a barrel and an aliased import.',
  before: operationDoc('getPerson'), after: operationDoc('fetchPerson'),
  files: {
    '/sdk.ts': 'export function getPerson(id: string) { return `person:${id}`; }',
    '/index.ts': 'export { getPerson } from "./sdk.js";',
    '/consumer.ts': 'import { getPerson as load } from "./index.js"; export const result = load("42");',
  },
  bindings: { operations: { getPerson: { file: '/sdk.ts', export: 'getPerson' } }, schemas: {} },
  expected: { status: 'verified', before: 'person:42', after: 'person:42' },
}];
