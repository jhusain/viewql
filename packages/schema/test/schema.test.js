import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { graphql, getIntrospectionQuery } from "graphql";
import {
  compileSchema,
  createSchemaIR,
  generateViewQLSchema,
  loadSchema,
  loadSchemaFile,
} from "../dist/index.js";

const SDL = `
  scalar DateTime @specifiedBy(url: "https://example.test/date-time")
  enum Role { ADMIN USER @deprecated(reason: "legacy") }
  interface Node { id: ID! }
  interface Named implements Node { id: ID!, name: String! }
  type User implements Node & Named { id: ID!, name: String!, friends: [User] }
  union SearchResult = User
  input Filter { term: String, limit: Int! = 10 }
  input Selector @oneOf { id: ID, name: String }
  type Query { user(id: ID!, filter: Filter): User, search: [SearchResult!]! }
`;

test("normalizes SDL into a source-independent schema IR", async () => {
  const schema = await loadSchema({ kind: "sdl", sdl: SDL });
  const ir = createSchemaIR(schema);
  const named = ir.types.find((type) => type.name === "Named");
  const query = ir.types.find((type) => type.name === "Query");

  assert.deepEqual(named.interfaces, ["Node"]);
  assert.equal(query.rootKind, "query");
  assert.equal(query.fields[0].args[0].type.kind, "nonNull");
});

test("emits spec-backed facade types with exact nullability and inputs", async () => {
  const output = await compileSchema(
    { kind: "sdl", sdl: SDL },
    { scalarMappings: { DateTime: "string" } },
  );

  assert.match(output, /import \* as GraphQLSpec from "@viewql\/spec";/);
  assert.match(output, /export interface Named extends Node, GraphQLSpec\.Interface/);
  assert.match(output, /friends\(\): ReadonlyArray<User \| null> \| null;/);
  assert.match(output, /search\(\): ReadonlyArray<SearchResult>;/);
  assert.match(output, /readonly limit\?: GraphQLSpec\.Int;/);
  assert.match(output, /readonly id: GraphQLSpec\.ID;\n      readonly name\?: never;/);
  assert.match(output, /export declare const User: GraphQLSpec\.GraphQLType<User>;/);
  assert.doesNotMatch(output, /\bany\b/);
});

test("loads local SDL and introspection JSON through the same boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viewql-schema-"));
  const sdlPath = join(directory, "schema.graphql");
  const jsonPath = join(directory, "schema.json");
  await writeFile(sdlPath, SDL);

  const serverSchema = await loadSchemaFile(sdlPath);
  const result = await graphql({ schema: serverSchema, source: getIntrospectionQuery({ oneOf: true }) });
  await writeFile(jsonPath, JSON.stringify(result));
  const clientSchema = await loadSchemaFile(jsonPath);

  assert.equal(generateViewQLSchema(clientSchema), generateViewQLSchema(serverSchema));
});

test("rejects malformed introspection input and missing scalar mappings when requested", async () => {
  await assert.rejects(
    loadSchema({ kind: "introspection", result: { data: {} } }),
    /data\.__schema or __schema/,
  );
  const schema = await loadSchema({ kind: "sdl", sdl: "scalar Secret\ntype Query { secret: Secret }" });
  assert.throws(
    () => generateViewQLSchema(schema, { unmappedCustomScalar: "error" }),
    /Custom scalar Secret has no TypeScript mapping/,
  );
});
