# Relo technical plan v1

## Goal

Create a thin package `relo` that provides Relatr-specific Elo plugin validation and authoring metadata without pulling in the full Relatr runtime.

The package should let web apps, editors, CLIs, and other lightweight tools validate Relatr-flavored Elo plugins using the generic validation primitives already exposed by [`validatePluginProgram()`](src/plugin-validator.ts:271).

## Why `relo` exists

The ecosystem now has three distinct concerns:

- [`@contextvm/elo`](package.json:2) provides the generic expression language, parser, compiler, and host-injected plugin validation primitives.
- [`relatr`](relatr/package.json:2) provides the full runtime host, capability execution, graph access, relay access, and operational policy.
- `relo` should provide the Relatr-specific authoring layer between them.

This keeps the architecture clean:

- generic language concerns stay in [`src/`](src)
- runtime execution concerns stay in [`relatr/src/capabilities/`](relatr/src/capabilities)
- Relatr-specific plugin authoring knowledge moves into `relo`

## Non-goals

- `relo` is not a runtime capability executor
- `relo` is not a general-purpose Nostr or graph SDK
- `relo` should not depend on live host services such as [`EloPluginEngine`](relatr/src/plugins/EloPluginEngine.ts:75)
- `relo` should not move Relatr runtime policy out of [`CapabilityExecutor`](relatr/src/capabilities/CapabilityExecutor.ts:27)
- `relo` should not make [`@contextvm/elo`](package.json:2) Relatr-aware

## Package boundary

Recommended package stack:

1. [`@contextvm/elo`](package.json:2)
2. `relo`
3. [`relatr`](relatr/package.json:2)

### Responsibilities of [`@contextvm/elo`](package.json:2)

- parse plugin programs
- validate generic Elo semantics
- expose capability-injected plugin validation through [`src/plugin-validator.ts`](src/plugin-validator.ts)
- remain domain-agnostic

### Responsibilities of `relo`

- define the Relatr capability validation catalog
- define authoring-time metadata for Relatr capabilities
- export convenience wrappers for Relatr-aware plugin validation
- support editors, forms, linting, and browser-based validation
- remain side-effect free and lightweight

### Responsibilities of [`relatr`](relatr/package.json:2)

- execute capabilities
- manage capability enablement and environment policy
- wire runtime dependencies such as graph, relays, and caches
- own built-in runtime registration in [`registerBuiltInCapabilities()`](relatr/src/capabilities/registerBuiltInCapabilities.ts:25)

## Key architectural principle

Validation metadata and runtime metadata are related, but not identical.

Today [`CAPABILITY_CATALOG`](relatr/src/capabilities/capability-catalog.ts:20) describes operational concerns:

- capability name
- environment variable
- default enablement
- description

But authoring-time validation needs additional semantic concerns:

- expected argument object shape
- required and optional fields
- field-level type expectations
- examples for tooling
- human-friendly diagnostics

So `relo` should define a validation-oriented catalog rather than directly re-exporting [`CAPABILITY_CATALOG`](relatr/src/capabilities/capability-catalog.ts:20) as-is.

## Proposed v1 public API

`relo` should keep its public API intentionally small.

### Core exports

- `RELATR_VALIDATION_CAPABILITIES`
- `validateRelatrPluginProgram()`
- `validateRelatrExpressionAst()`
- `getRelatrCapabilityNames()`
- `isRelatrCapabilityName()`

### Optional metadata exports

- `RELATR_CAPABILITY_DOCS`
- `RelatrCapabilityDefinition`
- `RelatrCapabilityArgRule`

## Proposed v1 package layout

Suggested structure:

```text
relo/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    catalog.ts
    docs.ts
    validators.ts
    wrappers.ts
    types.ts
  test/
    unit/
```

### File responsibilities

- [`relo/src/types.ts`](relo/src/types.ts): public types for Relatr capability metadata
- [`relo/src/catalog.ts`](relo/src/catalog.ts): canonical Relatr validation catalog
- [`relo/src/validators.ts`](relo/src/validators.ts): capability-specific argument validators built on top of Elo AST validation hooks
- [`relo/src/wrappers.ts`](relo/src/wrappers.ts): convenience wrappers around [`validatePluginProgram()`](src/plugin-validator.ts:271) and [`validateExpressionAst()`](src/plugin-validator.ts:146)
- [`relo/src/index.ts`](relo/src/index.ts): small public façade

## Proposed v1 types

Illustrative shape:

```ts
import type {
  PluginCapabilitySpec,
  PluginCapabilityValidationContext,
  PluginDiagnostic,
  PluginValidationOptions,
  ValidatedPluginProgram,
} from "@contextvm/elo";

export type RelatrCapabilityArgRule = {
  requiredKeys?: string[];
  optionalKeys?: string[];
  description?: string;
  example?: unknown;
};

export type RelatrCapabilityDefinition = {
  name: string;
  description: string;
  argRule?: RelatrCapabilityArgRule;
  toPluginCapabilitySpec: () => PluginCapabilitySpec;
};

export declare const RELATR_VALIDATION_CAPABILITIES: Record<
  string,
  PluginCapabilitySpec
>;

export declare function validateRelatrPluginProgram(
  source: string,
  options?: Omit<PluginValidationOptions, "capabilities">,
): ValidatedPluginProgram;
```

The exact type shape can evolve, but the important point is that `relo` owns validation-facing metadata, not runtime handlers.

## Validation strategy

`relo` should use the host-injected capability model already implemented in [`src/plugin-validator.ts`](src/plugin-validator.ts:159).

That means:

1. `relo` creates a `Record<string, PluginCapabilitySpec>`
2. wrappers inject that record into [`validatePluginProgram()`](src/plugin-validator.ts:271)
3. capability validators use [`PluginCapabilityValidationContext`](src/plugin-validator.ts:19) to validate their argument expressions

This preserves the generic Elo architecture while making Relatr validation turnkey for consumers.

## v1 capability coverage

Start with the capabilities already declared in [`relatr/src/capabilities/capability-catalog.ts`](relatr/src/capabilities/capability-catalog.ts:20):

- `nostr.query`
- `graph.stats`
- `graph.all_pubkeys`
- `graph.pubkey_exists`
- `graph.is_following`
- `graph.are_mutual`
- `graph.degree`
- `http.nip05_resolve`

### v1 validation depth

Use a pragmatic validation depth in the first version:

- validate capability name existence
- validate that args expressions only reference allowed scope
- validate that args are object-shaped where appropriate
- validate presence of obviously required keys
- validate a few key field types where cheap and stable

Do not attempt full semantic simulation of runtime behavior in v1.

## Source of truth policy

For v1, the simplest policy is:

- [`relatr`](relatr/package.json:2) remains source of truth for runtime handlers and enablement
- `relo` becomes source of truth for authoring-time validation metadata

The two catalogs should intentionally share the same capability names, but they do not need to share the exact same structure.

This avoids forcing runtime concerns into the validation package.

## Monorepo/workspace recommendation

Keep `relo` in the same repository/workspace as [`relatr`](relatr/package.json:2).

Why:

- capability evolution stays synchronized
- local development is simpler
- tests can exercise both authoring and runtime assumptions without cross-repo friction
- publishing can still remain separate per package

Recommended workspace members over time:

- [`@contextvm/elo`](package.json:2)
- `relo`
- [`relatr`](relatr/package.json:2)

## Integration points

### Editor and web app usage

Primary consumers of `relo`:

- plugin editors
- web forms for plugin authoring
- pre-publish validation flows
- linting/preview tooling

Typical use:

1. author writes plugin source
2. tool calls `validateRelatrPluginProgram()`
3. tool displays diagnostics and capability-specific guidance

### Runtime usage in [`relatr`](relatr/package.json:2)

Relatr may optionally reuse `relo` validation metadata for:

- plugin installation checks
- manifest/plugin preflight validation
- admin UX

But runtime execution should still flow through [`CapabilityRegistry`](relatr/src/capabilities/CapabilityRegistry.ts:33), [`CapabilityExecutor`](relatr/src/capabilities/CapabilityExecutor.ts:27), and [`registerBuiltInCapabilities()`](relatr/src/capabilities/registerBuiltInCapabilities.ts:25).

## Testing plan

Add dedicated `relo` tests for:

- valid Relatr plugin using registered Relatr capabilities
- unknown capability names rejected by `relo`
- capability args referencing unknown variables rejected
- required arg keys enforced for selected capabilities
- convenience wrapper returns same generic diagnostics shape as Elo
- catalog name list stays aligned with runtime capability names

Alignment tests should specifically compare the v1 `relo` capability names with [`getAllCapabilityNames()`](relatr/src/capabilities/capability-catalog.ts:90).

## Implementation phases

### Phase 1: workspace/package bootstrap

1. create `relo/` package
2. add package manifest and TypeScript config
3. configure workspace wiring if needed
4. add minimal README and test setup

### Phase 2: validation catalog

1. define `RelatrCapabilityDefinition`
2. create the initial validation catalog for all current Relatr capabilities
3. add helper functions such as `getRelatrCapabilityNames()`

### Phase 3: validator wrappers

1. implement `RELATR_VALIDATION_CAPABILITIES`
2. implement `validateRelatrPluginProgram()`
3. implement `validateRelatrExpressionAst()`

### Phase 4: tests and alignment checks

1. add unit tests for capability validation behavior
2. add alignment tests against [`relatr/src/capabilities/capability-catalog.ts`](relatr/src/capabilities/capability-catalog.ts:20)
3. document intentional differences between validation metadata and runtime metadata

### Phase 5: consumer adoption

1. use `relo` from browser/plugin-authoring surfaces
2. optionally adopt it in Relatr plugin install validation
3. document the split between authoring-time validation and runtime execution

## Success criteria

After v1:

- plugin writers can validate Relatr-flavored Elo programs without a full Relatr instance
- [`@contextvm/elo`](package.json:2) remains generic and reusable
- [`relatr`](relatr/package.json:2) remains the execution host
- Relatr capability names are available in a lightweight validation package
- editor and web tooling can provide useful diagnostics with one thin dependency

## Final recommendation

Build `relo` as a thin, publishable package in the same workspace as [`relatr`](relatr/package.json:2).

Do not create a lower-level `@relatr/capabilities` package yet.

If future reuse pressure appears, `relo` can later be internally split into:

- raw capability metadata
- validation adapters
- optional documentation helpers

But v1 should optimize for clarity and simplicity: one generic core in [`@contextvm/elo`](package.json:2), one Relatr-specific authoring package in `relo`, and one full runtime host in [`relatr`](relatr/package.json:2).
