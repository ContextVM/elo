# @contextvm/elo - JavaScript-Only Fork

[![CI](https://github.com/contextvm/elo/actions/workflows/ci.yml/badge.svg)](https://github.com/contextvm/elo/actions/workflows/ci.yml)

> **Fork Notice**: This is a JavaScript-only fork of [enspirit/elo](https://github.com/enspirit/elo), maintained by [ContextVM](https://contextvm.com). The original multi-target (Ruby, JavaScript, PostgreSQL) version is available at the upstream repository.

A simple, well-designed, portable and safe data expression language that compiles to JavaScript. This fork focuses on a JS-only architecture with support for plugin programs using the `plan`/`do` syntax.

**[Try Elo online](https://elo-lang.org/)** - Interactive playground and documentation (upstream)

## Why Fork?

This fork exists to provide:

- **JavaScript-only runtime** for lightweight, portable deployments
- **Plugin program architecture** with capability-based execution (`plan`/`do` syntax)
- **Strategy-1 planner** for advanced runtime control
- **Faster releases** with simplified build pipeline

## Why Elo?

No-Code tools like Klaro Cards generally require an expression language for user
to manipulate data easily. This language must be :

- simple, because No-Code tools are used by non-tech people
- portable, because they are implemented in various frontend/backend/db technologies
- safe, because end-users writing code yield serious security issues
- well-designed, because there are too many ill-designed programming languages already

See also the Related work section below.

## Fork Features (JavaScript-Only)

This fork introduces the following new features:

### Plugin Program Architecture

- **`plan`/`then` rounds**: Multi-stage computation model for plugin programs

  ```elo
  plan a = 1, b = _.x in then c = 2 in a + b + c
  ```

- **`do` capability calls**: Call external capabilities from within plugin programs

  ```elo
  plan result = do 'nostr.query' {kinds: [0]} in result | null
  ```

- **Strategy-1 planner/runtime driver**: Advanced execution planning for complex workflows

- **JSON boundary helpers**: Utilities for working with JSON data at system boundaries

### Upstream Features (Preserved)

All original Elo features are preserved.

## Installation

```bash
npm install
npm run build
```

## Testing

Elo uses a comprehensive test suite that verifies:

- **Unit tests**: Parser, AST, and compiler components
- **Integration tests**: End-to-end compilation output
- **Acceptance tests**: Compiled code execution in JavaScript runtime (Node.js)

```bash
npm run test:unit
npm run test:integration
npm run test:acceptance
```

## Command Line Interface

Elo provides two CLI tools:

- `eloc` - The compiler (for developers integrating Elo into their products)
- `elo` - The evaluator (for quickly running Elo expressions)

### Compiler (eloc)

The compiler translates Elo expressions to JavaScript:

```bash
# Compile expression to JavaScript (default)
./bin/eloc -e "2 + 3 * 4"

# Compile with prelude (includes required runtime libraries)
./bin/eloc -e "NOW + PT2H" -p

# Output only the prelude (useful for bundling)
./bin/eloc --prelude-only

# Compile from file (each line is compiled separately)
./bin/eloc input.elo

# Compile to file
./bin/eloc -e "2 + 3" -f output.js

# Compile from stdin
echo "2 + 3 * 4" | ./bin/eloc -
cat input.elo | ./bin/eloc -
```

Options:

- `-e, --expression <expr>` - Expression to compile
- `-t, --target <lang>` - Target language: `js` (default and only option in this fork)
- `-p, --prelude` - Include necessary library imports/requires
- `--prelude-only` - Output only the prelude (no expression needed)
- `-f, --file <path>` - Output to file instead of stdout
- `-h, --help` - Show help message

### Evaluator (elo)

The evaluator compiles to JavaScript and immediately evaluates the expression:

```bash
# Evaluate a simple expression
./bin/elo -e "2 + 3 * 4"
# Outputs: 14

# Evaluate with input data (JSON)
./bin/elo -e "_.x + _.y" -d '{"x": 1, "y": 2}'
# Outputs: 3

# Evaluate with CSV input data
./bin/elo -e "map(_, fn(r ~> r.name))" -d @data.csv -f csv
# Outputs: ["Alice","Bob"]

# Evaluate with data from file (format auto-detected from extension)
./bin/elo -e "_.name" -d @data.json

# Output in different formats
./bin/elo -e "{a: 1, b: 2}" -o elo    # Elo code format
./bin/elo -e "[{name: 'Alice'}]" -o csv  # CSV format

# Evaluate from .elo file
./bin/elo expressions.elo

# Pipe data through stdin
echo '{"x": 10}' | ./bin/elo -e "_.x * 2" --stdin
# Outputs: 20
```

Options:

- `-e, --expression <expr>` - Expression to evaluate
- `-d, --data <data>` - Input data for `_` variable (or `@file` to read from file)
- `--stdin` - Read input data from stdin
- `-f, --input-format <fmt>` - Input data format: `json` (default) or `csv`
- `-o, --output-format <fmt>` - Output format: `json` (default), `elo`, or `csv`
- `-h, --help` - Show help message

## Using Elo in JavaScript/TypeScript

The simplest way to use Elo is with the `compile()` function, which creates a callable JavaScript function from an Elo expression:

```typescript
import { compile } from "@contextvm/elo";
import { DateTime, Duration } from "luxon";

// Compile an expression to a callable function
// Every Elo expression takes _ (implicit input) as parameter
const addTen = compile<(x: number) => number>("_ + 10", {
  runtime: { DateTime, Duration },
});
addTen(5); // => 15

// Temporal expressions work too
const inThisWeek = compile<(d: unknown) => boolean>("_ in SOW ... EOW", {
  runtime: { DateTime, Duration },
});
inThisWeek(DateTime.now()); // => true or false
```

The `runtime` option injects dependencies (like `DateTime` and `Duration` from luxon) into the compiled function. This avoids global variables and keeps the compiled code portable.

## Data Format Adapters

The CLI and playground support multiple input/output formats (JSON, CSV). The format system is pluggable—you can provide custom adapters using libraries like PapaParse or SheetJS. See `src/formats.ts` for the `FormatAdapter` interface and built-in implementations.

## Lower-Level API

For more control, you can use the lower-level parsing and compilation functions:

```typescript
import {
  parse,
  compile,
  compileToJavaScript,
  parsePluginProgram,
  compilePlugin,
} from "@contextvm/elo";

// Parse a simple expression
const ast = parse(`
  let
    x = TODAY,
    y = 3
  in
    assert(x + y * P1D == TODAY + P3D)
`);

// Compile to JavaScript
console.log(compileToJavaScript(ast));

// Parse and compile a plugin program with plan/then/do syntax
const pluginSrc = "plan result = do 'cap.query' {limit: 10} in result | null";
const plugin = parsePluginProgram(pluginSrc);
const jsCode = compilePlugin(pluginSrc);
```

### Plugin Program API

This fork introduces plugin program support for capability-based execution:

- `parsePluginProgram(src: string)` - Parse a plugin program with `plan`/`then` rounds
- `compilePlugin(src: string)` - Compile a plugin program to JavaScript
- `parseWithMeta(src: string)` - Parse with diagnostics (errors, warnings)

Object literals accept both bare identifier keys and quoted string keys, so protocol-shaped data such as `{kinds: [1], '#e': ['event-id'], '#K': ['kind']}` can be written directly in Elo.

**Getting started**: See [HACKING.md](HACKING.md) for:

- Development environment setup (local or Docker)
- Running the test suite
- Project structure overview

**For developers and AI assistants**: See [CLAUDE.md](CLAUDE.md) for:

- Detailed development workflow
- How to add new features and operators
- Architecture documentation
