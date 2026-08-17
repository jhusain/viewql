import { readFile } from "node:fs/promises";
import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  Source,
  type GraphQLSchema,
  type IntrospectionQuery,
} from "graphql";

export type SchemaSource =
  | { readonly kind: "schema"; readonly schema: GraphQLSchema }
  | { readonly kind: "sdl"; readonly sdl: string; readonly sourceName?: string }
  | { readonly kind: "sdlFile"; readonly path: string }
  | { readonly kind: "introspection"; readonly result: unknown }
  | { readonly kind: "introspectionFile"; readonly path: string }
  | { readonly kind: "url"; readonly url: string; readonly headers?: Readonly<Record<string, string>> };

function introspectionData(value: unknown): IntrospectionQuery {
  if (typeof value !== "object" || value === null) throw new TypeError("Introspection JSON must be an object.");
  const result = value as { data?: unknown; errors?: unknown; __schema?: unknown };
  if (result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length > 0)) {
    throw new TypeError(`Introspection response contains errors: ${JSON.stringify(result.errors)}`);
  }
  const data = result.data ?? result;
  if (typeof data !== "object" || data === null || !("__schema" in data)) {
    throw new TypeError("Introspection JSON must contain a data.__schema or __schema property.");
  }
  return data as IntrospectionQuery;
}

/** Loads every supported source through the common GraphQLSchema boundary. */
export async function loadSchema(source: SchemaSource): Promise<GraphQLSchema> {
  switch (source.kind) {
    case "schema": return source.schema;
    case "sdl": return buildSchema(source.sourceName === undefined ? source.sdl : new Source(source.sdl, source.sourceName));
    case "sdlFile": return buildSchema(await readFile(source.path, "utf8"));
    case "introspection": return buildClientSchema(introspectionData(source.result));
    case "introspectionFile": {
      let parsed: unknown;
      try { parsed = JSON.parse(await readFile(source.path, "utf8")); }
      catch (error) { throw new TypeError(`Could not parse introspection JSON at ${source.path}: ${error instanceof Error ? error.message : String(error)}`); }
      return buildClientSchema(introspectionData(parsed));
    }
    case "url": {
      const response = await fetch(source.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...source.headers },
        body: JSON.stringify({ query: getIntrospectionQuery({ specifiedByUrl: true, directiveIsRepeatable: true, schemaDescription: true, inputValueDeprecation: true, oneOf: true }) }),
      });
      if (!response.ok) throw new Error(`Schema introspection at ${source.url} failed with HTTP ${response.status} ${response.statusText}.`);
      return buildClientSchema(introspectionData(await response.json()));
    }
  }
}

/** Selects SDL or introspection JSON based on a local file's extension. */
export function loadSchemaFile(path: string): Promise<GraphQLSchema> {
  if (/\.(?:graphql|graphqls|gql)$/i.test(path)) return loadSchema({ kind: "sdlFile", path });
  if (/\.json$/i.test(path)) return loadSchema({ kind: "introspectionFile", path });
  throw new TypeError(`Unsupported schema file extension for ${path}; expected .graphql, .graphqls, .gql, or .json.`);
}
