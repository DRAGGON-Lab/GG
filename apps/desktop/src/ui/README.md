# GG Circuit UI

GG Circuit uses Base UI as its headless interaction foundation. Product code should import from `src/ui` rather than directly from `@base-ui/react` so the app keeps a local design system boundary.

Keep this layer small and deliberate:

- Wrap primitives when GG Circuit needs a stable visual or behavioral contract.
- Re-export Base UI namespaces only until a local wrapper exists.
- Keep styling in this package token-driven and independent of app layout.
- Put math/research-specific components outside this package.
- Theme-aware components should use `theme.css` tokens and the `ThemeProvider`.
