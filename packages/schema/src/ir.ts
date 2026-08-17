import {
  type GraphQLArgument,
  type GraphQLFieldMap,
  type GraphQLInputField,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from "graphql";

export type SchemaTypeRef =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "list"; readonly ofType: SchemaTypeRef }
  | { readonly kind: "nonNull"; readonly ofType: SchemaTypeRef };

export interface SchemaArgument {
  readonly name: string;
  readonly type: SchemaTypeRef;
  readonly hasDefault: boolean;
  readonly deprecationReason?: string;
}

export interface SchemaField {
  readonly name: string;
  readonly type: SchemaTypeRef;
  readonly args: readonly SchemaArgument[];
  readonly deprecationReason?: string;
}

export interface SchemaObject {
  readonly kind: "object";
  readonly name: string;
  readonly interfaces: readonly string[];
  readonly fields: readonly SchemaField[];
  readonly rootKind?: "query" | "mutation" | "subscription";
}

export interface SchemaInterface {
  readonly kind: "interface";
  readonly name: string;
  readonly interfaces: readonly string[];
  readonly fields: readonly SchemaField[];
}

export interface SchemaInputObject {
  readonly kind: "inputObject";
  readonly name: string;
  readonly isOneOf: boolean;
  readonly fields: readonly SchemaArgument[];
}

export interface SchemaEnum {
  readonly kind: "enum";
  readonly name: string;
  readonly values: readonly { readonly name: string; readonly deprecationReason?: string }[];
}

export interface SchemaScalar {
  readonly kind: "scalar";
  readonly name: string;
  readonly specifiedByURL?: string;
}

export interface SchemaUnion {
  readonly kind: "union";
  readonly name: string;
  readonly members: readonly string[];
}

export type SchemaNamedType =
  | SchemaObject
  | SchemaInterface
  | SchemaInputObject
  | SchemaEnum
  | SchemaScalar
  | SchemaUnion;

export interface ViewQLSchema {
  readonly types: readonly SchemaNamedType[];
}

function optional<T extends object, K extends string, V>(key: K, value: V | undefined): T | Record<K, V> {
  return value === undefined ? ({} as T) : ({ [key]: value } as Record<K, V>);
}

export function createTypeRef(type: GraphQLType): SchemaTypeRef {
  if (isNonNullType(type)) return { kind: "nonNull", ofType: createTypeRef(type.ofType) };
  if (isListType(type)) return { kind: "list", ofType: createTypeRef(type.ofType) };
  return { kind: "named", name: type.name };
}

function argumentsOf(values: readonly (GraphQLArgument | GraphQLInputField)[]): SchemaArgument[] {
  return values.map((value) => ({
    name: value.name,
    type: createTypeRef(value.type),
    hasDefault: value.defaultValue !== undefined,
    ...optional("deprecationReason", value.deprecationReason ?? undefined),
  }));
}

function fieldsOf(type: { getFields(): GraphQLFieldMap<unknown, unknown> }): SchemaField[] {
  return Object.values(type.getFields()).map((field) => ({
    name: field.name,
    type: createTypeRef(field.type),
    args: argumentsOf(field.args),
    ...optional("deprecationReason", field.deprecationReason ?? undefined),
  }));
}

function convertType(type: GraphQLNamedType, schema: GraphQLSchema): SchemaNamedType | undefined {
  if (type.name.startsWith("__")) return undefined;
  if (isObjectType(type)) {
    const rootKind: SchemaObject["rootKind"] = schema.getQueryType() === type ? "query"
      : schema.getMutationType() === type ? "mutation"
      : schema.getSubscriptionType() === type ? "subscription" : undefined;
    return {
      kind: "object", name: type.name,
      interfaces: type.getInterfaces().map(({ name }) => name), fields: fieldsOf(type),
      ...optional("rootKind", rootKind),
    };
  }
  if (isInterfaceType(type)) return { kind: "interface", name: type.name, interfaces: type.getInterfaces().map(({ name }) => name), fields: fieldsOf(type) };
  if (isInputObjectType(type)) return { kind: "inputObject", name: type.name, isOneOf: type.isOneOf, fields: argumentsOf(Object.values(type.getFields())) };
  if (isEnumType(type)) return { kind: "enum", name: type.name, values: type.getValues().map((value) => ({ name: value.name, ...optional("deprecationReason", value.deprecationReason ?? undefined) })) };
  if (isScalarType(type)) return { kind: "scalar", name: type.name, ...optional("specifiedByURL", type.specifiedByURL ?? undefined) };
  if (isUnionType(type)) return { kind: "union", name: type.name, members: type.getTypes().map(({ name }) => name) };
  return undefined;
}

/** Converts GraphQL.js's schema model into the stable, emitter-independent ViewQL IR. */
export function createSchemaIR(schema: GraphQLSchema): ViewQLSchema {
  const types = Object.values(schema.getTypeMap())
    .map((type) => convertType(type, schema))
    .filter((type): type is SchemaNamedType => type !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { types };
}
