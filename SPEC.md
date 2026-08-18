# ViewQL Architecture and Design Notes

> Status: design-stage architecture document
> Audience: contributors and coding agents implementing ViewQL
> Primary target: React applications using Relay
> Planned secondary target: Apollo Client

---

# 1. Overview

ViewQL is a React-first GraphQL compiler that derives GraphQL operations and fragments from ordinary TypeScript/React component code.

The core premise is:

> **The view is the query.**

A developer should not need to separately declare:

1. which GraphQL fields a component needs;
2. which fragment arguments are required;
3. which fields can be conditionally included or skipped;
4. which GraphQL type refinements correspond to TypeScript control flow;
5. which fragment spreads should be deferred.

Instead, ViewQL analyzes ordinary strongly typed TypeScript/React source and derives those GraphQL semantics.

The intended developer workflow is approximately:

```tsx
const PersonView =
  defineFragmentView<
    Schema.Person,
    "person",
    PersonViewProps
  >(({ person, showFriends }) => {
    if (Schema.isCustomer(person)) {
      // ...
    }

    return (
      <>
        {person.name()}

        {showFriends && (
          <Defer fallback={<Loading />}>
            <FriendList person={person} />
          </Defer>
        )}
      </>
    );
  });
```

ViewQL analyzes this code and derives the appropriate GraphQL fragment, fragment arguments, type refinements, conditional directives, fragment spreads, and deferred delivery.

The generated schema types used by the developer are temporary compiler-facing abstractions. They do not represent final runtime application data.

After GraphQL-client compilation, ViewQL rewrites components against the client's generated fragment models.

---

# 2. Primary goals

ViewQL is intended to deliver four major benefits.

## 2.1 Eliminate duplicated data declarations

Traditional fragment colocation still requires expressing the same requirement twice:

```graphql
fragment PersonView on Person {
  name
}
```

and:

```tsx
return <div>{person.name}</div>;
```

ViewQL makes the component access itself authoritative:

```tsx
return <div>{person.name()}</div>;
```

From that single expression, the compiler derives:

```graphql
fragment PersonView on Person {
  name
}
```

---

## 2.2 Strong typing before operation generation

Traditional GraphQL code generation often requires the GraphQL operation or fragment to exist before generated result types are available.

ViewQL instead generates a TypeScript façade directly from the GraphQL schema.

For example:

```ts
type Person = Customer | Employee;

declare function isPerson(
  value: GraphQLSpec.Obj | null | undefined
): value is Person;

interface Customer extends GraphQLSpec.Obj {
  readonly __typename: "Customer";
  id(): GraphQLSpec.ID;
  name(): string;
  friends(): ReadonlyArray<Person>;
}

declare function isCustomer(
  value: GraphQLSpec.Obj | null | undefined
): value is Customer;
```

A developer therefore immediately receives:

* autocomplete;
* nullability checking;
* argument checking;
* GraphQL input type checking;
* schema type checking;

while writing the React component, without first authoring a fragment and waiting for operation code generation.

---

## 2.3 Automatically request only used data

ViewQL identifies GraphQL field accesses through ordinary method calls:

```ts
person.name();
```

means:

```graphql
name
```

while:

```ts
query.person({ id });
```

means:

```graphql
person(id: $id)
```

If a field is never accessed by reachable analyzed code, it is not selected.

---

## 2.4 Derive GraphQL execution optimizations from control flow

ViewQL should use TypeScript control-flow analysis to determine when selections can be conditionally omitted.

For example:

```tsx
if (showFriends) {
  return <FriendList person={person} />;
}
```

may imply:

```graphql
... @include(if: $showFriends) {
  ...FriendList
}
```

provided `showFriends` can be represented as a GraphQL variable or fragment argument.

The runtime TypeScript check remains.

The GraphQL directive is an optimization derived from the same condition.

The developer does not repeat the condition in GraphQL.

---

# 3. Architectural assumptions

Several architectural assumptions are intentional.

## 3.1 React is fundamental

ViewQL is not intended to be UI-framework-neutral.

The compiler may understand React-specific concepts including:

* JSX;
* React component boundaries;
* props;
* closures;
* event handlers;
* `useState`;
* `useReducer`;
* `useRef`;
* Context;
* Suspense;
* component composition.

React's declarative rendering model is part of ViewQL's design.

There is therefore no current need for a separate React-specific ViewQL package or framework abstraction.

---

## 3.2 GraphQL clients should be replaceable

Relay is the first and primary GraphQL-client backend.

Apollo Client support is planned.

The core compiler should therefore represent GraphQL/view semantics in a client-independent IR wherever practical, while client-specific backends handle:

* fragment model representation;
* fragment reading;
* generated GraphQL-client code;
* GraphQL-client compiler invocation;
* Suspense integration details;
* client-specific directives or conventions.

The core compiler should understand:

```text
type refinement
conditional selection
fragment spread
deferred fragment spread
operation variable
fragment argument
```

rather than encoding Relay-specific concepts prematurely.

---

# 4. Repository structure

ViewQL should use a single monorepo with multiple packages.

The components are tightly coupled enough that changes frequently need to be atomic across:

* schema representation;
* schema generation;
* compiler analysis;
* runtime APIs;
* Relay lowering;
* future Apollo lowering;
* tests.

A monorepo allows one commit and one CI run to validate all coordinated changes.

A suggested package layout is:

```text
viewql/
  packages/
    spec/
      @viewql/spec

    runtime/
      @viewql/runtime

    schema/
      @viewql/schema

    compiler/
      @viewql/compiler

    relay/
      @viewql/relay

    apollo/
      @viewql/apollo        # planned

    cli/
      viewql

  tests/
    fixtures/
    compiler/
    integration/

  examples/
```

Exact package boundaries may evolve, but architectural dependency boundaries should remain clear.

Initially, packages may use lockstep versioning to avoid difficult compatibility matrices during rapid development.

---

# 5. GraphQLSpec.ts

`GraphQLSpec.ts` contains schema-independent TypeScript definitions representing GraphQL concepts.

Ordinary TypeScript methods and ordinary control flow are now preferred.

A representative subset is:

```ts
export type ID = string & {
  readonly __graphqlID: unique symbol;
};

export function toID(value: string): ID {
  return value as ID;
}

export type Int = number & {
  readonly __graphqlInt: unique symbol;
};

export function toInt(value: number): Int {
  if (!Number.isInteger(value)) {
    throw new TypeError("GraphQL Int must be an integer");
  }

  return value as Int;
}

export type Float = number;
export type String = string;
export type Boolean = boolean;

export interface Obj {}

export interface Query extends Obj {}

export interface Schema {}

export type QueryDefinition<
  TProps extends object
> = React.ComponentType<TProps>;

export type FragmentDefinition<
  K extends string,
  TFragment extends Obj,
  TProps extends object
> = React.ComponentType<
  TProps & {
    [P in K]: TFragment;
  }
>;
```

The precise placement of React-facing aliases may ultimately belong in `@viewql/runtime` rather than `@viewql/spec`.

The important principle is that GraphQL schema types are represented using normal TypeScript method signatures.

---

# 6. Generated schema façade

The schema compiler generates TypeScript interfaces from the GraphQL schema.

The generated schema has:

* no React dependency;
* no Relay dependency;
* no Apollo dependency;
* no `defineQueryView`;
* no `defineFragmentView`.

Example:

```ts
import * as GraphQLSpec from "@viewql/spec";

export type Person = Customer | Employee;

export declare function isPerson(
  value: GraphQLSpec.Obj | null | undefined
): value is Person;

export interface Customer
  extends GraphQLSpec.Obj {
  readonly __typename: "Customer";
  id(): GraphQLSpec.ID;
  name(): string;
  friends(): ReadonlyArray<Person>;
  customerId(): string;
}

export declare function isCustomer(
  value: GraphQLSpec.Obj | null | undefined
): value is Customer;

export interface Employee
  extends GraphQLSpec.Obj {
  readonly __typename: "Employee";
  id(): GraphQLSpec.ID;
  name(): string;
  friends(): ReadonlyArray<Person>;
  employeeId(): string;
}

export declare function isEmployee(
  value: GraphQLSpec.Obj | null | undefined
): value is Employee;

export interface Query
  extends GraphQLSpec.Query {
  readonly __typename: "Query";
  person(args: {
    id: GraphQLSpec.ID;
  }): Person | null;
}

export declare function isQuery(
  value: GraphQLSpec.Obj | null | undefined
): value is Query;
```

The schema façade exists only to:

* provide TypeScript typing;
* provide compiler-recognizable schema method calls;
* provide structural unions of concrete GraphQL object types;
* provide compiler-recognizable type predicates for objects and interfaces.

It should be removed or rendered irrelevant in final compiled application code.

---

# 7. GraphQL type narrowing

GraphQL objects are represented as structural TypeScript interfaces with a
literal `__typename` discriminator. GraphQL interfaces and unions are
represented as unions of their possible concrete object types.

Generated schema modules expose TypeScript type predicates for every concrete
object and GraphQL interface. Developers therefore narrow values without
writing `__typename` string literals:

```ts
if (Schema.isCustomer(person)) {
  // person narrows to Customer
}
```

The component compiler recognizes generated predicate symbols and emits the
corresponding GraphQL type refinement. It rewrites the predicate call to a test
against the client-generated fragment model.

Conceptually:

```ts
customerFragment != null
```

This is important because GraphQL type refinement is not equivalent to
JavaScript prototype inheritance.

GraphQL interfaces have no distinct JavaScript runtime representation. Their
generated predicates narrow the original source value to the union of concrete
objects that implement the interface:

```ts
if (Schema.isNamed(value)) {
  // value is narrowed to Schema.Named
}
```

Each predicate is a compiler-facing declaration. For an interface predicate,
the component compiler emits an inline fragment conditioned on that interface
and associates the guarded source value with the corresponding client fragment
model. Predicate calls must not survive into final runtime code.

This lowering naturally supports:

* GraphQL concrete object types through generated predicates;
* GraphQL interfaces through generated predicates;
* inherited interface/type relationships;

provided the GraphQL type condition is valid.

The schema compiler does not emit predicates for GraphQL unions: callers test
the desired concrete member with its object predicate. OneOf inputs likewise
use their exclusive field shapes and ordinary non-null field checks. Scalars,
enums, and ordinary input objects do not participate in output type refinement.

---

# 8. Schema type generation rules

The generated schema compiler should preserve GraphQL semantics carefully.

## 8.1 Output fields

GraphQL output fields become methods.

Example:

```graphql
type Person {
  name: String!
  manager: Person
}
```

becomes:

```ts
interface Person extends GraphQLSpec.Obj {
  name(): string;
  manager(): Person | null;
}
```

Fields with arguments become normal methods with an argument object:

```graphql
type Query {
  person(id: ID!): Person
}
```

becomes:

```ts
interface Query extends GraphQLSpec.Query {
  person(args: {
    id: GraphQLSpec.ID;
  }): Person | null;
}
```

---

## 8.2 Lists

GraphQL-returned lists should use readonly arrays:

```ts
ReadonlyArray<Person>
```

GraphQL nullability must be represented exactly.

Examples:

```graphql
[Person]
```

maps conceptually to:

```ts
ReadonlyArray<Person | null> | null
```

while:

```graphql
[Person!]!
```

maps to:

```ts
ReadonlyArray<Person>
```

---

## 8.3 Input objects

GraphQL input objects are real runtime values, unlike output schema façade objects.

They should therefore be generated as ordinary TypeScript object types.

Example:

```graphql
input SearchInput {
  required: String!
  optional: String
}
```

becomes approximately:

```ts
type SearchInput = {
  readonly required: string;
  readonly optional?: string | null;
};
```

Nullability and omission must remain distinct.

---

## 8.4 OneOf inputs

GraphQL OneOf input objects should use an exclusive TypeScript union where possible.

Example:

```graphql
input UserSelector @oneOf {
  email: String
  id: ID
}
```

could become:

```ts
type UserSelector =
  | {
      readonly email: string;
      readonly id?: never;
    }
  | {
      readonly email?: never;
      readonly id: GraphQLSpec.ID;
    };
```

The selected field is required and non-null while every unselected field is
optional `never`. Ordinary null checks therefore narrow the input at both
runtime and compile time:

```ts
if (selector.email != null) {
  // selector is the email variant
} else if (selector.id != null) {
  // selector is the ID variant
}
```

---

## 8.5 Custom scalars

ViewQL should avoid creating an independent scalar configuration mechanism if the chosen GraphQL backend already has one.

For Relay, the schema compiler should consume Relay's custom scalar type mappings.

The same configured TypeScript scalar type should appear in:

* ViewQL's generated schema façade;
* Relay-generated operation/fragment types.

Runtime serialization/deserialization of custom scalars is not inherently a ViewQL responsibility.

A custom scalar should not silently become `any`.

Prefer:

* configured type;
* `unknown`;
* or a schema compilation error.

---

# 9. View definition APIs

`defineQueryView` and `defineFragmentView` belong in `@viewql/runtime`, not in generated schema modules.

They are React concepts.

The compiler identifies module-level constant assignments whose call resolves to these exported symbols.

Recognition should use TypeScript symbol resolution, not textual callee names.

This should work:

```ts
import {
  defineQueryView as queryView
} from "@viewql/runtime";

const PersonQuery =
  queryView<Schema.Query, Props>(...);
```

An unrelated user function called `defineQueryView` must not be mistaken for ViewQL.

---

## 9.1 `defineQueryView`

Approximate source API:

```ts
defineQueryView<
  TQuery extends GraphQLSpec.Query,
  TProps extends object
>(
  view: (
    props: TProps & {
      query: TQuery;
    }
  ) => JSX.Element
)
```

The return type is assumed to be JSX/React output.

The developer should not need to provide a generic return type.

The callback receives a synthetic `query` value.

The resulting component does not expose `query` as a runtime prop.

Example:

```tsx
const PersonQuery =
  defineQueryView<
    Schema.Query,
    PersonQueryProps
  >(({ query, id }) => {
    const person =
      query.person({ id });

    // ...
  });
```

---

## 9.2 `defineFragmentView`

Approximate source API:

```ts
defineFragmentView<
  TFragment extends GraphQLSpec.Obj,
  K extends string,
  TProps extends object
>(
  view: (
    props:
      TProps &
      { [P in K]: TFragment }
  ) => JSX.Element
)
```

Example:

```tsx
const PersonView =
  defineFragmentView<
    Schema.Person,
    "person",
    PersonViewProps
  >(({ person, showFriends }) => {
    // ...
  });
```

The fragment prop remains part of the public component props.

---

# 10. Fragment naming

Named GraphQL fragments should use only the module-level const variable name corresponding to the explicit `defineFragmentView`.

For example:

```ts
const PersonView =
  defineFragmentView<...>(...);
```

generates:

```graphql
fragment PersonView on Person {
  ...
}
```

Do not append the fragment prop name.

Earlier names such as:

```text
PersonView_person
CustomerView_customer
```

were considered and rejected.

The fragment name should simply be:

```text
PersonView
CustomerView
EmployeeView
FriendList
```

This keeps fragment identity aligned directly with component identity.

The compiler must validate or otherwise disambiguate fragment-name collisions across modules.

A deterministic module-derived suffix or compile-time error may be needed if GraphQL's global fragment namespace produces collisions.

This collision policy remains an implementation decision.

---

# 11. Query naming

A module-level:

```ts
const PersonQuery =
  defineQueryView<...>(...);
```

generates:

```graphql
query PersonQuery(...) {
  ...
}
```

Module-level const identity is therefore important.

Calls to `defineQueryView` or `defineFragmentView` in unsupported contexts should produce descriptive compiler errors.

---

# 12. Core compiler pipeline

The component compiler should avoid repeated source traversal wherever possible.

The desired model is:

```text
typed TypeScript / TSX
       ↓
single semantic extraction walk
       ↓
ViewQL IR
       ↓
multiple cheap analyses
       ↓
solved ViewQL IR
       ↓
GraphQL-client backend
       ↓
generated GraphQL
       ↓
client compiler
       ↓
generated client types/artifacts
       ↓
ViewQL source rewrite
```

Logical compiler phases can remain modular without repeatedly walking original TypeScript source.

---

# 13. ViewQL intermediate representation

The initial TypeScript walk should construct a rich intermediate representation.

A view IR may contain:

```text
ViewIR PersonView

parameters:
  person
  showFriends

graphql values:
  person : Person

control flow:
  blocks
  edges
  predicates
  dominators

field selections:
  person.name
  person.friends

type refinements:
  person -> Customer
  person -> Employee

fragment-view edges:
  CustomerView(customer <- refined person)
  EmployeeView(employee <- refined person)
  FriendList(person <- person)

prop-flow edges:
  caller.showFriends -> PersonView.showFriends

defer regions:
  FriendList spread

closures:
  event handlers
  callbacks
  captured graphql values

storage effects:
  React state
  refs
  global/shared storage

unknown calls:
  external library boundaries
```

Each IR node should retain original source spans.

---

# 14. GraphQL-variable inference

Developers should not have to declare separately which React props are GraphQL variables or fragment arguments.

ViewQL should infer this automatically.

A prop becomes GraphQL-relevant when it flows to a GraphQL sink, such as:

* a GraphQL field argument;
* a condition controlling GraphQL selections;
* a child fragment prop that has itself been determined to require a GraphQL fragment argument.

Example:

```tsx
const Avatar =
  defineFragmentView<
    Schema.Person,
    "person",
    { size: number }
  >(({ person, size }) => (
    <img src={person.photo({ size })} />
  ));
```

Because `size` reaches a GraphQL field argument, `Avatar.size` becomes a fragment argument.

If:

```tsx
<PersonAvatar size={avatarSize} />
```

appears in a parent fragment view, `avatarSize` inherits that requirement.

This should propagate bottom-up through the view graph until reaching a query view.

The query-view prop then becomes an operation variable.

---

# 15. Variable inference as a fixed-point problem

This need not mean repeatedly parsing source.

Build constraints during the initial AST pass, then solve them using a worklist/fixed-point algorithm.

Example:

```text
photo(size)
    ↑
Avatar.size
    ↑
PersonDetail.avatarSize
    ↑
PersonQuery.imageSize
```

GraphQL-relevance is monotonic:

```text
ordinary prop
    ↓
GraphQL-relevant prop
```

A prop should not need to become non-GraphQL again.

This makes fixed-point solving straightforward and handles cycles naturally.

---

# 16. GraphQL input type inference

When a prop reaches a GraphQL field argument, ViewQL should also infer the GraphQL input type required at that sink.

Example:

```graphql
photo(size: Int!): String!
```

and:

```ts
person.photo({ size });
```

establish:

```text
size : GraphQL Int!
```

That requirement propagates through component props.

If one source prop flows to incompatible GraphQL positions, compilation should fail.

Example:

```ts
foo({ count: value });   // Int!
bar({ label: value });   // String!
```

should produce a clear incompatible GraphQL-variable-type error.

---

# 17. Flow analysis and conditional directives

Ordinary TypeScript control flow should drive `@include` and `@skip` where safe.

Example:

```tsx
if (showFriends) {
  return <FriendList person={person} />;
}
```

If `showFriends` can be promoted to a GraphQL variable, the fragment spread may receive:

```graphql
@include(if: $showFriends)
```

The original JavaScript branch remains.

The GraphQL directive only optimizes network execution.

---

# 18. Predicate representation

The IR should distinguish runtime predicates from GraphQL-liftable predicates.

Conceptually:

```text
Predicate
  runtimeExpression
  optional graphQLExpression
```

Example:

```text
showFriends
  runtime: showFriends
  graphql: $showFriends
```

can drive GraphQL conditional directives.

Example:

```text
window.innerWidth > 800
  runtime: expression
  graphql: none
```

cannot.

In that case, ViewQL should fetch the required fields eagerly rather than under-fetch.

Correctness takes priority over optimization.

---

# 19. Conditional-selection normalization

The IR should preserve source semantics.

The GraphQL emitter may normalize selection structure when semantics remain equivalent.

Example:

```ts
if (a) {
  person.name();
}

if (a) {
  person.id();
}
```

may emit:

```graphql
... @include(if: $a) {
  name
  id
}
```

rather than two conditional fragments.

Nested conditions may remain nested when GraphQL cannot directly represent the composed Boolean expression without introducing synthetic variables.

Example:

```ts
if (a) {
  if (b) {
    person.friends();
  }
}
```

can naturally emit:

```graphql
... @include(if: $a) {
  ... @include(if: $b) {
    friends
  }
}
```

The compiler should not routinely synthesize extra operation variables merely to flatten GraphQL syntax.

The design principle is:

> Normalize redundant structure, but do not invent runtime state simply to make emitted GraphQL cosmetically flatter.

---

# 20. Type refinement

Calls to generated object and interface type predicates should translate into
GraphQL type refinements.

Source:

```tsx
if (Schema.isCustomer(person)) {
  return (
    <CustomerView customer={person} />
  );
}
```

becomes conceptually:

```graphql
... on Customer @alias(as: "_viewql_customer") {
  ...CustomerView
}
```

Relay's aliased fragment model then allows the rewritten code to test:

```ts
customer != null
```

rather than executing the compiler-facing predicate at runtime.

An interface condition uses the same source pattern:

```tsx
if (Schema.isNamed(value)) {
  return <NamedView named={value} />;
}
```

This becomes an inline fragment on `Named`; the compiler associates `value`
inside the guarded region with the corresponding aliased fragment model.

All necessary refinement/null checking should occur in the parent view.

The child fragment view accepts a non-null correctly refined fragment reference.

---

# 21. Relay alias usage

For Relay, conditional fragment models should use `@alias` where required by Relay's fragment model semantics.

This includes cases involving:

* type-conditioned inline fragments;
* conditional fragments controlled by `@include`/`@skip`.

ViewQL should preferably use anonymous inline fragments plus aliases for these refinement/conditional regions.

Example:

```graphql
... on Customer
  @alias(as: "_viewql_customer") {
  ...CustomerView
}
```

A named fragment should not be invented merely for conditional structure.

---

# 22. Generated alias naming

Generated aliases should be:

* descriptive;
* deterministic;
* predictable for tests;
* unlikely to collide with user names.

GraphQL names beginning with `__` must not be used because that namespace is reserved.

A suggested convention is:

```text
_viewql_customer
_viewql_employee
_viewql_showFriends
```

Generated TypeScript locals can use a visually reserved-looking prefix such as:

```text
$viewql$customer
$viewql$employee
$viewql$personRef
```

Every insertion should go through a scope-aware deterministic symbol allocator.

If a developer has already used the preferred generated name, append a deterministic suffix:

```text
$viewql$employee$1
```

Source line numbers should not be used as identifiers because formatting changes should not rename compiler artifacts.

---

# 23. Preserve user symbol names

Generated code should preserve user-defined symbols wherever practical.

Generated implementation values receive ViewQL-prefixed names.

Example:

```tsx
function PersonView({
  person: $viewql$personRef,
}) {
  const person = useFragment(
    PersonViewFragment,
    $viewql$personRef
  );

  // ...
}
```

This is desirable because:

* `person` continues to mean the semantic data value the developer expects;
* debugger expressions remain understandable;
* generated code is readable even without source maps.

---

# 24. Multiple fragment-model identities for one source symbol

A single source GraphQL value may correspond to different client fragment models at different control-flow locations.

Example:

```ts
person.name();

if (Schema.isEmployee(person)) {
  person.employeeId();
}
```

Conceptually:

```text
person#0 : Person fragment model
person#1 : Employee refined fragment model
```

The compiler should represent fragment-model identity on value-flow versions, not merely source declarations.

Internally this resembles SSA.

Generated JavaScript may use lexical shadowing or ViewQL-prefixed locals so the runtime binding at a source location corresponds as closely as possible to the semantic source value.

---

# 25. Defer

`@defer` should be explicit.

ViewQL should **not** infer `@defer` merely from React `<Suspense>`.

A Suspense boundary might suspend because of:

* GraphQL data;
* code loading;
* another data source;
* unrelated asynchronous resources.

Therefore ViewQL provides a dedicated React component:

```tsx
<Defer fallback={<Loading />}>
  <FriendList person={person} />
</Defer>
```

---

# 26. Defer requires an explicit fragment view

Earlier designs considered:

```tsx
<Defer
  fallback={<Loading />}
  body={() => (
    ...
  )}
/>
```

with the compiler converting the closure into a generated fragment/component pair.

This was rejected.

Reasons:

* it introduces too much compiler magic;
* it implicitly turns an arbitrary closure into a React component;
* it creates surprising hook/state semantics;
* developers reasonably expect hooks to belong to explicit React component bodies.

The chosen model is:

```tsx
<Defer fallback={<Loading />}>
  <FriendList person={person} />
</Defer>
```

where `FriendList` is an explicit `defineFragmentView`.

---

# 27. Defer lowering for Relay

If:

```tsx
<Defer fallback={<Loading />}>
  <FriendList person={person} />
</Defer>
```

appears in a fragment view, the Relay backend emits:

```graphql
...FriendList @defer
```

The `FriendList` component calls Relay's fragment reader beneath the React Suspense boundary.

This means no synthetic fragment is necessary when the deferred child is already an explicit fragment view.

Earlier designs considered compiler-generated intermediary fragments for arbitrary deferred closures.

Those are no longer needed under the explicit-fragment-view rule.

---

# 28. Defer runtime component

`<Defer>` itself should remain as client-neutral as practical.

Conceptually:

```tsx
export function Defer({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  );
}
```

Client-specific fragment reading belongs in the rewritten fragment view, not preferably in `<Defer>`.

Relay naturally supports this because `useFragment` can suspend when required data is pending.

For Apollo, the backend may need a client-specific fragment-reading adapter that turns incomplete fragment data into Suspense behavior.

This is preferable to exposing different developer-facing `<Defer>` components per GraphQL client.

---

# 29. Fragment composition

A fragment view rendered from another fragment view should result in a named fragment spread.

Example:

```tsx
<CustomerView customer={person} />
```

corresponds to:

```graphql
...CustomerView
```

after whatever enclosing type refinement or alias is required.

Named fragments should generally correspond one-to-one with explicit calls to `defineFragmentView`.

---

# 30. Event handlers and closures

An earlier design treated GraphQL values captured by event-handler closures as escaping.

That was rejected as too restrictive.

This should be supported:

```tsx
<button
  onClick={() => {
    console.log(person.name());
  }}
>
  Show Name
</button>
```

ViewQL can analyze the closure body and include `name` in the owning fragment.

Likewise memoized handlers may close over GraphQL values if their behavior is analyzable.

The fundamental rule is no longer:

> GraphQL values may not outlive render.

Instead:

> GraphQL values may not enter unsupported persistent mutable storage or opaque code whose behavior cannot be determined.

---

# 31. Helper functions

GraphQL values may flow through ordinary helper functions if ViewQL has access to analyzable source and can account for their relevant behavior.

Example:

```ts
function displayName(
  person: Schema.Person
) {
  return person.name();
}
```

is valid.

A helper does not need to be a fragment view merely because it receives a GraphQL value.

---

# 32. Generic helpers

ViewQL should support generic helpers when their GraphQL-related behavior can be summarized without specializing the function into multiple variants.

Example:

```ts
function identity<T>(value: T): T {
  return value;
}
```

summary:

```text
return aliases arg0
```

Example:

```ts
function first<T>(
  values: readonly T[]
): T | undefined {
  return values[0];
}
```

summary:

```text
return is element of arg0
```

This requires no type-specific specialization.

The desired rule is:

> Parametric flow summaries are allowed; type-specialized cloning of generic helpers is not required.

A generic constrained to a concrete GraphQL schema type and performing GraphQL field accesses may be rejected if supporting it would require specialization.

---

# 33. Built-ins

Many JavaScript built-ins lack application source.

ViewQL should maintain trusted semantic summaries for supported built-ins.

Important examples:

* `Array.prototype.map`;
* `filter`;
* `reduce`;
* `find`;
* `findIndex`;
* `some`;
* `every`;
* `flatMap`;
* indexed access;
* destructuring;
* `for...of`.

Example summary for `map`:

```text
callback.arg0 = element(receiver)
result.element = callback.return
```

This permits ordinary collection transformations without treating GraphQL values as escapes.

Monkey-patching built-ins or replacing standard semantics is outside the supported model.

---

# 34. External and opaque functions

If a GraphQL value reaches code that ViewQL cannot analyze and for which no trusted summary exists, compilation must fail.

Example:

```ts
externalLibrary.process(person);
```

ViewQL cannot know whether the function:

* reads fields;
* stores the value;
* passes it elsewhere;
* mutates shared state.

This is an unsupported reference escape.

Earlier designs considered an explicit `select()` API as an escape hatch.

That API is no longer part of the initial design.

Instead, developers can simply extract primitive/plain structural values before passing them to opaque code:

```ts
externalLibrary.process({
  id: person.id(),
  name: person.name(),
});
```

If a more explicit escape API is later proven necessary, it can be added under YAGNI rather than preemptively.

---

# 35. Effect summaries

Helper analysis naturally resembles an effect system.

A function summary may record:

```text
Reads:
  arg0.name

Returns:
  aliases arg1

Stores:
  none

Calls:
  helperB

Persistent escapes:
  none
```

These summaries should become the unit of future incremental compilation.

---

# 36. React state is a prohibited GraphQL-object sink

GraphQL object/interface references must not be stored in React state.

Invalid:

```tsx
const [personState, setPersonState] =
  useState<Schema.Person | null>(null);

setPersonState(person);
```

Invalid:

```tsx
setState({
  selectedPerson: person,
});
```

Valid:

```tsx
setSelectedPersonId(person.id());
```

or:

```tsx
setState({
  id: person.id(),
  name: person.name(),
});
```

GraphQL primitives are ordinary application values and may be stored.

---

# 37. Detecting React state setters

There is no assumption that every state update goes through one globally exported `setState` symbol.

ViewQL should use provenance analysis.

For example:

```tsx
const [value, setValue] =
  useState(...);
```

records:

```text
setValue = persistent React state sink
```

Likewise:

```tsx
const [state, dispatch] =
  useReducer(...);
```

produces a state-update channel.

Calls into these channels containing GraphQL object/interface references should be rejected.

The compiler may conservatively reject GraphQL references in reducer actions even when a sophisticated reducer analysis could theoretically prove the reference is not retained.

Simplicity and predictability are preferred.

---

# 38. Other persistent storage

The same rule applies to other persistent mutable repositories.

Examples that should normally reject GraphQL object/interface references:

```ts
ref.current = person;
```

module-level caches:

```ts
cache.set(id, person);
```

global variables:

```ts
currentPerson = person;
```

application stores:

```ts
store.setState({ person });
```

unknown mutable repositories.

A local map, array, object, or WeakMap is not inherently unsafe if escape analysis proves that the storage itself remains within the analyzable lifetime and does not outlive the relevant region.

---

# 39. Local containers

This may be legal:

```ts
const cache = new WeakMap<object, Schema.Person>();

cache.set(key, person);

const cached = cache.get(key);

return cached?.name();
```

provided the compiler proves:

* `cache` does not escape;
* references stored within it do not escape;
* all uses remain analyzable.

Safety is based on escape reachability, not merely lexical syntax.

---

# 40. React Context

GraphQL object/interface references should generally not be placed in arbitrary React Context values.

Example:

```tsx
<PersonContext.Provider value={person}>
```

would allow a fragment model to flow outside clear fragment ownership boundaries.

Prefer distributing primitive/plain application data instead.

This should initially be treated as an unsupported persistent distribution channel unless a stronger analyzable model is introduced.

---

# 41. Dynamic JavaScript limitations

ViewQL is intentionally conservative around constructs that undermine static analysis.

Potentially unsupported or error-producing constructs include:

* `any`;
* `eval`;
* unsafe casts;
* highly dynamic reflective property access;
* proxies;
* opaque native bindings;
* unknown decorators;
* mutation of standard built-ins;
* unresolvable dynamic module behavior.

ViewQL should prefer a compile-time error over an under-fetched query.

---

# 42. Source availability

Source availability helps but is not sufficient.

The true criterion is:

> Can ViewQL prove the relevant flow behavior of the GraphQL reference?

A function may have source but still contain unsupported behavior.

Conversely, a built-in without source may be supported through a trusted semantic summary.

---

# 43. Debugging requirements

Debugging original source is a hard requirement.

ViewQL rewrites code substantially, but users should normally debug the original TS/TSX they wrote.

The compiler should:

1. never overwrite original source files;
2. preserve source spans in the IR;
3. emit high-quality source maps;
4. compose maps with downstream TypeScript/bundler maps;
5. preserve user symbol names wherever practical;
6. use deterministic ViewQL-prefixed names for generated plumbing.

---

# 44. Source maps

The compilation pipeline may look like:

```text
original TSX
   ↓ ViewQL
transformed TSX
   ↓ TypeScript/bundler
JavaScript
```

The final source map should ideally map:

```text
JavaScript
   ↓
original TSX
```

without forcing the debugger through the transformed intermediate source.

Every meaningful IR node should retain its originating source span.

Generated GraphQL field accesses should map to the original schema method calls that caused them.

Compiler plumbing with no true source equivalent may remain unmapped or map to the enclosing view definition.

---

# 45. Semantic variable preservation

Source maps cannot change runtime variable identity.

Therefore generated code should, when practical, preserve the developer's semantic variable names.

Example transformation:

Source:

```tsx
({ person }) => {
  return person.name();
}
```

Generated:

```tsx
({
  person: $viewql$personRef
}) => {
  const person =
    useFragment(
      PersonViewFragment,
      $viewql$personRef
    );

  return person.name;
}
```

Now inspecting `person` in a debugger yields the semantic fragment data object.

---

# 46. Diagnostics

Compiler errors should show the shortest relevant flow path.

Example:

```text
GraphQL value escapes PersonView.

person
  → passed to cachePerson()
  → stored in module variable personCache
  → module storage outlives fragment evaluation
```

Opaque call example:

```text
Cannot analyze GraphQL value passed to
some-library.process().

person
  → friends()
  → Array.map callback parameter friend
  → process(friend)

No source or trusted semantic summary is
available for process().
```

State example:

```text
GraphQL object Person cannot be stored in React state.

person
  → setSelectedPerson(person)

Store GraphQL primitive/plain values instead.
```

Diagnostics should point to the exact source operation creating the unsupported flow.

---

# 47. Compiler analysis architecture

The initial implementation may perform full-program analysis on each build.

This is acceptable for version one.

However, the compiler should be structured around reusable function/view summaries so incremental compilation can be added later.

---

# 48. Incremental compilation strategy

Each function/view may receive a cached summary based on:

* AST/source hash;
* relevant TypeScript semantic identity;
* generic shape if necessary;
* hashes of dependent summaries.

Example dependency graph:

```text
PersonQuery
   ↓
PersonView
   ↓
renderFriend
   ↓
displayName
```

If only `displayName` changes:

```text
invalidate displayName
→ invalidate renderFriend
→ invalidate PersonView
→ invalidate PersonQuery
```

Unrelated views remain cached.

---

# 49. Finding operation roots

`defineQueryView` and `defineFragmentView` are intentionally unusual module-level forms.

The compiler can cheaply scan candidate files before performing expensive semantic analysis.

A syntax/index pass can locate potential calls.

TypeScript symbol resolution then verifies that the callee is actually the ViewQL runtime export.

This avoids type-checking irrelevant source solely to discover operation roots where possible.

---

# 50. TypeScript compiler integration

The compiler should be architected so TypeScript semantic access is behind an adapter.

The current implementation can use whichever supported TypeScript compiler API is available.

Future TypeScript compiler architectures may expose semantics through different APIs or IPC.

The core ViewQL analysis should not depend excessively on concrete TypeScript compiler object shapes.

The adapter should provide needed concepts such as:

* resolved symbols;
* inferred types;
* control-flow information where available;
* source declarations;
* module resolution;
* generic type relationships;
* source spans.

---

# 51. Relay as first backend

Relay is the first implementation target because its model aligns closely with ViewQL:

* fragment colocation;
* fragment masking;
* generated fragment models;
* named fragment references;
* `useFragment`;
* incremental delivery;
* `@defer`;
* `@stream`;
* Suspense integration;
* fragment-local variables;
* `@alias`.

ViewQL should leverage Relay rather than reimplementing its normalized-cache/fragment model.

---

# 52. Relay compilation pipeline

Conceptually:

```text
ViewQL source
    ↓
ViewQL semantic analysis
    ↓
Relay GraphQL documents
    ↓
Relay compiler
    ↓
Relay fragment/query types + artifacts
    ↓
ViewQL source rewrite
    ↓
ordinary React + Relay code
```

This inherently requires a multi-stage pipeline.

Trying to collapse everything into one compiler pass is not a goal.

The important optimization is to avoid unnecessary repeated analysis of original TypeScript source.

---

# 53. Relay fragment models

Final rewritten code should use Relay's generated fragment model API rather than ViewQL inventing its own result-type system.

Example conceptual transformation:

Source:

```tsx
const CustomerView =
  defineFragmentView<
    Schema.Customer,
    "customer",
    {}
  >(({ customer }) => (
    <div>{customer.customerId()}</div>
  ));
```

Generated fragment:

```graphql
fragment CustomerView on Customer {
  customerId
}
```

Rewritten component:

```tsx
function CustomerView({
  customer: fragmentRef,
}: {
  customer: CustomerView$key;
}) {
  const customer =
    useFragment(
      CustomerViewFragment,
      fragmentRef
    );

  return (
    <div>{customer.customerId}</div>
  );
}
```

Exact Relay-generated type shapes should remain owned by Relay.

---

# 54. Relay aliases and fragment models

Relay's `@alias` should be used for conditional/type-refined fragment regions where Relay requires or benefits from independent fragment-model identity.

Example:

```graphql
... on Employee
  @alias(as: "_viewql_employee") {
  ...EmployeeView
}
```

The rewritten parent can then use:

```ts
const employee =
  person._viewql_employee;

if (employee != null) {
  return (
    <EmployeeView employee={employee} />
  );
}
```

This replaces source-level:

```ts
Schema.isEmployee(person)
```

---

# 55. Apollo as planned backend

Apollo Client support is planned.

Apollo has enough comparable concepts to make a backend plausible:

* fragment colocation;
* fragment data masking;
* fragment reading;
* cache fragment observation;
* incremental delivery support.

However, fragment Suspense semantics differ from Relay.

The core compiler should therefore avoid baking Relay fragment keys into its IR.

---

# 56. Apollo fragment reading

Apollo's fragment APIs may report fragment completeness instead of automatically suspending in the same way Relay does.

A ViewQL Apollo backend may therefore need a thin runtime fragment-reader adapter.

Conceptually:

```ts
useViewQLApolloFragment(...)
```

could:

1. read the fragment;
2. determine whether required data is incomplete and still expected;
3. subscribe to cache updates;
4. throw a stable Promise while waiting;
5. return data once complete.

This should remain localized to the Apollo backend.

`<Defer>` should preferably remain the same developer API for Relay and Apollo.

---

# 57. Backend capability model

Not every GraphQL client may support every ViewQL semantic equally well.

A client backend may expose capabilities such as:

```ts
interface ClientCapabilities {
  fragmentMasking: boolean;
  fragmentSuspense: boolean;
  defer: boolean;
  stream: boolean;
  conditionalFragments: boolean;
}
```

Unsupported ViewQL constructs should fail clearly at compile time rather than being silently approximated incorrectly.

---

# 58. Runtime package

`@viewql/runtime` should contain the developer-facing React APIs.

At minimum:

```ts
defineQueryView
defineFragmentView
Defer
```

The runtime package may depend directly on React.

It should not depend on a generated schema.

Ideally it remains largely GraphQL-client-neutral.

Client-specific runtime helpers can live in:

```text
@viewql/relay
@viewql/apollo
```

and be introduced only into rewritten/generated code.

---

# 59. Schema compiler package

`@viewql/schema` owns:

```text
GraphQL schema
      ↓
TypeScript schema façade
```

Responsibilities include:

* GraphQL built-in types;
* custom scalar mappings;
* output types;
* interfaces;
* object types;
* unions;
* enums;
* input objects;
* OneOf inputs;
* nullability;
* lists;
* field arguments;
* argument defaults;
* schema extensions;
* interface inheritance.

It should know nothing about React application source.

---

# 60. Component compiler package

`@viewql/compiler` owns:

* discovery of query/fragment views;
* typed source analysis;
* control-flow analysis;
* GraphQL value-flow analysis;
* function summaries;
* escape analysis;
* React state/storage sink analysis;
* fragment-view call graph;
* query-variable inference;
* fragment-argument inference;
* directive inference;
* type-refinement inference;
* defer-region recognition;
* ViewQL IR;
* diagnostics;
* source provenance;
* source-map input data.

Client-independent analysis should remain here.

---

# 61. Relay backend package

`@viewql/relay` owns:

* translating ViewQL IR into Relay GraphQL;
* Relay-specific alias rules;
* fragment arguments;
* Relay compiler invocation/integration;
* reading Relay-generated fragment/query types;
* rewriting ViewQL views into Relay components;
* Relay runtime imports;
* version compatibility.

Relay-specific artifact structures should be isolated behind adapters where possible.

---

# 62. Apollo backend package

Planned `@viewql/apollo` responsibilities:

* translating ViewQL IR into Apollo-compatible GraphQL;
* Apollo fragment masking/model representation;
* component rewriting;
* Apollo fragment-reader behavior;
* deferred/incremental delivery integration;
* cache completeness/Suspense adaptation;
* Apollo version compatibility.

This package should not force Apollo-specific assumptions into core compiler semantics.

---

# 63. CLI

The exact CLI UX remains intentionally unspecified.

The user should not need to understand every internal compilation stage.

Conceptually, ViewQL needs to coordinate:

```text
schema generation
component analysis
GraphQL extraction
client compilation
source rewrite
TypeScript/application build
```

The CLI may orchestrate these stages while respecting existing TypeScript project configuration.

It should not attempt to mirror every possible `tsc` command-line flag.

Configuration should be primarily project/config-file driven.

---

# 64. Testing strategy

Testing should be layered.

## 64.1 Compiler golden tests

Most compiler tests should avoid any GraphQL server.

Fixture:

```text
schema.graphql
input.tsx
```

Expected:

```text
generated-schema.ts
generated.graphql
rewritten.tsx
diagnostics
```

These tests should cover the majority of compiler semantics.

---

## 64.2 Schema conformance fixture

Maintain a local test schema designed explicitly to exercise GraphQL's type system.

Coverage should include:

* String;
* Boolean;
* Int;
* Float;
* ID;
* custom scalars;
* enums;
* objects;
* interfaces;
* interface inheritance;
* unions;
* nullable fields;
* non-null fields;
* all important list/null combinations;
* field arguments;
* defaults;
* nullable arguments;
* ordinary input objects;
* OneOf inputs;
* recursive inputs;
* queries;
* mutations;
* deprecation;
* schema/type extensions.

The SDL should be version-controlled.

Do not depend on a remote schema for deterministic compiler tests.

---

# 65. Relay runtime testing

Runtime/component tests should generally use Relay's testing utilities rather than a real GraphQL server.

A mocked Relay environment allows tests to:

* inspect generated operations;
* resolve operations;
* reject operations;
* send partial payloads;
* control incremental delivery;
* test deferred rendering;
* test errors.

This gives deterministic tests while still exercising actual Relay normalization/store/reader behavior.

---

# 66. Defer/stream testing

Deferred behavior should test transitions such as:

```text
initial payload
   ↓
parent renders
   ↓
child fragment suspends
   ↓
fallback visible
   ↓
deferred payload delivered
   ↓
child renders
```

Stream behavior can be tested by delivering incremental payloads sequentially.

A full local GraphQL server is not required for most such tests.

---

# 67. Optional end-to-end tests

A small number of integration tests may execute against:

* GraphQL.js locally;
* an optional public no-auth GraphQL endpoint.

These are useful to ensure emitted operations are valid in a real executor.

They should not form the bulk of unit tests.

---

# 68. Public test schemas

Public GraphQL APIs may be useful for smoke testing, but should not be the authoritative schema for ViewQL feature coverage.

They may:

* change;
* disappear;
* lack newer features such as OneOf;
* have uptime/network dependencies.

The local conformance schema remains authoritative.

---

# 69. Rejected design: explicit field objects

Earlier design:

```ts
person.name.getValue()
query.person.getValue({ id })
```

or callable field descriptor objects with:

```ts
skip()
include()
```

was rejected.

Ordinary methods are simpler:

```ts
person.name()
query.person({ id })
```

Flow analysis now determines GraphQL semantics.

---

# 70. Rejected design: explicit directive DSL

Earlier design considered:

```ts
person.as<Employee>()
  .skip(condition)
  .getValue()
```

This was rejected.

The desired API is ordinary TypeScript:

```ts
if (Schema.isEmployee(person)) {
  // ...
}
```

and:

```ts
if (showDetails) {
  // ...
}
```

The compiler derives:

* inline fragments;
* `@include`;
* `@skip`;
* aliases;
* fragment arguments;
* operation variables.

Explicit directive APIs may be added later only if real-world needs prove flow inference insufficient.

YAGNI applies.

---

# 71. Rejected design: `select()` escape DSL

An earlier design considered a special:

```ts
person.select(...)
```

method to convert a GraphQL value into plain structural data before crossing opaque boundaries.

This was removed.

Developers can simply read primitives/ordinary values:

```ts
const value = {
  id: person.id(),
  name: person.name(),
};
```

and pass those elsewhere.

A specialized escape API can be added later if genuine ergonomic need emerges.

---

# 72. Rejected design: GraphQL values prohibited in closures

Earlier discussion proposed rejecting event handlers or callbacks that captured GraphQL values because the closure could outlive render.

This was rejected as unnecessarily strict.

If ViewQL can analyze the callback and account for all uses of the captured GraphQL value, the capture is valid.

The relevant distinction is between:

* delayed execution;
* unsupported reference persistence/escape.

---

# 73. Rejected design: all helpers require plain data

Earlier discussion considered requiring GraphQL values to remain only in query/fragment views.

That was relaxed.

Helpers may receive GraphQL values if their behavior can be analyzed.

Only opaque/unsupported boundaries require extracting plain values first.

---

# 74. Rejected design: infer defer from Suspense

Automatically generating `@defer` for GraphQL fields used under arbitrary `<Suspense>` was rejected.

Suspense does not uniquely mean GraphQL incremental delivery.

A component might suspend on unrelated resources while still wanting GraphQL data eagerly.

`<Defer>` therefore explicitly expresses ViewQL/GraphQL defer intent.

---

# 75. Rejected design: closure body inside Defer

Earlier:

```tsx
<Defer
  fallback={<Loading />}
  body={() => (
    ...
  )}
/>
```

was rejected because it would encourage the compiler to reinterpret an ordinary closure as a React component and potentially permit hook/state calls in a surprising context.

Chosen design:

```tsx
<Defer fallback={<Loading />}>
  <FriendList person={person} />
</Defer>
```

with `FriendList` explicitly defined using `defineFragmentView`.

---

# 76. Rejected design: every defer creates a synthetic fragment

When defer was modeled as an arbitrary lambda, the compiler would have needed to synthesize a named Relay fragment and component.

Under the explicit child-fragment-view design, no synthetic fragment is needed for normal defer use.

The existing child fragment becomes the deferred spread.

---

# 77. Rejected design: named fragment = component + prop name

Earlier fragment names such as:

```text
PersonView_person
EmployeeView_employee
```

were rejected.

The fragment name should simply match the module-level const:

```text
PersonView
EmployeeView
FriendList
```

This makes component and GraphQL fragment identity directly correspond.

---

# 78. Rejected design: GraphQL client neutrality at all costs

ViewQL should not pretend all GraphQL clients have Relay-equivalent capabilities.

Instead:

* keep core IR client-neutral;
* implement Relay first;
* add Apollo through a backend;
* expose or internally track backend capabilities;
* fail unsupported constructs clearly.

Do not implement an entire fragment-model/runtime system just to claim compatibility with a client lacking the required primitives.

---

# 79. Rejected design: UI-framework neutrality

ViewQL is fundamentally React-oriented.

Trying to abstract over React, Vue, Svelte, etc. at this stage would complicate:

* component analysis;
* state analysis;
* closure semantics;
* Suspense;
* rendering structure.

React is a deliberate hard dependency.

---

# 80. Generated-code readability

Generated code should be understandable if users inspect it.

Goals:

* retain component names;
* retain ordinary prop names;
* retain semantic local names where possible;
* use deterministic generated symbols;
* avoid gratuitous temporaries;
* reuse immutable fragment-model accesses through locals when useful.

GraphQL fragment models and generated fragment data are treated as immutable.

Repeated reads may therefore be safely cached in generated locals where this improves readability or avoids repeated dereferencing.

---

# 81. Source rewrite strategy

ViewQL should never modify the developer's source files in place.

Possible approaches:

* in-memory transformation passed to the next build step;
* generated shadow source tree;
* cache directory;
* virtual filesystem integration.

Whichever implementation is chosen, source maps must preserve the original authoring experience.

---

# 82. Client generated code as authoritative

ViewQL should not reproduce Relay/Apollo generated data types itself.

The pipeline should be:

```text
ViewQL semantic GraphQL
    ↓
client compiler/codegen
    ↓
client authoritative types
    ↓
ViewQL rewrite against those types
```

This minimizes duplicate type-generation logic and respects the GraphQL client's own masking/nullability/model conventions.

---

# 83. Relay version compatibility

ViewQL necessarily depends on some Relay public compiler/runtime behavior.

Version-specific assumptions should be isolated.

A Relay adapter layer may be appropriate:

```text
RelayVersionAdapter
  Relay21Adapter
  future Relay22Adapter
```

The CLI/compiler should detect incompatible Relay versions and report clearly.

Avoid direct dependence on undocumented Relay artifact internals unless unavoidable.

---

# 84. Client-specific compiler backend interface

A possible conceptual backend interface:

```ts
interface GraphQLClientBackend {
  emitOperation(...args: unknown[]): unknown;

  emitFragment(...args: unknown[]): unknown;

  emitTypeRefinement(...args: unknown[]): unknown;

  emitConditionalSelection(...args: unknown[]): unknown;

  emitDeferredFragmentSpread(...args: unknown[]): unknown;

  runClientCompiler(...args: unknown[]): unknown;

  rewriteQueryView(...args: unknown[]): unknown;

  rewriteFragmentView(...args: unknown[]): unknown;
}
```

The exact API should emerge from implementation rather than being frozen prematurely.

The important principle is that client-specific lowering occurs after ViewQL semantic analysis.

---

# 85. Key compiler invariants

The implementation should preserve the following invariants.

## 85.1 No under-fetching

If the compiler cannot prove that a selection can be omitted, fetch it.

Optimization failure should cause over-fetching, not missing data.

---

## 85.2 GraphQL object/interface values are not application state

They are temporary compiler-facing values that become fragment models.

They may be:

* passed to fragment views;
* captured by analyzable closures;
* passed through analyzable helpers;
* used in local analyzable data structures.

They may not be persisted into unsupported application state.

---

## 85.3 Opaque boundaries fail loudly

A GraphQL reference may not cross into unanalyzable code unless ViewQL has an explicit trusted semantic model for that boundary.

---

## 85.4 Named fragments represent explicit fragment views

A named fragment corresponds to a module-level `defineFragmentView` call.

Implementation-generated named fragments should be avoided unless a client backend genuinely requires them.

---

## 85.5 Ordinary TypeScript is preferred over ViewQL DSL syntax

Where static analysis can infer GraphQL meaning from normal code, prefer normal code.

---

# 86. Canonical example

Developer source:

```tsx
import {
  Defer,
  defineFragmentView,
  defineQueryView,
} from "@viewql/runtime";

import * as GraphQLSpec from "@viewql/spec";
import * as Schema from "./FacebookGraphQLSchema";

type PersonViewProps = {
  showFriends: boolean;
};

const CustomerView =
  defineFragmentView<
    Schema.Customer,
    "customer",
    {}
  >(({ customer }) => (
    <div>
      Customer ID: {customer.customerId()}
    </div>
  ));

const EmployeeView =
  defineFragmentView<
    Schema.Employee,
    "employee",
    {}
  >(({ employee }) => (
    <div>
      Employee ID: {employee.employeeId()}
    </div>
  ));

const FriendList =
  defineFragmentView<
    Schema.Person,
    "person",
    {}
  >(({ person }) => (
    <ul>
      {person.friends().map((friend, index) => (
        <li key={index}>
          {friend.name()}
        </li>
      ))}
    </ul>
  ));

const PersonView =
  defineFragmentView<
    Schema.Person,
    "person",
    PersonViewProps
  >(({ person, showFriends }) => {
    let details: JSX.Element | null = null;

    if (Schema.isCustomer(person)) {
      details = (
        <CustomerView customer={person} />
      );
    } else if (
      Schema.isEmployee(person)
    ) {
      details = (
        <EmployeeView employee={person} />
      );
    }

    return (
      <div>
        <div>Name: {person.name()}</div>

        {details}

        {showFriends ? (
          <Defer fallback={<div>Loading friends...</div>}>
            <FriendList person={person} />
          </Defer>
        ) : null}
      </div>
    );
  });

type PersonQueryProps = {
  id: GraphQLSpec.ID;
  showFriends: boolean;
};

const PersonQuery =
  defineQueryView<
    Schema.Query,
    PersonQueryProps
  >(({ query, id, showFriends }) => {
    const person = query.person({ id });

    if (person == null) {
      return <div>Person not found</div>;
    }

    return (
      <PersonView
        person={person}
        showFriends={showFriends}
      />
    );
  });
```

Expected GraphQL shape for Relay:

```graphql
fragment CustomerView on Customer {
  customerId
}

fragment EmployeeView on Employee {
  employeeId
}

fragment FriendList on Person {
  friends {
    name
  }
}

fragment PersonView on Person
@argumentDefinitions(
  showFriends: { type: "Boolean!" }
) {
  name

  ... on Customer
    @alias(as: "_viewql_customer") {
    ...CustomerView
  }

  ... on Employee
    @alias(as: "_viewql_employee") {
    ...EmployeeView
  }

  ... @include(if: $showFriends)
      @alias(as: "_viewql_showFriends") {
    ...FriendList
      @defer(label: "PersonView_friends")
  }
}

query PersonQuery(
  $id: ID!
  $showFriends: Boolean!
) {
  person(id: $id) {
    ...PersonView
      @arguments(
        showFriends: $showFriends
      )
  }
}
```

Conceptual rewritten `PersonView`:

```tsx
function PersonView({
  person: $viewql$personRef,
  showFriends,
}: {
  person: PersonView$key;
  showFriends: boolean;
}) {
  const person =
    useFragment(
      PersonViewFragment,
      $viewql$personRef
    );

  const customer =
    person._viewql_customer;

  const employee =
    person._viewql_employee;

  const friendsRegion =
    person._viewql_showFriends;

  let details: JSX.Element | null = null;

  if (customer != null) {
    details = (
      <CustomerView customer={customer} />
    );
  } else if (employee != null) {
    details = (
      <EmployeeView employee={employee} />
    );
  }

  return (
    <div>
      <div>Name: {person.name}</div>

      {details}

      {showFriends ? (
        <Defer fallback={<div>Loading friends...</div>}>
          <FriendList person={friendsRegion!} />
        </Defer>
      ) : null}
    </div>
  );
}
```

This example exercises the central architecture:

```text
schema method call
  → field selection

schema method argument
  → operation variable

object/interface type predicate
  → GraphQL type refinement
  → Relay aliased fragment model

conditional React control flow
  → inferred fragment argument
  → inferred query variable
  → @include

fragment-view composition
  → named fragment spread

Defer + fragment view
  → @defer

Relay compiler
  → authoritative fragment models

ViewQL rewrite
  → normal Relay React components
```

---

# 87. Immediate implementation milestones

A coding agent can reasonably begin with the following sequence.

## Milestone 1: package skeleton

Create:

```text
@viewql/spec
@viewql/runtime
@viewql/schema
@viewql/compiler
@viewql/relay
viewql
```

Set up:

* workspace package management;
* TypeScript project references if useful;
* tests;
* fixtures;
* formatting/linting;
* CI.

---

## Milestone 2: GraphQLSpec primitives

Implement:

* `ID`;
* `Int`;
* `Float`;
* `String`;
* `Boolean`;
* `Interface`;
* `Obj`;
* `Query`;
* `Schema`;

Add unit tests for branded scalar helpers.

---

## Milestone 3: schema compiler

Given SDL, generate:

* object interfaces with literal `__typename` discriminants;
* interface unions;
* object and interface type predicate functions;
* union representation as needed by compiler;
* field methods;
* argument object types;
* input objects;
* enums;
* OneOf unions;
* list/null combinations;
* custom scalar mappings.

Golden-test generated TypeScript.

---

## Milestone 4: runtime authoring API

Implement source-level typing/runtime stubs for:

* `defineQueryView`;
* `defineFragmentView`;
* `Defer`.

Before rewriting, `defineQueryView` and `defineFragmentView` may be identity-like React wrappers sufficient for type checking/dev tooling.

Their exact uncompiled runtime behavior should be explicitly decided; production builds are expected to rewrite them.

---

## Milestone 5: root discovery

Use TypeScript symbol resolution to find module-level const assignments resolving to:

* `defineQueryView`;
* `defineFragmentView`.

Generate deterministic query/fragment names from const variable names.

Reject unsupported invocation contexts.

---

## Milestone 6: direct field extraction

Start with:

```tsx
person.name()
```

and:

```tsx
query.person({ id })
```

Build basic IR and emit GraphQL.

No interprocedural analysis yet.

---

## Milestone 7: fragment composition

Recognize:

```tsx
<ChildView person={person} />
```

when `ChildView` resolves to another `defineFragmentView`.

Emit named fragment spreads.

---

## Milestone 8: prop/variable propagation

Build view graph constraints.

Infer:

* fragment arguments;
* operation variables;
* GraphQL input types.

Implement fixed-point propagation.

---

## Milestone 9: control-flow conditions

Record branch predicates and dominance relationships.

Infer conditional selection regions.

Emit `@include`/`@skip` only when predicates are GraphQL-liftable.

---

## Milestone 10: type refinement

Recognize generated object and interface type predicate functions by symbol.

Emit GraphQL type refinements. For Relay, use aliased fragment regions.

Rewrite predicate calls to fragment-model null checks and associate the guarded
source value with the refined fragment model.

---

## Milestone 11: Defer

Recognize:

```tsx
<Defer>
  <FragmentView ... />
</Defer>
```

Emit `@defer` on the fragment spread.

Ensure rewritten child fragment reader executes beneath Suspense.

---

## Milestone 12: Relay compiler integration

Feed generated operations/fragments to Relay.

Consume Relay-generated public fragment/query types.

Keep Relay-specific assumptions isolated.

---

## Milestone 13: source rewrite

Transform:

* schema methods → generated fragment-model properties;
* query façade → Relay query reads;
* fragment props → Relay keys;
* object/interface predicates → alias null checks;
* fragment views → `useFragment`;
* operation views → Relay query APIs.

Preserve symbols and source mappings.

---

## Milestone 14: helper summaries and escape analysis

Add:

* function summaries;
* interprocedural flow;
* generic parametric summaries;
* built-in array summaries;
* opaque-call detection.

---

## Milestone 15: React storage analysis

Detect:

* `useState` setters;
* `useReducer` dispatch;
* `useRef.current`;
* class state if supported;
* Context;
* persistent known stores where possible.

Reject GraphQL object/interface persistence.

---

## Milestone 16: incremental compilation

Only after correctness.

Cache:

* function summaries;
* view IR;
* dependency hashes.

Invalidate transitively.

---

# 88. Open design questions

The following issues remain intentionally unresolved or require implementation validation.

## 88.1 Fragment-name collisions

Because fragment names now equal const variable names, two modules may define:

```ts
const PersonView = ...
```

GraphQL fragment names are globally scoped within a compiled operation/document universe.

Possible policies:

* compile-time error requiring unique ViewQL view names;
* deterministic module suffix;
* backend-specific namespace encoding.

Prefer readability but maintain deterministic behavior.

---

## 88.2 Runtime behavior without ViewQL compilation

Should `defineQueryView` / `defineFragmentView`:

* throw if somehow executed uncompiled;
* act as identity wrappers for development tooling;
* expose a diagnostic runtime fallback?

This should be decided intentionally.

---

## 88.3 Mutation support

Initial design assumes GraphQL query/fragment reading.

Mutations may require additional APIs because mutation execution is imperative rather than view-derived.

Do not force mutations into the query-view abstraction prematurely.

---

## 88.4 Subscriptions

Subscriptions likewise have lifecycle semantics distinct from query selection.

Treat as future work unless required for initial validation.

---

## 88.5 `@stream`

ViewQL may eventually provide an explicit React abstraction for `@stream`, analogous to `<Defer>`.

Do not infer stream behavior merely from list iteration.

`initial_count` and rendering semantics likely require explicit developer intent.

---

## 88.6 Fragments with multiple GraphQL object props

Current `defineFragmentView` is centered on one blessed GraphQL fragment prop.

Supporting multiple independently owned GraphQL fragment roots in one view may complicate:

* fragment identity;
* fragment generation;
* component ownership;
* client fragment keys.

This should remain constrained initially unless a strong use case appears.

---

## 88.7 Async helpers

Async functions that capture/use GraphQL fragment models may be analyzable but introduce lifecycle concerns.

Initial implementation may conservatively restrict some async flows.

---

## 88.8 Error boundaries

Deferred fragment failures interact with React error boundaries as well as Suspense.

Relay/Apollo backend behavior should be validated.

---

## 88.9 Server-side rendering

React SSR and streaming may change the behavior expected from deferred fragment reads.

This should be validated separately rather than assumed from client rendering.

---

## 88.10 React Server Components

ViewQL currently assumes conventional React component/client GraphQL behavior.

RSC introduces different data-loading and serialization boundaries.

Treat as future architectural work.

---

# 89. Non-goals for the initial release

Initial ViewQL should not attempt to:

* support every GraphQL client;
* support every UI framework;
* perfectly model arbitrary JavaScript;
* optimize every possible conditional;
* synthesize arbitrary Boolean query expressions;
* infer defer from Suspense;
* automatically persist fragment models safely across application state;
* replace Relay/Apollo's normalized cache;
* invent another client-side GraphQL result type system;
* support unsafe opaque escapes;
* dynamically interpret monkey-patched built-ins;
* provide an explicit GraphQL directive DSL unless needed later.

---

# 90. Guiding philosophy

The implementation should consistently prefer:

```text
ordinary TypeScript
over
GraphQL-specific ViewQL syntax
```

when the compiler can infer the necessary semantics safely.

Prefer:

```tsx
if (Schema.isCustomer(person)) {
  ...
}
```

over:

```ts
person.on<Customer>()
```

Prefer:

```tsx
if (showFriends) {
  ...
}
```

over:

```ts
.include(showFriends)
```

Prefer:

```tsx
person.name()
```

over:

```ts
person.name.getValue()
```

Prefer:

```tsx
<Defer>
  <FriendList ... />
</Defer>
```

over:

```ts
fragment.defer()
```

The compiler should derive the GraphQL language from the application language wherever doing so is sound and understandable.

The application should read like React.

The generated GraphQL should read like GraphQL.

The generated client code should read like idiomatic Relay or Apollo.

ViewQL exists to connect those representations without requiring developers to repeat themselves.
