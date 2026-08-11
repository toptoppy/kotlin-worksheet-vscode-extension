export const WORKSHEET_SUFFIX = ".worksheet.kts";
export const RESULT_PREFIX = "=>";

export interface InstrumentedWorksheet {
  script: string;
  markerPrefix: string;
  generatedLineToSourceLine: number[];
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

export function instrumentWorksheet(text: string, markerPrefix = createMarkerPrefix()): InstrumentedWorksheet {
  const lines = scanWorksheetLines(stripResultComments(text));
  const generated: string[] = [];
  const generatedLineToSourceLine: number[] = [];

  let blockDepth = 0;
  let previousContinues = false;
  let pendingDeclaration: { expression: string; sourceLine: number } | undefined;
  let pendingExpression: { sourceLine: number } | undefined;

  lines.forEach((line) => {
    const sourceLine = line.sourceLine;
    const trimmed = line.trimmed;
    const statementStart =
      blockDepth === 0 &&
      !previousContinues &&
      isExecutableTopLevelLine(trimmed);
    const declarationExpression = statementStart ? parseDeclarationResultExpression(trimmed) : undefined;
    const printableExpression = statementStart && !declarationExpression && isPrintableExpressionLine(line.text, trimmed);

    if (pendingExpression) {
      generated.push(stripTrailingLineComment(line.text));
      generatedLineToSourceLine.push(sourceLine);
    } else if (printableExpression && lineContinues(trimmed, line.delimiterDepthAfter)) {
      pushMarker(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
      generated.push(`println(${stripTrailingLineComment(line.text).trimStart()}`);
      generatedLineToSourceLine.push(sourceLine);
      pendingExpression = { sourceLine };
    } else if (printableExpression) {
      pushMarker(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
      pushPrintableExpression(generated, generatedLineToSourceLine, line.text, sourceLine);
    } else {
      generated.push(line.text);
      generatedLineToSourceLine.push(sourceLine);
    }

    const nextBlockDepth = line.delimiterDepthAfter;
    const nextContinues = line.lexicallyContinued || lineContinues(trimmed, nextBlockDepth);

    if (pendingExpression && nextBlockDepth === 0 && !nextContinues) {
      generated.push(")");
      generatedLineToSourceLine.push(pendingExpression.sourceLine);
      pendingExpression = undefined;
    }

    if (declarationExpression) {
      if (nextBlockDepth === 0 && !nextContinues) {
        pushDeclarationResult(generated, generatedLineToSourceLine, markerPrefix, sourceLine, declarationExpression);
      } else {
        pendingDeclaration = { expression: declarationExpression, sourceLine };
      }
    } else if (pendingDeclaration && nextBlockDepth === 0 && !nextContinues) {
      pushDeclarationResult(
        generated,
        generatedLineToSourceLine,
        markerPrefix,
        pendingDeclaration.sourceLine,
        pendingDeclaration.expression,
      );
      pendingDeclaration = undefined;
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
  const results = new Map<number, string>();
  let currentLine: number | undefined;
  let currentOutput: string[] = [];

  const flush = () => {
    if (currentLine === undefined) {
      currentOutput = [];
      return;
    }

    const output = currentOutput.join("\n").trimEnd();
    if (output.length > 0) {
      results.set(currentLine, output);
    }
    currentOutput = [];
  };

  for (const rawLine of stdout.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith(markerPrefix)) {
      flush();
      const parsed = Number(line.slice(markerPrefix.length));
      currentLine = Number.isInteger(parsed) ? parsed : undefined;
      continue;
    }

    if (currentLine !== undefined) {
      currentOutput.push(rawLine);
    }
  }

  flush();
  return results;
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

function pushMarker(generated: string[], generatedLineToSourceLine: number[], markerPrefix: string, sourceLine: number): void {
  generated.push(`println("${markerPrefix}${sourceLine}")`);
  generatedLineToSourceLine.push(sourceLine);
}

function pushDeclarationResult(
  generated: string[],
  generatedLineToSourceLine: number[],
  markerPrefix: string,
  sourceLine: number,
  expression: string,
): void {
  pushMarker(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
  generated.push(`println(${expression})`);
  generatedLineToSourceLine.push(sourceLine);
}

function pushPrintableExpression(
  generated: string[],
  generatedLineToSourceLine: number[],
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
  generated.push(`println(${expression})`);
  generatedLineToSourceLine.push(sourceLine);
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
