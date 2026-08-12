export const WORKSHEET_SUFFIX = ".worksheet.kts";
export const RESULT_PREFIX = "=>";

export interface InstrumentedWorksheet {
  script: string;
  markerPrefix: string;
  generatedLineToSourceLine: number[];
}

export interface WorksheetRange {
  startLine: number;
  endLine: number;
}

export interface InstrumentWorksheetOptions {
  resultRange?: WorksheetRange;
}

export interface WorksheetOutput {
  results: Map<number, string>;
  runtimeOutput: string;
}

export interface WorksheetDiagnostic {
  sourceLine: number;
  sourceColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface WorksheetResultOptions {
  maxResultLength: number;
}

export function isWorksheetPath(fileName: string): boolean {
  return fileName.endsWith(WORKSHEET_SUFFIX);
}

export function stripResultComments(text: string): string {
  const state = createLexicalState();
  return splitLines(text)
    .map((line) => {
      const scanned = scanKotlinLine(line, state, 0);
      const commentIndex = scanned.lineCommentIndex;
      if (commentIndex < 0) {
        return line;
      }

      const comment = line.slice(commentIndex);
      if (!/^\/\/\s*=>(?:\s|$)/.test(comment)) {
        return line;
      }

      return line.slice(0, commentIndex).trimEnd();
    })
    .join("\n");
}

export function parseWorksheetResults(text: string): Map<number, string> {
  const results = new Map<number, string>();
  const state = createLexicalState();
  splitLines(text).forEach((line, index) => {
    const scanned = scanKotlinLine(line, state, 0);
    if (scanned.lineCommentIndex < 0) {
      return;
    }

    const match = /^\/\/\s*=>\s?(.*)$/.exec(line.slice(scanned.lineCommentIndex));
    if (!match) {
      return;
    }

    const sourceLine = index + 1;
    if (sourceLine > 0 && match[1]) {
      results.set(sourceLine, match[1]);
    }
  });
  return results;
}

export function applyWorksheetResults(
  text: string,
  results: Map<number, string>,
  options: WorksheetResultOptions = { maxResultLength: 500 },
): string {
  return splitLines(stripResultComments(text))
    .map((line, index) => {
      const sourceLine = index + 1;
      const result = results.get(sourceLine);
      if (!result || !line.trim()) {
        return line;
      }

      return `${line.trimEnd()} // ${RESULT_PREFIX} ${formatWorksheetResult(result, options.maxResultLength)}`;
    })
    .join("\n");
}

export function formatWorksheetResult(result: string, maxResultLength = 500): string {
  const compact = compactWorksheetResult(result);
  if (compact.length <= maxResultLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxResultLength - 3))}...`;
}

export function isWorksheetResultTruncated(result: string, maxResultLength = 500): boolean {
  return compactWorksheetResult(result).length > maxResultLength;
}

export function findWorksheetRange(text: string, startLine: number, endLine = startLine): WorksheetRange {
  const lines = scanWorksheetLines(stripResultComments(text));
  const statements = findWorksheetStatementsFromLines(lines);
  const selectedStart = Math.max(1, Math.min(lines.length, Math.min(startLine, endLine)));
  const selectedEnd = Math.max(1, Math.min(lines.length, Math.max(startLine, endLine)));
  const selected = statements.filter((statement) => statement.endLine >= selectedStart && statement.startLine <= selectedEnd);

  if (selected.length === 0) {
    return { startLine: selectedStart, endLine: selectedEnd };
  }

  return {
    startLine: Math.min(...selected.map((statement) => statement.startLine)),
    endLine: Math.max(...selected.map((statement) => statement.endLine)),
  };
}

export function truncateWorksheetSource(text: string, endLine: number): string {
  return splitLines(text).slice(0, Math.max(0, endLine)).join("\n");
}

export function instrumentWorksheet(
  text: string,
  markerPrefix = createMarkerPrefix(),
  options: InstrumentWorksheetOptions = {},
): InstrumentedWorksheet {
  const lines = scanWorksheetLines(stripResultComments(text));
  const generated: string[] = [];
  const generatedLineToSourceLine: number[] = [];
  const functionTypes = collectFunctionTypes(lines);
  const functionNames = collectFunctionNames(lines, functionTypes);

  let blockDepth = 0;
  let previousContinues = false;
  let pendingDeclaration: { expression: string; sourceLine: number; text: string[] } | undefined;
  let pendingFunction: { sourceLine: number; type: string } | undefined;
  let pendingExpression: { sourceLine: number } | undefined;

  lines.forEach((line) => {
    if (options.resultRange && line.sourceLine > options.resultRange.endLine) {
      return;
    }

    const sourceLine = line.sourceLine;
    const trimmed = line.trimmed;
    const statementStart =
      blockDepth === 0 &&
      !previousContinues &&
      isExecutableTopLevelLine(trimmed);
    const functionType = statementStart && trimmed.startsWith("fun ")
      ? functionTypes.get(sourceLine)
      : undefined;
    const declarationExpression = statementStart ? parseDeclarationResultExpression(trimmed) : undefined;
    const printableExpression = statementStart
      && !declarationExpression
      && !functionType
      && isPrintableExpressionLine(line.text, trimmed);

    if (pendingFunction) {
      generated.push(line.text);
      generatedLineToSourceLine.push(sourceLine);
    } else if (pendingExpression) {
      generated.push(stripTrailingLineComment(line.text));
      generatedLineToSourceLine.push(sourceLine);
    } else if (printableExpression && lineContinues(trimmed, line.delimiterDepthAfter)) {
      if (isResultLine(sourceLine, options.resultRange)) {
        pushResultStart(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
      }
      generated.push(`val __kotlinWorksheetValue${sourceLine} = ${stripTrailingLineComment(line.text).trimStart()}`);
      generatedLineToSourceLine.push(sourceLine);
      pendingExpression = { sourceLine };
    } else if (printableExpression) {
      if (isResultLine(sourceLine, options.resultRange)) {
        pushExpressionResult(generated, generatedLineToSourceLine, markerPrefix, line.text, sourceLine);
      } else {
        generated.push(line.text);
        generatedLineToSourceLine.push(sourceLine);
      }
    } else {
      generated.push(line.text);
      generatedLineToSourceLine.push(sourceLine);
    }

    if (functionType && !pendingFunction) {
      pendingFunction = { sourceLine, type: functionType };
    }

    const nextBlockDepth = line.delimiterDepthAfter;
    const nextContinues = line.lexicallyContinued || lineContinues(trimmed, nextBlockDepth);

    if (pendingExpression && nextBlockDepth === 0 && !nextContinues) {
      if (isResultLine(pendingExpression.sourceLine, options.resultRange)) {
        generated.push(`println("${markerPrefix}value:${pendingExpression.sourceLine}")`);
        generatedLineToSourceLine.push(pendingExpression.sourceLine);
        generated.push(`println(__kotlinWorksheetValue${pendingExpression.sourceLine})`);
        generatedLineToSourceLine.push(pendingExpression.sourceLine);
        generated.push(`println("${markerPrefix}end")`);
        generatedLineToSourceLine.push(pendingExpression.sourceLine);
      }
      pendingExpression = undefined;
    }

    if (declarationExpression) {
      if (nextBlockDepth === 0 && !nextContinues) {
        pushDeclarationResult(
          generated,
          generatedLineToSourceLine,
          markerPrefix,
          sourceLine,
          declarationExpression,
          line.text,
          functionTypes,
          functionNames,
          options.resultRange,
        );
      } else {
        pendingDeclaration = { expression: declarationExpression, sourceLine, text: [line.text] };
      }
    } else if (pendingDeclaration && nextBlockDepth === 0 && !nextContinues) {
      pushDeclarationResult(
        generated,
        generatedLineToSourceLine,
        markerPrefix,
        pendingDeclaration.sourceLine,
        pendingDeclaration.expression,
        [...pendingDeclaration.text, line.text].join("\n"),
        functionTypes,
        functionNames,
        options.resultRange,
      );
      pendingDeclaration = undefined;
    } else if (pendingDeclaration) {
      pendingDeclaration.text.push(line.text);
    }

    if (pendingFunction && nextBlockDepth === 0 && !nextContinues) {
      if (isResultLine(pendingFunction.sourceLine, options.resultRange)) {
        pushStaticResult(generated, generatedLineToSourceLine, markerPrefix, pendingFunction.sourceLine, pendingFunction.type);
      }
      pendingFunction = undefined;
    }

    blockDepth = nextBlockDepth;
    previousContinues = nextContinues;
  });

  return {
    script: generated.join("\n"),
    markerPrefix,
    generatedLineToSourceLine,
  };
}

export function parseWorksheetOutput(stdout: string, markerPrefix: string): Map<number, string> {
  const parsed = parseWorksheetOutputDetails(stdout, markerPrefix).results;
  if (parsed.size > 0 || stdout.includes(`${markerPrefix}start:`)) {
    return parsed;
  }

  const legacyResults = new Map<number, string>();
  let currentLine: number | undefined;
  let output: string[] = [];
  const flush = () => {
    if (currentLine !== undefined && output.join("\n").trimEnd()) {
      legacyResults.set(currentLine, output.join("\n").trimEnd());
    }
    output = [];
  };
  for (const rawLine of stdout.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith(markerPrefix)) {
      flush();
      const parsedLine = Number(line.slice(markerPrefix.length));
      currentLine = Number.isInteger(parsedLine) ? parsedLine : undefined;
    } else if (currentLine !== undefined) {
      output.push(rawLine);
    }
  }
  flush();
  return legacyResults;
}

export function parseWorksheetOutputDetails(stdout: string, markerPrefix: string): WorksheetOutput {
  const results = new Map<number, string>();
  const runtimeOutput: string[] = [];
  let currentLine: number | undefined;
  let mode: "runtime" | "value" | undefined;
  let valueOutput: string[] = [];

  for (const rawLine of stdout.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line === `${markerPrefix}end`) {
      if (currentLine !== undefined && mode === "value" && valueOutput.length > 0) {
        results.set(currentLine, valueOutput.join("\n").trimEnd());
      }
      currentLine = undefined;
      mode = undefined;
      valueOutput = [];
      continue;
    }

    if (line.startsWith(`${markerPrefix}start:`)) {
      const parsed = Number(line.slice(`${markerPrefix}start:`.length));
      currentLine = Number.isInteger(parsed) ? parsed : undefined;
      mode = "runtime";
      valueOutput = [];
      continue;
    }

    if (line.startsWith(`${markerPrefix}value:`)) {
      if (currentLine !== undefined && valueOutput.length > 0) {
        results.set(currentLine, valueOutput.join("\n").trimEnd());
      }
      valueOutput = [];
      mode = "value";
      continue;
    }

    if (currentLine !== undefined && mode === "value") {
      valueOutput.push(rawLine);
    } else if (currentLine !== undefined && mode === "runtime") {
      runtimeOutput.push(rawLine);
    } else {
      runtimeOutput.push(rawLine);
    }
  }

  if (currentLine !== undefined && mode === "value" && valueOutput.length > 0) {
    results.set(currentLine, valueOutput.join("\n").trimEnd());
  }
  return { results, runtimeOutput: runtimeOutput.join("\n") };
}

export function stripWorksheetMarkers(stdout: string, markerPrefix: string): string {
  return stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith(markerPrefix))
    .join("\n");
}

export function parseKotlinDiagnostics(stderr: string, generatedLineToSourceLine: number[]): WorksheetDiagnostic[] {
  const diagnostics: WorksheetDiagnostic[] = [];
  const diagnosticLine = /^(?:(e|w|i):\s*)?(.+?)(?::(\d+):(\d+)|:\s*\((\d+),\s*(\d+)\)):\s*(?:(error|warning|info):\s*)?(.+)$/;

  for (const line of stderr.replace(/\r\n/g, "\n").split("\n")) {
    const match = diagnosticLine.exec(line);
    if (!match) {
      continue;
    }

    const generatedLine = Number(match[3] ?? match[5]);
    const sourceLine = generatedLineToSourceLine[generatedLine - 1] ?? generatedLine;
    const prefixSeverity = match[1] === "w" ? "warning" : match[1] === "i" ? "info" : "error";
    const severity = (match[7] as WorksheetDiagnostic["severity"] | undefined) ?? prefixSeverity;
    diagnostics.push({
      sourceLine,
      sourceColumn: Math.max(1, Number(match[4] ?? match[6])),
      severity,
      message: match[8],
    });
  }

  return diagnostics;
}

function compactWorksheetResult(result: string): string {
  return result.replace(/\r\n/g, "\n").replace(/\n/g, "\\n").trim();
}

function createMarkerPrefix(): string {
  return `__KOTLIN_WORKSHEET_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}__:`;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function isExecutableTopLevelLine(trimmed: string): boolean {
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return false;
  }

  if (trimmed.startsWith("package ") || trimmed.startsWith("import ")) {
    return false;
  }

  if (trimmed.startsWith(".") || trimmed.startsWith(")") || trimmed.startsWith("]") || trimmed.startsWith("}")) {
    return false;
  }

  return true;
}

export type WorksheetStatement = WorksheetRange;

export function findWorksheetStatements(textOrLines: string | string[]): WorksheetStatement[] {
  const lines = Array.isArray(textOrLines)
    ? scanWorksheetLines(textOrLines.join("\n"))
    : scanWorksheetLines(stripResultComments(textOrLines));
  return findWorksheetStatementsFromLines(lines);
}

function parseDeclarationResultExpression(trimmed: string): string | undefined {
  const simpleName = /^(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(trimmed)?.[1];
  if (simpleName) {
    return simpleName;
  }

  const destructuredNames = /^(?:val|var)\s+\(([^()]*)\)\s*(?::[^=]+)?=/.exec(trimmed)?.[1]
    ?.split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "_");
  if (!destructuredNames?.length || destructuredNames.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    return undefined;
  }

  return `listOf(${destructuredNames.join(", ")})`;
}

function findWorksheetStatementsFromLines(lines: WorksheetLine[]): WorksheetStatement[] {
  const statements: WorksheetStatement[] = [];
  let startLine: number | undefined;
  let blockDepth = 0;
  let previousContinues = false;

  lines.forEach((line) => {
    const statementStart =
      blockDepth === 0
      && !previousContinues
      && isExecutableTopLevelLine(line.trimmed);

    if (statementStart) {
      startLine = line.sourceLine;
    }

    const nextBlockDepth = line.delimiterDepthAfter;
    const nextContinues = line.lexicallyContinued || lineContinues(line.trimmed, nextBlockDepth);
    if (startLine !== undefined && nextBlockDepth === 0 && !nextContinues) {
      statements.push({ startLine, endLine: line.sourceLine });
      startLine = undefined;
    }

    blockDepth = nextBlockDepth;
    previousContinues = nextContinues;
  });

  if (startLine !== undefined) {
    statements.push({ startLine, endLine: lines.length });
  }

  return statements;
}

function collectFunctionTypes(lines: WorksheetLine[]): Map<number, string> {
  const functionTypes = new Map<number, string>();
  const statements = findWorksheetStatementsFromLines(lines);

  for (const statement of statements) {
    const firstLine = lines[statement.startLine - 1];
    if (!firstLine?.trimmed.startsWith("fun ")) {
      continue;
    }

    const declaration = lines
      .slice(statement.startLine - 1, statement.endLine)
      .map((line) => line.trimmed)
      .join(" ");
    const functionType = parseFunctionType(declaration);
    if (functionType) {
      functionTypes.set(statement.startLine, functionType);
    }
  }

  return functionTypes;
}

function collectFunctionNames(lines: WorksheetLine[], functionTypes: Map<number, string>): Map<string, string> {
  const names = new Map<string, string>();
  for (const [line, type] of functionTypes) {
    const name = /^fun\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[line - 1]?.trimmed)?.[1];
    if (name) {
      names.set(name, type);
    }
  }
  return names;
}

function parseFunctionType(declaration: string): string | undefined {
  const signature = declaration
    .replace(/^fun\s+\w+(?:\s*<[^>]+>)?\s*/, "")
    .split(/\s*(?:=|\{)\s*/, 1)[0]
    .trim();
  const openParen = signature.indexOf("(");
  if (openParen < 0) {
    return undefined;
  }

  const closeParen = findMatchingDelimiter(signature, openParen, "(", ")");
  if (closeParen < 0) {
    return undefined;
  }

  const parameters = splitTopLevel(signature.slice(openParen + 1, closeParen))
    .map((parameter) => parameter.trim())
    .filter(Boolean)
    .map((parameter) => parameter.replace(/^(?:vararg\s+|crossinline\s+|noinline\s+)/, ""))
    .map((parameter) => parameter.slice(parameter.indexOf(":") + 1).trim())
    .filter((parameter) => parameter.length > 0);
  const returnType = signature.slice(closeParen + 1).replace(/^\s*:\s*/, "").trim();
  if (!returnType || (signature.slice(openParen + 1, closeParen).trim() && parameters.length === 0)) {
    return undefined;
  }

  return `(${parameters.map(formatFunctionParameterType).join(", ")}) -> ${returnType}`;
}

function findMatchingDelimiter(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) {
      depth += 1;
    } else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if ("(<[{".includes(text[index])) {
      depth += 1;
    } else if (">)]}".includes(text[index])) {
      depth = Math.max(0, depth - 1);
    } else if (text[index] === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function formatFunctionParameterType(type: string): string {
  return type.includes("->") ? `(${type})` : type;
}

function inferDeclarationFunctionType(
  declaration: string,
  functionNames: Map<string, string>,
): string | undefined {
  const declaredType = /^val\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*(\([^=]+\)\s*->\s*.+?)\s*=/.exec(declaration)?.[1];
  if (declaredType) {
    return declaredType.replace(/\s+/g, " ").trim();
  }

  const initializer = declaration.split("=").slice(1).join("=").trim();
  if (!initializer) {
    return undefined;
  }

  const functionReference = /^::([A-Za-z_][A-Za-z0-9_]*)/.exec(initializer)?.[1];
  if (functionReference) {
    return functionNames.get(functionReference);
  }

  const lambda = /^\{([\s\S]*)\}$/.exec(initializer);
  if (!lambda) {
    return undefined;
  }

  const arrow = lambda[1].indexOf("->");
  const parameters = arrow < 0 ? "" : lambda[1].slice(0, arrow).trim();
  const body = (arrow < 0 ? lambda[1] : lambda[1].slice(arrow + 2)).trim();
  const parameterTypes = splitTopLevel(parameters)
    .filter(Boolean)
    .map((parameter) => parameter.includes(":") ? parameter.slice(parameter.indexOf(":") + 1).trim() : undefined);
  if (parameterTypes.some((type) => !type)) {
    return undefined;
  }
  const returnType = body.endsWith(".toString()") ? "String" : inferCalledFunctionReturnType(body, functionNames);
  if (!returnType) {
    return undefined;
  }
  return `(${parameterTypes.join(", ")}) -> ${returnType}`;
}

function inferCalledFunctionReturnType(body: string, functionNames: Map<string, string>): string | undefined {
  const functionName = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(body)?.[1];
  if (!functionName) {
    return undefined;
  }
  const matchingType = functionNames.get(functionName);
  return matchingType?.split(" -> ").slice(1).join(" -> ");
}

function isResultLine(sourceLine: number, range?: WorksheetRange): boolean {
  return !range || (sourceLine >= range.startLine && sourceLine <= range.endLine);
}

interface WorksheetLine {
  text: string;
  trimmed: string;
  sourceLine: number;
  delimiterDepthAfter: number;
  lexicallyContinued: boolean;
}

interface LexicalState {
  blockCommentDepth: number;
  quote: "none" | "single" | "double" | "triple";
  escaped: boolean;
}

interface ScannedLine {
  lineCommentIndex: number;
  delimiterDepth: number;
  code: string;
}

function scanWorksheetLines(text: string): WorksheetLine[] {
  const state = createLexicalState();
  let delimiterDepth = 0;

  return splitLines(text).map((line, index) => {
    const scanned = scanKotlinLine(line, state, delimiterDepth);
    delimiterDepth = Math.max(0, scanned.delimiterDepth);
    return {
      text: line,
      trimmed: scanned.code.trim(),
      sourceLine: index + 1,
      delimiterDepthAfter: delimiterDepth,
      lexicallyContinued: state.blockCommentDepth > 0 || state.quote !== "none",
    };
  });
}

function createLexicalState(): LexicalState {
  return { blockCommentDepth: 0, quote: "none", escaped: false };
}

function scanKotlinLine(line: string, state: LexicalState, initialDepth: number): ScannedLine {
  let delimiterDepth = initialDepth;
  let lineCommentIndex = -1;
  const code = line.split("");

  const mask = (index: number) => {
    code[index] = " ";
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    const nextNext = line[index + 2];

    if (state.blockCommentDepth > 0) {
      mask(index);
      if (char === "/" && next === "*") {
        mask(index + 1);
        state.blockCommentDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        mask(index + 1);
        state.blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }

    if (state.quote === "triple") {
      if (char === '"' && next === '"' && nextNext === '"') {
        state.quote = "none";
        index += 2;
      }
      continue;
    }

    if (state.quote === "double") {
      if (state.escaped) {
        state.escaped = false;
      } else if (char === "\\") {
        state.escaped = true;
      } else if (char === '"') {
        state.quote = "none";
      }
      continue;
    }

    if (state.quote === "single") {
      if (state.escaped) {
        state.escaped = false;
      } else if (char === "\\") {
        state.escaped = true;
      } else if (char === "'") {
        state.quote = "none";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineCommentIndex = index;
      for (let commentIndex = index; commentIndex < line.length; commentIndex += 1) {
        mask(commentIndex);
      }
      break;
    }

    if (char === "/" && next === "*") {
      mask(index);
      mask(index + 1);
      state.blockCommentDepth = 1;
      index += 1;
      continue;
    }

    if (char === '"' && next === '"' && nextNext === '"') {
      state.quote = "triple";
      index += 2;
      continue;
    }

    if (char === '"') {
      state.quote = "double";
      continue;
    }

    if (char === "'") {
      state.quote = "single";
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      delimiterDepth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      delimiterDepth -= 1;
    }
  }

  return { lineCommentIndex, delimiterDepth, code: code.join("") };
}

function isPrintableExpressionLine(line: string, trimmed: string): boolean {
  if (/^(?:val|var|fun|class|object|interface|enum|typealias|annotation)\b/.test(trimmed)) {
    return false;
  }

  if (/^(?:for|while|do|return|break|continue)\b/.test(trimmed)) {
    return false;
  }

  if (/^[A-Za-z_][A-Za-z0-9_.]*\s*(?:[+\-*/%]?=|\+\+|--)/.test(trimmed)) {
    return false;
  }

  return true;
}

function pushDeclarationResult(
  generated: string[],
  generatedLineToSourceLine: number[],
  markerPrefix: string,
  sourceLine: number,
  expression: string,
  declarationText: string,
  functionTypes: Map<number, string>,
  functionNames: Map<string, string>,
  resultRange?: WorksheetRange,
): void {
  if (!isResultLine(sourceLine, resultRange)) {
    return;
  }

  const staticType = functionTypes.get(sourceLine)
    ?? inferDeclarationFunctionType(declarationText, functionNames);
  if (staticType) {
    pushStaticResult(generated, generatedLineToSourceLine, markerPrefix, sourceLine, staticType);
    return;
  }

  pushDeclarationValueResult(generated, generatedLineToSourceLine, markerPrefix, expression, sourceLine);
}

function pushDeclarationValueResult(
  generated: string[],
  generatedLineToSourceLine: number[],
  markerPrefix: string,
  expression: string,
  sourceLine: number,
): void {
  generated.push(`println("${markerPrefix}start:${sourceLine}")`);
  generated.push(`println("${markerPrefix}value:${sourceLine}")`);
  generated.push(`println(${expression})`);
  generated.push(`println("${markerPrefix}end")`);
  generatedLineToSourceLine.push(sourceLine, sourceLine, sourceLine, sourceLine);
}

function pushExpressionResult(
  generated: string[],
  generatedLineToSourceLine: number[],
  markerPrefix: string,
  line: string,
  sourceLine: number,
): void {
  const trimmed = line.trim();
  if (/^(?:print|println)\s*\(/.test(trimmed)) {
    generated.push(line);
    generatedLineToSourceLine.push(sourceLine);
    return;
  }

  const expression = stripTrailingLineComment(line).trim();
  generated.push(`println("${markerPrefix}start:${sourceLine}")`);
  generated.push(`val __kotlinWorksheetValue${sourceLine} = ${expression}`);
  generated.push(`println("${markerPrefix}value:${sourceLine}")`);
  generated.push(`println(__kotlinWorksheetValue${sourceLine})`);
  generated.push(`println("${markerPrefix}end")`);
  generatedLineToSourceLine.push(sourceLine, sourceLine, sourceLine, sourceLine, sourceLine);
}

function pushResultStart(generated: string[], generatedLineToSourceLine: number[], markerPrefix: string, sourceLine: number): void {
  generated.push(`println("${markerPrefix}start:${sourceLine}")`);
  generatedLineToSourceLine.push(sourceLine);
}

function pushStaticResult(
  generated: string[],
  generatedLineToSourceLine: number[],
  markerPrefix: string,
  sourceLine: number,
  result: string,
): void {
  generated.push(`println("${markerPrefix}start:${sourceLine}")`);
  generated.push(`println("${markerPrefix}value:${sourceLine}")`);
  generated.push(`println(${JSON.stringify(result)})`);
  generated.push(`println("${markerPrefix}end")`);
  generatedLineToSourceLine.push(sourceLine, sourceLine, sourceLine, sourceLine);
}

function lineContinues(trimmed: string, blockDepth: number): boolean {
  if (!trimmed || blockDepth > 0) {
    return blockDepth > 0;
  }

  return /[({[,:=+\-*/%&|?.]$/.test(trimmed) || trimmed.endsWith("->");
}

function stripTrailingLineComment(line: string): string {
  const commentIndex = findLineCommentIndex(line);
  return commentIndex >= 0 ? line.slice(0, commentIndex).trimEnd() : line;
}

function findLineCommentIndex(line: string): number {
  return scanKotlinLine(line, createLexicalState(), 0).lineCommentIndex;
}
