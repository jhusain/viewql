import {
  type GraphQLArgument,
  type GraphQLEnumType,
  type GraphQLField,
  type GraphQLInputField,
  type GraphQLInputObjectType,
  type GraphQLInterfaceType,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type GraphQLUnionType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from "graphql";

export interface GeneratorOptions {
  readonly specModule?: string;
  readonly scalarMappings?: Readonly<Record<string, string>>;
  readonly unmappedCustomScalar?: "unknown" | "error";
  readonly header?: string | false;
}

const BUILTIN_SCALARS: Readonly<Record<string, string>> = {
  ID: "GraphQLSpec.ID",
  Int: "GraphQLSpec.Int",
  Float: "GraphQLSpec.Float",
  String: "GraphQLSpec.String",
  Boolean: "GraphQLSpec.Boolean",
};

function compareNames(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function sortedByName<T extends { readonly name: string }>(values: Iterable<T>): T[] {
  return Array.from(values).sort(compareNames);
}

function isNullable(type: GraphQLType): boolean {
  return !isNonNullType(type);
}

function emitter(options: GeneratorOptions) {
  const mappings = { ...BUILTIN_SCALARS, ...options.scalarMappings };
  const named = (name: string): string => mappings[name] ?? name;
  const typeRef = (type: GraphQLType, nullable = true): string => {
    if (isNonNullType(type)) return typeRef(type.ofType, false);
    const base = isListType(type)
      ? `ReadonlyArray<${typeRef(type.ofType)}>`
      : named(type.name);
    return nullable ? `${base} | null` : base;
  };
  const property = (name: string): string =>
    /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name);
  const args = (values: readonly GraphQLArgument[]): string =>
    values.length === 0
      ? ""
      : `args: {\n${sortedByName(values)
          .map(
            (arg) =>
              `    readonly ${property(arg.name)}${isNullable(arg.type) || arg.defaultValue !== undefined ? "?" : ""}: ${typeRef(arg.type)};`,
          )
          .join("\n")}\n  }`;
  return { typeRef, property, args };
}

function emitFields(
  fields: Iterable<GraphQLField<unknown, unknown>>,
  options: GeneratorOptions,
): string {
  const out = emitter(options);
  return sortedByName(fields)
    .map(
      (field) =>
        `  ${out.property(field.name)}(${out.args(field.args)}): ${out.typeRef(field.type)};`,
    )
    .join("\n");
}

function emitInputField(field: GraphQLInputField, options: GeneratorOptions): string {
  const out = emitter(options);
  return `readonly ${out.property(field.name)}${isNullable(field.type) || field.defaultValue !== undefined ? "?" : ""}: ${out.typeRef(field.type)};`;
}

function emitInputObject(type: GraphQLInputObjectType, options: GeneratorOptions): string {
  const out = emitter(options);
  const fields = sortedByName(Object.values(type.getFields()));
  if (type.isOneOf) {
    if (fields.length === 0) return `export type ${type.name} = never;`;
    const variants = fields
      .map(
        (selected) =>
          `  | {\n${fields
            .map((field) =>
              field === selected
                ? `      readonly ${out.property(field.name)}: ${out.typeRef(field.type, false)};`
                : `      readonly ${out.property(field.name)}?: never;`,
            )
            .join("\n")}\n    }`,
      )
      .join("\n");
    return `export type ${type.name} =\n${variants};`;
  }
  return `export type ${type.name} = {\n${fields
    .map((field) => `  ${emitInputField(field, options)}`)
    .join("\n")}\n};`;
}

function emitInterface(type: GraphQLInterfaceType, options: GeneratorOptions): string {
  const bases = [
    ...sortedByName(type.getInterfaces()).map(({ name }) => name),
    "GraphQLSpec.Interface",
  ];
  const fields = emitFields(Object.values(type.getFields()), options);
  return `export interface ${type.name} extends ${bases.join(", ")} {\n${fields}\n}\n\nexport declare const ${type.name}: GraphQLSpec.GraphQLType<${type.name}>;`;
}

function emitObject(
  type: GraphQLObjectType,
  schema: GraphQLSchema,
  options: GeneratorOptions,
): string {
  const marker = schema.getQueryType() === type ? "GraphQLSpec.Query" : "GraphQLSpec.Obj";
  const bases = [
    ...sortedByName(type.getInterfaces()).map(({ name }) => name),
    marker,
  ];
  const fields = emitFields(Object.values(type.getFields()), options);
  return `export interface ${type.name} extends ${bases.join(", ")} {\n${fields}\n}\n\nexport declare const ${type.name}: GraphQLSpec.GraphQLType<${type.name}>;`;
}

function emitEnum(type: GraphQLEnumType): string {
  return `export type ${type.name} =\n${sortedByName(type.getValues())
    .map(({ name }) => `  | ${JSON.stringify(name)}`)
    .join("\n")};`;
}

function emitUnion(type: GraphQLUnionType): string {
  const members = sortedByName(type.getTypes()).map(({ name }) => name);
  return `export type ${type.name} = ${members.length === 0 ? "never" : members.join(" | ")};\n\nexport declare const ${type.name}: GraphQLSpec.GraphQLType<${type.name}>;`;
}

function emitNamedType(
  type: GraphQLNamedType,
  schema: GraphQLSchema,
  options: GeneratorOptions,
): string {
  if (isScalarType(type)) {
    if (type.name in BUILTIN_SCALARS) return "";
    const mapping = options.scalarMappings?.[type.name];
    if (mapping === undefined && options.unmappedCustomScalar === "error") {
      throw new TypeError(`Custom scalar ${type.name} has no TypeScript mapping.`);
    }
    return `export type ${type.name} = ${mapping ?? "unknown"};`;
  }
  if (isEnumType(type)) return emitEnum(type);
  if (isUnionType(type)) return emitUnion(type);
  if (isInputObjectType(type)) return emitInputObject(type, options);
  if (isInterfaceType(type)) return emitInterface(type, options);
  if (isObjectType(type)) return emitObject(type, schema, options);
  return "";
}

/** Deterministically emits a dependency-free (except @viewql/spec) TypeScript facade. */
export function emitViewQLSchema(
  schema: GraphQLSchema,
  options: GeneratorOptions = {},
): string {
  const header =
    options.header === false
      ? ""
      : `${options.header ?? "// Generated by @viewql/schema. Do not edit."}\n\n`;
  const types = Object.values(schema.getTypeMap()).filter(
    (type) => !type.name.startsWith("__"),
  );
  const body = sortedByName(types)
    .map((type) => emitNamedType(type, schema, options))
    .filter(Boolean)
    .join("\n\n");
  return `${header}import * as GraphQLSpec from ${JSON.stringify(options.specModule ?? "@viewql/spec")};\n\n${body}\n`;
}
