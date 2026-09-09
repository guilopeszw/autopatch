import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { diffOpenApi } from "../src/core/diff/openapi-differ.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/${name}`, "utf8"));

test("uses route identity and explicit property provenance to plan deterministic renames", () => {
  expect(diffOpenApi(fixture("openapi-v1.json"), fixture("openapi-v2.json"))).toEqual([
    { kind: "operation-renamed", method: "post", path: "/users", from: "createUser", to: "registerUser" },
    { kind: "property-renamed", schema: "CreateUser", from: "name", to: "displayName" },
  ]);
});

const document = (schema: Record<string, unknown>) => ({
  openapi: "3.1.0", info: { title: "Test", version: "1" }, paths: {},
  components: { schemas: { Input: schema } },
});

test("reports requiredness, type, addition and removal changes instead of guessing a rename", () => {
  expect(diffOpenApi(
    document({ type: "object", properties: { count: { type: "string" }, old: { type: "boolean" } } }),
    document({ type: "object", required: ["count"], properties: { count: { type: "number" }, next: { type: "boolean" } } }),
  )).toEqual([
    { kind: "property-updated", schema: "Input", property: "count", before: { schema: { type: "string" }, required: false }, after: { schema: { type: "number" }, required: true } },
    { kind: "property-updated", schema: "Input", property: "next", after: { schema: { type: "boolean" }, required: false } },
    { kind: "property-updated", schema: "Input", property: "old", before: { schema: { type: "boolean" }, required: false } },
  ]);
});

test.each([
  { paths: {} },
  { servers: [{ url: "https://new.example.test" }] },
  { components: { schemas: { CreateUser: { allOf: [{ $ref: "#/components/schemas/Base" }] } } } },
])("blocks contract changes that have no supported codemod: %j", (change) => {
  const before = fixture("openapi-v1.json") as Record<string, unknown>;
  const changes = diffOpenApi(before, { ...before, ...change });
  expect(changes).toContainEqual(expect.objectContaining({ kind: "unsupported" }));
});

test("rejects ambiguous property rename hints instead of merging two fields", () => {
  expect(() => diffOpenApi(
    document({ type: "object", properties: { name: { type: "string" }, label: { type: "string" } } }),
    document({ type: "object", properties: { label: { type: "string", "x-autopatch-previous-name": "name" } } }),
  )).toThrow(/ambiguous/i);
});

test("treats explicit default additionalProperties as unchanged while retaining actual constraints", () => {
  const before = document({ type: "object", properties: { status: { type: "string" } } });
  const explicitDefault = document({ type: "object", additionalProperties: true, properties: { status: { type: "string" } } });
  expect(diffOpenApi(before, explicitDefault)).toEqual([]);
  expect(diffOpenApi(explicitDefault, before)).toEqual([]);
  expect(diffOpenApi(before, document({ type: "object", additionalProperties: false, properties: { status: { type: "string" } } })))
    .toEqual([expect.objectContaining({ kind: "unsupported", location: "Input" })]);
});
