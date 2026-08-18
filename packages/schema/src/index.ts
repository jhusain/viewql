import type { GraphQLSchema } from "graphql";
import { emitViewQLSchema, type GeneratorOptions } from "./emitter.js";
import { loadSchema, type SchemaSource } from "./loader.js";

export * from "./emitter.js";
export * from "./loader.js";

/** Generates a ViewQL facade from an already constructed GraphQL.js schema. */
export function generateViewQLSchema(schema: GraphQLSchema, options: GeneratorOptions = {}): string {
  return emitViewQLSchema(schema, options);
}

/** Loads, normalizes, and generates a schema facade in one call. */
export async function compileSchema(source: SchemaSource, options: GeneratorOptions = {}): Promise<string> {
  return generateViewQLSchema(await loadSchema(source), options);
}
