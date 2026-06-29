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
  severity: "error" | "warning";
  message: string;
}

export interface WorksheetResultOptions {
  maxResultLength: number;
}

export function isWorksheetPath(fileName: string): boolean {
  return fileName.endsWith(WORKSHEET_SUFFIX);
}

export function stripResultComments(text: string): string {
  return splitLines(text)
    .map((line) => {
      const commentIndex = findLineCommentIndex(line);
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

      return `${line.trimEnd()} // ${RESULT_PREFIX} ${formatResult(result, options.maxResultLength)}`;
    })
    .join("\n");
}

export function instrumentWorksheet(text: string, markerPrefix = createMarkerPrefix()): InstrumentedWorksheet {
  const lines = splitLines(stripResultComments(text));
  const generated: string[] = [];
  const generatedLineToSourceLine: number[] = [];

  let blockDepth = 0;
  let previousContinues = false;
  let pendingDeclaration: { name: string; sourceLine: number } | undefined;
  let pendingExpression: { sourceLine: number } | undefined;

  lines.forEach((line, index) => {
    const sourceLine = index + 1;
    const trimmed = line.trim();
    const statementStart =
      blockDepth === 0 &&
      !previousContinues &&
      isExecutableTopLevelLine(trimmed);
    const declarationName = statementStart ? parseSimpleDeclarationName(trimmed) : undefined;
    const printableExpression = statementStart && !declarationName && isPrintableExpressionLine(line, trimmed);

    if (pendingExpression) {
      generated.push(stripTrailingLineComment(line));
      generatedLineToSourceLine.push(sourceLine);
    } else if (printableExpression && lineContinues(trimmed, 0)) {
      pushMarker(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
      generated.push(`println(${stripTrailingLineComment(line).trimStart()}`);
      generatedLineToSourceLine.push(sourceLine);
      pendingExpression = { sourceLine };
    } else if (printableExpression) {
      pushMarker(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
      pushPrintableExpression(generated, generatedLineToSourceLine, line, sourceLine);
    } else {
      generated.push(line);
      generatedLineToSourceLine.push(sourceLine);
    }

    const nextBlockDepth = Math.max(0, blockDepth + braceDeltaOutsideStrings(line));
    const nextContinues = lineContinues(trimmed, nextBlockDepth);

    if (pendingExpression && nextBlockDepth === 0 && !nextContinues) {
      generated.push(")");
      generatedLineToSourceLine.push(pendingExpression.sourceLine);
      pendingExpression = undefined;
    }

    if (declarationName) {
      if (nextBlockDepth === 0) {
        pushDeclarationResult(generated, generatedLineToSourceLine, markerPrefix, sourceLine, declarationName);
      } else {
        pendingDeclaration = { name: declarationName, sourceLine };
      }
    } else if (pendingDeclaration && nextBlockDepth === 0) {
      pushDeclarationResult(
        generated,
        generatedLineToSourceLine,
        markerPrefix,
        pendingDeclaration.sourceLine,
        pendingDeclaration.name,
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

export function parseKotlinDiagnostics(stderr: string, generatedLineToSourceLine: number[]): WorksheetDiagnostic[] {
  const diagnostics: WorksheetDiagnostic[] = [];
  const diagnosticLine = /^(.+):(\d+):(\d+):\s+(error|warning):\s+(.+)$/;

  for (const line of stderr.replace(/\r\n/g, "\n").split("\n")) {
    const match = diagnosticLine.exec(line);
    if (!match) {
      continue;
    }

    const generatedLine = Number(match[2]);
    const sourceLine = generatedLineToSourceLine[generatedLine - 1] ?? generatedLine;
    diagnostics.push({
      sourceLine,
      sourceColumn: Math.max(1, Number(match[3])),
      severity: match[4] as "error" | "warning",
      message: match[5],
    });
  }

  return diagnostics;
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

function parseSimpleDeclarationName(trimmed: string): string | undefined {
  return /^(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(trimmed)?.[1];
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
  name: string,
): void {
  pushMarker(generated, generatedLineToSourceLine, markerPrefix, sourceLine);
  generated.push(`println(${name})`);
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

function formatResult(result: string, maxResultLength: number): string {
  const compact = result.replace(/\r\n/g, "\n").replace(/\n/g, "\\n").trim();
  if (compact.length <= maxResultLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxResultLength - 3))}...`;
}

function stripTrailingLineComment(line: string): string {
  const commentIndex = findLineCommentIndex(line);
  return commentIndex >= 0 ? line.slice(0, commentIndex).trimEnd() : line;
}

function findLineCommentIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && (inSingle || inDouble)) {
      escaped = true;
      continue;
    }

    if (!inDouble && char === "'") {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && char === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && char === "/" && next === "/") {
      return index;
    }
  }

  return -1;
}

function braceDeltaOutsideStrings(line: string): number {
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (!inSingle && !inDouble && char === "/" && next === "/") {
      break;
    }

    if (char === "\\" && (inSingle || inDouble)) {
      escaped = true;
      continue;
    }

    if (!inDouble && char === "'") {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && char === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (char === "{" || char === "(" || char === "[") {
      delta += 1;
    } else if (char === "}" || char === ")" || char === "]") {
      delta -= 1;
    }
  }

  return delta;
}
