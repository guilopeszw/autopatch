import { Project, ts } from 'ts-morph';
import { expect, test } from 'vitest';
import { repairCallSites, type RepairRequest } from '../src/core/agent/llm-fixer.js';

function setup() {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const source = project.createSourceFile('/consumer.ts', `
    const secret = 'never-send-the-file';
    function submit(input: { count: number }): void {}
    submit({ count: "3" });
  `);
  const call = source.getFirstDescendantByKindOrThrow(ts.SyntaxKind.CallExpression);
  return { project, source, call };
}

const changes = [{ kind: 'property-updated' as const, schema: 'Input', property: 'count',
  before: { schema: { type: 'string' }, required: true }, after: { schema: { type: 'number' }, required: true } }];

test('retries an invalid repair using only the affected call and diff, then accepts a zero-error candidate', async () => {
  const { project, call } = setup();
  const requests: RepairRequest[] = [];
  const result = await repairCallSites(project, [call], changes, async (request) => {
    requests.push(request);
    return requests.length === 1 ? 'submit({ count: "wrong" })' : 'submit({ count: 3 })';
  }, { maxAttempts: 2 });
  expect(result.success).toBe(true);
  expect(result.attempts).toBe(2);
  expect(requests).toEqual([
    { snippet: 'submit({ count: "3" })', changes },
    { snippet: 'submit({ count: "3" })', changes },
  ]);
});

test.each(['0', 'submit({ count: "3" } as any)', 'submit({ count: "3" } as never)', 'submit({ count: 3 }) // @ts-nocheck'])('rejects output that escapes the call boundary or bypasses type checking: %s', async (replacement) => {
  const { project, source, call } = setup();
  const original = source.getFullText();
  const result = await repairCallSites(project, [call], changes, async () => replacement, { maxAttempts: 1 });
  expect(result.success).toBe(false);
  expect(source.getFullText()).toBe(original);
});
