import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import {
  parsePluginProgram,
  compilePlugin,
  parseWithMeta,
  validateExpressionAst,
  validatePluginProgram,
} from "../../src/index";

describe("Plugin program parsing", () => {
  it("parses plan/then rounds and score expression", () => {
    const src = "plan a = 1, b = _.x in then c = 2 in a + b + c";
    const program = parsePluginProgram(src);
    assert.strictEqual(program.rounds.length, 2);
    assert.deepStrictEqual(
      program.rounds.map((r) => r.kind),
      ["plan", "then"],
    );
    assert.deepStrictEqual(
      program.rounds[0].bindings.map((b) => b.name),
      ["a", "b"],
    );
    assert.deepStrictEqual(
      program.rounds[1].bindings.map((b) => b.name),
      ["c"],
    );
    assert.strictEqual(program.score.type, "binary");
  });

  it("parses do calls inside round bindings", () => {
    const src = "plan x = do 'nostr.query' {kinds: [0]} in x | null";
    const program = parsePluginProgram(src);
    const x = program.rounds[0].bindings[0].value;
    assert.strictEqual(x.type, "do_call");
    if (x.type === "do_call") {
      assert.strictEqual(x.capName, "nostr.query");
      assert.strictEqual(x.argsExpr.type, "object");
    }
  });
});

describe("Plugin program compilation", () => {
  it("rejects do calls in score expression", () => {
    const src = "plan x = 1 in do 'nostr.query' {kinds: [0]}";
    assert.throws(() => compilePlugin(src), /do/i);
  });
});

describe("Plugin program validation", () => {
  it("accepts a valid plugin with a registered capability", () => {
    const src =
      "plan events = do 'nostr.query' {kinds: [1]}, firstEvent = first(events) in firstEvent | null";
    const result = validatePluginProgram(src, {
      capabilities: {
        "nostr.query": { name: "nostr.query" },
      },
    });

    assert.strictEqual(result.program?.rounds.length, 1);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.score);
  });

  it("reports unknown functions in a binding", () => {
    const src = "plan profile = Dat(_.content) in profile | null";
    const result = validatePluginProgram(src);

    assert.ok(
      result.diagnostics.some(
        (d) => d.phase === "binding" && /Unknown function/i.test(d.message),
      ),
    );
  });

  it("reports unknown variables in a binding", () => {
    const src = "plan profile = missingVar in profile | null";
    const result = validatePluginProgram(src);

    assert.ok(
      result.diagnostics.some(
        (d) => d.phase === "binding" && /Undefined variable/i.test(d.message),
      ),
    );
  });

  it("reports unknown capability names", () => {
    const src = "plan meta = do 'nost.query' {kinds: [0]} in meta | null";
    const result = validatePluginProgram(src, {
      capabilities: {
        "nostr.query": { name: "nostr.query" },
      },
    });

    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.phase === "capability" && /Unknown capability/i.test(d.message),
      ),
    );
  });

  it("validates do-call arguments against the current binding scope", () => {
    const src =
      "plan author = _.pubkey, events = do 'nostr.query' {authors: [author], limit: missing} in events | null";
    const result = validatePluginProgram(src, {
      capabilities: {
        "nostr.query": { name: "nostr.query" },
      },
    });

    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.phase === "capability" &&
          d.bindingName === "events" &&
          /Undefined variable/i.test(d.message),
      ),
    );
  });

  it("passes validator context to host-provided capability validators", () => {
    const src =
      "plan author = _.pubkey, events = do 'nostr.query' {authors: [author]} in events | null";
    const result = validatePluginProgram(src, {
      capabilities: {
        "nostr.query": {
          name: "nostr.query",
          validateArgs: ({
            argsExpr,
            allowedVariables,
            bindingName,
            roundIndex,
            validateExpressionAst,
          }) => {
            assert.strictEqual(argsExpr.type, "object");
            assert.ok(allowedVariables.includes("author"));
            assert.strictEqual(bindingName, "events");
            assert.strictEqual(roundIndex, 0);
            return validateExpressionAst(argsExpr);
          },
        },
      },
    });

    assert.deepStrictEqual(result.diagnostics, []);
  });

  it("reports invalid score identifiers", () => {
    const src =
      "plan normalized = null in if normalized == null then nul else normalized";
    const result = validatePluginProgram(src);

    assert.ok(
      result.diagnostics.some(
        (d) => d.phase === "score" && /Undefined variable/i.test(d.message),
      ),
    );
  });

  it("reports do calls in score via plugin validation", () => {
    const src = "plan x = 1 in do 'nostr.query' {kinds: [0]}";
    const result = validatePluginProgram(src, {
      capabilities: {
        "nostr.query": { name: "nostr.query" },
      },
    });

    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.phase === "score" &&
          /only allowed inside plugin-program bindings/i.test(d.message),
      ),
    );
  });

  it("keeps binding scope sequential within a round", () => {
    const valid = validatePluginProgram("plan a = 1, b = a + 1 in b");
    const invalid = validatePluginProgram("plan b = a + 1, a = 1 in b");

    assert.deepStrictEqual(valid.diagnostics, []);
    assert.ok(
      invalid.diagnostics.some(
        (d) => d.phase === "binding" && d.bindingName === "b",
      ),
    );
  });
});

describe("parseWithMeta", () => {
  it("returns diagnostics with best-effort line/column", () => {
    const res = parseWithMeta("2 + +");
    assert.strictEqual(res.ast, null);
    assert.ok(res.diagnostics.length >= 1);
    assert.strictEqual(res.diagnostics[0].severity, "error");
  });
});

describe("validateExpressionAst", () => {
  it("validates expressions against caller-provided scope", () => {
    const program = parsePluginProgram("plan a = 1 in a + b");
    const diagnostics = validateExpressionAst(program.score, {
      allowedVariables: ["a"],
    });

    assert.ok(
      diagnostics.some((d) => /Undefined variable: 'b'/.test(d.message)),
    );
  });
});
