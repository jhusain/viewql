import { createElement, Suspense } from "react";
import type { FunctionComponent, ReactNode } from "react";
import type { Obj, Query } from "@viewql/spec";

/** Props supplied to a fragment view while ViewQL analyzes application source. */
export type FragmentViewProps<
  TFragment extends Obj,
  TFragmentProp extends string,
  TProps extends object,
> = TProps & { [P in TFragmentProp]: TFragment };

/**
 * Declares a component rooted at the GraphQL query object.
 *
 * The `query` value is compiler-provided and is deliberately omitted from the
 * returned component's public props. Until compilation this is an ordinary
 * function component; ViewQL replaces its synthetic query access for a target
 * GraphQL client in production output.
 */
export function defineQueryView<
  TQuery extends Query,
  TProps extends object,
>(
  view: FunctionComponent<TProps & { query: TQuery }>,
): FunctionComponent<TProps> {
  return view as FunctionComponent<TProps>;
}

/**
 * Declares a component rooted at one GraphQL object or interface value.
 * The callback itself is returned so the declaration remains a normal,
 * stateless React function component before ViewQL compilation.
 */
export function defineFragmentView<
  TFragment extends Obj,
  TFragmentProp extends string,
  TProps extends object,
>(
  view: FunctionComponent<
    FragmentViewProps<TFragment, TFragmentProp, TProps>
  >,
): FunctionComponent<
  FragmentViewProps<TFragment, TFragmentProp, TProps>
> {
  return view;
}

/** Props for the client-neutral ViewQL deferred-delivery boundary. */
export interface DeferProps {
  readonly fallback: ReactNode;
  readonly children?: ReactNode;
}

/**
 * Marks a fragment-view render for GraphQL deferred delivery and provides its
 * React Suspense boundary at runtime.
 */
export function Defer({ fallback, children }: DeferProps): ReactNode {
  return createElement(Suspense, { fallback }, children);
}
