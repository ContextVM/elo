import type { DoCall, Expr } from "./ast";
import {
  compileToJavaScriptWithMeta,
  type JavaScriptCompileOptions,
  type JavaScriptCompileResult,
} from "./compilers/javascript";
import type { Diagnostic } from "./embed";
import {
  parsePluginProgram,
  type ParserOptions,
  type PluginProgram,
} from "./parser";

export type PluginCapabilitySpec = {
  name: string;
  validateArgs?: (
    context: PluginCapabilityValidationContext,
  ) => PluginDiagnostic[];
};

export type PluginCapabilityValidationContext = {
  argsExpr: Expr;
  allowedVariables: string[];
  roundIndex: number;
  bindingName: string;
  validateExpressionAst: (
    expr: Expr,
    overrides?: Omit<
      PluginValidationOptions,
      "allowedVariables" | "capabilities"
    >,
  ) => PluginDiagnostic[];
};

export type PluginValidationOptions = ParserOptions &
  JavaScriptCompileOptions & {
    allowedVariables?: Iterable<string>;
    capabilities?: Record<string, PluginCapabilitySpec>;
  };

export type PluginValidationPhase =
  | "parse"
  | "binding"
  | "score"
  | "capability";

export type PluginDiagnostic = Diagnostic & {
  phase?: PluginValidationPhase;
  roundIndex?: number;
  bindingName?: string;
};

export type ValidatedPluginProgram = {
  program: PluginProgram | null;
  diagnostics: PluginDiagnostic[];
  score?: JavaScriptCompileResult;
};

type BindingContext = {
  phase: "binding";
  roundIndex: number;
  bindingName: string;
};

type ScoreContext = {
  phase: "score";
};

type ValidationContext = BindingContext | ScoreContext;

function parseLocation(
  message: string,
): { line: number; column: number } | undefined {
  const match = /line\s+(\d+),\s*column\s+(\d+)/i.exec(message);
  if (!match) return undefined;
  return { line: Number(match[1]), column: Number(match[2]) };
}

function toDiagnostic(
  message: string,
  severity: PluginDiagnostic["severity"] = "error",
  context?: Partial<PluginDiagnostic>,
): PluginDiagnostic {
  return {
    message,
    severity,
    location: parseLocation(message),
    ...context,
  };
}

function buildScope(allowedVariables: Iterable<string> = []): Set<string> {
  const scope = new Set<string>(["_"]);
  for (const name of allowedVariables) {
    scope.add(name);
  }
  return scope;
}

function validateGenericExpression(
  expr: Expr,
  allowedVariables: Iterable<string>,
  options?: JavaScriptCompileOptions,
): JavaScriptCompileResult {
  const scopedExpr = {
    type: "let",
    bindings: Array.from(new Set(allowedVariables))
      .filter((name) => name !== "_")
      .map((name) => ({
        name,
        value: {
          type: "variable" as const,
          name: "_",
        },
      })),
    body: expr,
  } satisfies Expr;

  return compileToJavaScriptWithMeta(scopedExpr, options);
}

function containsDoCall(expr: Expr): boolean {
  switch (expr.type) {
    case "do_call":
      return true;
    case "binary":
      return containsDoCall(expr.left) || containsDoCall(expr.right);
    case "unary":
      return containsDoCall(expr.operand);
    case "function_call":
      return expr.args.some(containsDoCall);
    case "member_access":
      return containsDoCall(expr.object);
    case "let":
      return (
        expr.bindings.some((binding) => containsDoCall(binding.value)) ||
        containsDoCall(expr.body)
      );
    case "if":
      return (
        containsDoCall(expr.condition) ||
        containsDoCall(expr.then) ||
        containsDoCall(expr.else)
      );
    case "lambda":
      return containsDoCall(expr.body);
    case "object":
      return expr.properties.some((prop) => containsDoCall(prop.value));
    case "array":
      return expr.elements.some(containsDoCall);
    case "alternative":
      return expr.alternatives.some(containsDoCall);
    case "apply":
      return containsDoCall(expr.fn) || expr.args.some(containsDoCall);
    default:
      return false;
  }
}

export function validateExpressionAst(
  expr: Expr,
  options: PluginValidationOptions = {},
): PluginDiagnostic[] {
  try {
    validateGenericExpression(
      expr,
      buildScope(options.allowedVariables),
      options,
    );
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [toDiagnostic(message, "error")];
  }
}

function validateDoCall(
  doCall: DoCall,
  scope: Set<string>,
  options: PluginValidationOptions,
  context: BindingContext,
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const spec = options.capabilities?.[doCall.capName];
  const allowedVariables = Array.from(scope);

  for (const diagnostic of validateExpressionAst(doCall.argsExpr, {
    ...options,
    allowedVariables,
  })) {
    diagnostics.push({
      ...diagnostic,
      phase: diagnostic.phase ?? "capability",
      roundIndex: diagnostic.roundIndex ?? context.roundIndex,
      bindingName: diagnostic.bindingName ?? context.bindingName,
    });
  }

  if (!spec) {
    diagnostics.push(
      toDiagnostic(`Unknown capability '${doCall.capName}'`, "error", {
        phase: "capability",
        roundIndex: context.roundIndex,
        bindingName: context.bindingName,
      }),
    );
  }

  if (spec?.validateArgs) {
    for (const diagnostic of spec.validateArgs({
      argsExpr: doCall.argsExpr,
      allowedVariables,
      roundIndex: context.roundIndex,
      bindingName: context.bindingName,
      validateExpressionAst: (expr, overrides = {}) =>
        validateExpressionAst(expr, {
          ...options,
          ...overrides,
          allowedVariables,
        }),
    })) {
      diagnostics.push({
        ...diagnostic,
        phase: diagnostic.phase ?? "capability",
        roundIndex: diagnostic.roundIndex ?? context.roundIndex,
        bindingName: diagnostic.bindingName ?? context.bindingName,
        location: diagnostic.location ?? parseLocation(diagnostic.message),
      });
    }
  }

  return diagnostics;
}

function validateBindingExpr(
  expr: Expr,
  scope: Set<string>,
  options: PluginValidationOptions,
  context: BindingContext,
): PluginDiagnostic[] {
  if (expr.type === "do_call") {
    return validateDoCall(expr, scope, options, context);
  }

  try {
    validateGenericExpression(expr, scope, options);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      toDiagnostic(message, "error", {
        phase: context.phase,
        roundIndex: context.roundIndex,
        bindingName: context.bindingName,
      }),
    ];
  }
}

function validateScoreExpr(
  expr: Expr,
  scope: Set<string>,
  options: PluginValidationOptions,
): { diagnostics: PluginDiagnostic[]; score?: JavaScriptCompileResult } {
  if (containsDoCall(expr)) {
    return {
      diagnostics: [
        toDiagnostic(
          `'do' is only allowed inside plugin-program bindings`,
          "error",
          {
            phase: "score",
          },
        ),
      ],
    };
  }

  try {
    const score = validateGenericExpression(expr, scope, options);
    return { diagnostics: [], score };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostics: [toDiagnostic(message, "error", { phase: "score" })],
    };
  }
}

export function validatePluginProgram(
  source: string,
  options: PluginValidationOptions = {},
): ValidatedPluginProgram {
  let program: PluginProgram | null = null;

  try {
    program = parsePluginProgram(source, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      program: null,
      diagnostics: [toDiagnostic(message, "error", { phase: "parse" })],
    };
  }

  const diagnostics: PluginDiagnostic[] = [];
  const scope = buildScope(options.allowedVariables);

  for (const [roundIndex, round] of program.rounds.entries()) {
    for (const binding of round.bindings) {
      diagnostics.push(
        ...validateBindingExpr(binding.value, scope, options, {
          phase: "binding",
          roundIndex,
          bindingName: binding.name,
        }),
      );
      scope.add(binding.name);
    }
  }

  const scoreResult = validateScoreExpr(program.score, scope, options);
  diagnostics.push(...scoreResult.diagnostics);

  return {
    program,
    diagnostics,
    score: scoreResult.score,
  };
}
