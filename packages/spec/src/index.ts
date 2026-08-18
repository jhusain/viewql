/**
 * A GraphQL `ID` scalar.
 *
 * IDs are strings at application runtime, but the brand prevents an arbitrary
 * string from being used where a generated schema requires an ID.
 */
export type ID = string & {
  readonly __graphqlID: unique symbol;
};

/** Explicitly converts an application string to a GraphQL `ID`. */
export function toID(value: string): ID {
  return value as ID;
}

/** A GraphQL `Int` scalar, distinct from other JavaScript numbers. */
export type Int = number & {
  readonly __graphqlInt: unique symbol;
};

/**
 * Converts an integral JavaScript number to a GraphQL `Int`.
 *
 * This helper checks the invariant represented by the brand. Range and input
 * coercion remain the responsibility of the selected GraphQL client.
 */
export function toInt(value: number): Int {
  if (!Number.isInteger(value)) {
    throw new TypeError("GraphQL Int must be an integer");
  }

  return value as Int;
}

/** The GraphQL `Float` scalar's TypeScript representation. */
export type Float = number;

/** The GraphQL `String` scalar's TypeScript representation. */
export type String = string;

/** The GraphQL `Boolean` scalar's TypeScript representation. */
export type Boolean = boolean;

/** Marker inherited by generated GraphQL object types. */
export interface Obj {}

/** Marker inherited by the generated schema's query root object. */
export interface Query extends Obj {}

/** Marker inherited by generated schema container types. */
export interface Schema {}
