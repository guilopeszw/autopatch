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

const objectDoc = (properties: Record<string, unknown>, required: string[] = ['id']) => ({
  openapi: '3.1.0', info: { title: 'Evaluation API', version: '1' }, paths: {},
  components: { schemas: { Input: { type: 'object', properties, required } } },
});
const original = objectDoc({ id: { type: 'string' }, name: { type: 'string' } });
const renamed = objectDoc({ id: { type: 'string' }, displayName: { type: 'string', 'x-autopatch-previous-name': 'name' } });
const bindings = { operations: { submit: { file: '/sdk.ts', export: 'submit' } }, schemas: { Input: { file: '/sdk.ts', export: 'Input' } } };
const sdk = 'export interface Input { id: string; name?: string } export function submit(input: Input) { const { name: label } = input; return label ?? "missing"; }';
const typedConsumer = 'import { submit, type Input } from "./sdk.js"; const name = "Ada"; const input: Input = { id: "1", name }; export const result = submit(input);';

const nullableEnumCase: EvaluationCase = {
  id: 'nullable-enum-excludes-null',
  description: 'Reject null when nullable widens the scalar type but enum still excludes null.',
  before: { ...objectDoc({ id: { type: 'string' } }), openapi: '3.0.3' },
  after: { ...objectDoc({ id: { type: 'string' }, region: { type: 'string', nullable: true, enum: ['eu', 'us'] } }, ['id', 'region']), openapi: '3.0.3' },
  files: {
    '/sdk.ts': 'export interface Input { id: string } export function submit(input: Input) { return JSON.stringify(input); }',
    '/consumer.ts': 'import { submit } from "./sdk.js"; export const result = submit({ id: "1" });',
  },
  bindings: { operations: bindings.operations, schemas: { Input: { file: '/sdk.ts', export: 'Input', defaults: { region: null } } } },
  expected: { status: 'blocked', reason: 'Configured default for region does not satisfy' },
};
corpus.push(nullableEnumCase);
corpus.push({
  ...nullableEnumCase,
  id: 'nullable-enum-includes-null',
  description: 'Accept a configured null when both the scalar type and enum permit it.',
  after: { ...objectDoc({ id: { type: 'string' }, region: { type: 'string', nullable: true, enum: ['eu', 'us', null] } }, ['id', 'region']), openapi: '3.0.3' },
  expected: { status: 'verified', before: '{"id":"1"}', after: '{"id":"1","region":null}' },
});

corpus.push(
  {
    id: 'optional-property-and-destructuring', description: 'Preserve an optional value, local shorthand and destructured binding.',
    before: original, after: renamed, bindings,
    files: { '/sdk.ts': sdk, '/consumer.ts': typedConsumer },
    expected: { status: 'verified', before: 'Ada', after: 'Ada' },
  },
  {
    id: 'response-property-rename', description: 'Migrate a typed SDK response and the consumer reading it.',
    before: original, after: renamed, bindings: { operations: {}, schemas: bindings.schemas },
    files: {
      '/sdk.ts': 'export interface Input { id: string; name?: string } export function fetchPerson(): Input { return { id: "1", name: "Ada" }; }',
      '/consumer.ts': 'import { fetchPerson } from "./sdk.js"; const { name } = fetchPerson(); export const result = name;',
    }, expected: { status: 'verified', before: 'Ada', after: 'Ada' },
  },
  {
    id: 'optional-property-addition', description: 'Add optional contract metadata without inventing a runtime value.',
    before: original, after: objectDoc({ id: { type: 'string' }, name: { type: 'string' }, tracing: { type: 'boolean' } }), bindings,
    files: { '/sdk.ts': sdk, '/consumer.ts': typedConsumer },
    expected: { status: 'verified', before: 'Ada', after: 'Ada' },
  },
  {
    id: 'tighten-requiredness-with-value', description: 'Make an already supplied field required without changing its value.',
    before: original, after: objectDoc({ id: { type: 'string' }, name: { type: 'string' } }, ['id', 'name']), bindings,
    files: { '/sdk.ts': sdk, '/consumer.ts': typedConsumer },
    expected: { status: 'verified', before: 'Ada', after: 'Ada' },
  },
  {
    id: 'widen-scalar-enum', description: 'Accept another enum member while preserving existing consumers.',
    before: objectDoc({ id: { type: 'string', enum: ['active'] } }),
    after: objectDoc({ id: { type: 'string', enum: ['active', 'paused'] } }), bindings,
    files: {
      '/sdk.ts': 'export interface Input { id: "active" } export function submit(input: Input) { return input.id; }',
      '/consumer.ts': 'import { submit } from "./sdk.js"; export const result = submit({ id: "active" });',
    }, expected: { status: 'verified', before: 'active', after: 'active' },
  },
  {
    id: 'required-property-needs-business-value', description: 'Block a new required field without a configured value.',
    before: original, after: objectDoc({ id: { type: 'string' }, name: { type: 'string' }, region: { type: 'string' } }, ['id', 'region']), bindings,
    files: { '/sdk.ts': sdk, '/consumer.ts': typedConsumer },
    expected: { status: 'blocked', reason: 'Migrated project has compiler errors' },
  },
  {
    id: 'incompatible-type', description: 'Block a consumer whose supplied value does not satisfy the new type.',
    before: original, after: objectDoc({ id: { type: 'number' }, name: { type: 'string' } }), bindings,
    files: { '/sdk.ts': sdk, '/consumer.ts': typedConsumer },
    expected: { status: 'blocked', reason: 'Migrated project has compiler errors' },
  },
  {
    id: 'inferred-optional-producer', description: 'Reject the compiler-valid semantic-corruption case found in review.',
    before: original, after: renamed, bindings,
    files: { '/sdk.ts': sdk, '/consumer.ts': 'import { submit } from "./sdk.js"; const input = { id: "1", name: "Ada" }; export const result = submit(input);' },
    expected: { status: 'blocked', reason: 'Unproven structural rename flow' },
  },
  {
    id: 'removed-operation', description: 'Reject endpoint removal instead of guessing replacement behavior.',
    before: operationDoc('getPerson'), after: { openapi: '3.1.0', info: {}, paths: {} },
    files: { '/sdk.ts': 'export function getPerson() { return "Ada"; }', '/consumer.ts': 'import { getPerson } from "./sdk.js"; export const result = getPerson();' },
    bindings: { operations: { getPerson: { file: '/sdk.ts', export: 'getPerson' } }, schemas: {} },
    expected: { status: 'blocked', reason: 'Operation added or removed' },
  },
);

corpus.push({
  id: 'required-field-with-explicit-value',
  description: 'Use an explicitly configured region in typed request arguments, without an LLM.',
  before: objectDoc({ id: { type: 'string' } }),
  after: objectDoc({ id: { type: 'string' }, region: { type: 'string' } }, ['id', 'region']),
  files: {
    '/sdk.ts': 'export interface Input { id: string } export function submit(input: Input) { return JSON.stringify(input); }',
    '/consumer.ts': 'import { submit, type Input } from "./sdk.js"; const input: Input = { id: "1" }; export const result = submit(input);',
  },
  bindings: { operations: bindings.operations, schemas: { Input: { file: '/sdk.ts', export: 'Input', defaults: { region: 'eu' } } } },
  expected: { status: 'verified', before: '{"id":"1"}', after: '{"id":"1","region":"eu"}' },
});

corpus.push({
  id: 'invalid-configured-value',
  description: 'Reject an explicit value that violates the new contract without exposing partial edits.',
  before: objectDoc({ id: { type: 'string' } }),
  after: objectDoc({ id: { type: 'string' }, region: { type: 'string', enum: ['eu', 'us'] } }, ['id', 'region']),
  files: {
    '/sdk.ts': 'export interface Input { id: string } export function submit(input: Input) { return input.id; }',
    '/consumer.ts': 'import { submit } from "./sdk.js"; export const result = submit({ id: "1" });',
  },
  bindings: { operations: bindings.operations, schemas: { Input: { file: '/sdk.ts', export: 'Input', defaults: { region: 'unknown' } } } },
  expected: { status: 'blocked', reason: 'Configured default for region does not satisfy' },
});

corpus.push({
  id: 'computed-key-preserves-supplied-value',
  description: 'Reject default insertion when a dynamic key could already supply that field.',
  before: objectDoc({ id: { type: 'string' }, region: { type: 'string' } }),
  after: objectDoc({ id: { type: 'string' }, region: { type: 'string' } }, ['id', 'region']),
  files: {
    '/sdk.ts': 'export interface Input { id: string; region?: string } export function submit(input: Input) { return input.region; }',
    '/consumer.ts': 'import { submit, type Input } from "./sdk.js"; const key: string = "region"; const input: Input = { id: "1", [key]: "us" }; export const result = submit(input);',
  },
  bindings: { operations: bindings.operations, schemas: { Input: { file: '/sdk.ts', export: 'Input', defaults: { region: 'eu' } } } },
  expected: { status: 'blocked', reason: 'Cannot infer missing region through a computed property' },
});

corpus.push({
  id: 'fractional-integer-default',
  description: 'Reject fractional configured values for integer fields despite TypeScript number compatibility.',
  before: objectDoc({ id: { type: 'string' } }),
  after: objectDoc({ id: { type: 'string' }, count: { type: 'integer' } }, ['id', 'count']),
  files: {
    '/sdk.ts': 'export interface Input { id: string } export function submit(input: Input) { return input.id; }',
    '/consumer.ts': 'import { submit } from "./sdk.js"; export const result = submit({ id: "1" });',
  },
  bindings: { operations: bindings.operations, schemas: { Input: { file: '/sdk.ts', export: 'Input', defaults: { count: 1.5 } } } },
  expected: { status: 'blocked', reason: 'Configured default for count must be an integer' },
});

corpus.push({
  id: 'multiple-configured-fields',
  description: 'Insert multiple required values without treating prior generated keys as ambiguous.',
  before: objectDoc({ id: { type: 'string' } }),
  after: objectDoc({ id: { type: 'string' }, region: { type: 'string' }, zone: { type: 'string' } }, ['id', 'region', 'zone']),
  files: {
    '/sdk.ts': 'export interface Input { id: string } export function submit(input: Input) { return JSON.stringify(input); }',
    '/consumer.ts': 'import { submit } from "./sdk.js"; export const result = submit({ id: "1" });',
  },
  bindings: { operations: bindings.operations, schemas: { Input: { file: '/sdk.ts', export: 'Input', defaults: { region: 'eu', zone: 'blue' } } } },
  expected: { status: 'verified', before: '{"id":"1"}', after: '{"id":"1","region":"eu","zone":"blue"}' },
});
