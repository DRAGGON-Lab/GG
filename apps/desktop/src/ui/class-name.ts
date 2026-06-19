type ClassName<State> = string | ((state: State) => string | undefined);

export function cx(...values: Array<string | false | null | undefined>) {
  const className = values.filter(Boolean).join(" ");
  return className || undefined;
}

export function composeClassName<State>(
  ...classNames: Array<ClassName<State> | false | null | undefined>
): ClassName<State> | undefined {
  const defined = classNames.filter(Boolean) as ClassName<State>[];

  if (defined.length === 0) {
    return undefined;
  }

  if (defined.some((className) => typeof className === "function")) {
    return (state) =>
      cx(
        ...defined.map((className) =>
          typeof className === "function" ? className(state) : className,
        ),
      );
  }

  return cx(...(defined as string[]));
}
