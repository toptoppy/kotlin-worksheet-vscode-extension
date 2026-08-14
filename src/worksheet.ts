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
  const functionContext = collectFunctionContext(lines);
  const { functionTypes } = functionContext;

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
    const functionType = statementStart && isFunctionDeclaration(trimmed)
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
          functionContext,
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
        functionContext,
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

interface FunctionContext {
  functionTypes: Map<number, string>;
  functionNames: Map<string, string>;
  variableFunctionTypes: Map<string, string>;
  variableTypes: Map<string, string>;
  classFunctionTypes: Map<string, string>;
  constructorTypes: Map<string, string>;
  memberFunctionTypes: Map<string, string>;
}

function collectFunctionContext(lines: WorksheetLine[]): FunctionContext {
  const functionTypes = collectFunctionTypes(lines);
  const functionNames = collectFunctionNames(lines, functionTypes);
  const classMetadata = collectClassMetadata(lines);
  const context: FunctionContext = {
    functionTypes,
    functionNames,
    variableFunctionTypes: new Map(),
    variableTypes: new Map(),
    ...classMetadata,
  };

  for (const statement of findWorksheetStatementsFromLines(lines)) {
    const declaration = lines
      .slice(statement.startLine - 1, statement.endLine)
      .map((line) => line.trimmed)
      .join(" ");
    const name = /^(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(declaration)?.[1];
    if (!name) {
      continue;
    }

    const type = parseDeclaredType(declaration);
    if (type) {
      context.variableTypes.set(name, type);
    }
    const constructor = /^([A-Z][A-Za-z0-9_]*)\s*\(/.exec(parseDeclarationInitializer(declaration) ?? "")?.[1];
    if (constructor && !type) {
      context.variableTypes.set(name, constructor);
    }

    const functionType = inferDeclarationFunctionType(declaration, context);
    if (functionType) {
      context.variableFunctionTypes.set(name, functionType);
    }
  }

  return context;
}

function collectFunctionTypes(lines: WorksheetLine[]): Map<number, string> {
  const functionTypes = new Map<number, string>();
  const statements = findWorksheetStatementsFromLines(lines);

  for (const statement of statements) {
    const firstLine = lines[statement.startLine - 1];
    if (!firstLine || !isFunctionDeclaration(firstLine.trimmed)) {
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
    const name = parseFunctionName(lines[line - 1]?.trimmed);
    if (name) {
      names.set(name, type);
    }
  }
  return names;
}

function parseFunctionType(declaration: string): string | undefined {
  const funIndex = declaration.search(/\bfun\b/);
  if (funIndex < 0) {
    return undefined;
  }

  let signature = declaration.slice(funIndex + 3).trim();
  if (signature.startsWith("<")) {
    const genericEnd = findMatchingAngleDelimiter(signature, 0);
    if (genericEnd < 0) {
      return undefined;
    }
    signature = signature.slice(genericEnd + 1).trim();
  }

  const bodyStart = findTopLevelBodyStart(signature);
  if (bodyStart >= 0) {
    signature = signature.slice(0, bodyStart).trim();
  }

  const openParen = signature.indexOf("(");
  if (openParen < 0) {
    return undefined;
  }

  const closeParen = findMatchingDelimiter(signature, openParen, "(", ")");
  if (closeParen < 0) {
    return undefined;
  }

  const parameterText = signature.slice(openParen + 1, closeParen);
  const parameters = splitTopLevel(parameterText)
    .map(parseParameterType)
    .filter((parameter): parameter is string => Boolean(parameter));
  if (parameterText.trim() && parameters.length !== splitTopLevel(parameterText).filter(Boolean).length) {
    return undefined;
  }

  const returnType = canonicalizeTypeText(signature.slice(closeParen + 1).replace(/^\s*:\s*/, ""));
  if (!returnType) {
    return undefined;
  }

  const beforeParameters = signature.slice(0, openParen).trim();
  const receiverEnd = beforeParameters.lastIndexOf(".");
  const receiver = receiverEnd >= 0 ? normalizeTypeText(beforeParameters.slice(0, receiverEnd)) : "";
  const isSuspend = /\bsuspend\s+fun\b/.test(declaration.slice(0, funIndex + 3));
  return canonicalizeTypeText(`${isSuspend ? "suspend " : ""}${receiver ? `${receiver}.` : ""}(${parameters.join(", ")}) -> ${returnType}`);
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
      if (text[index] === ">" && text[index - 1] === "-") {
        continue;
      }
      depth = Math.max(0, depth - 1);
    } else if (text[index] === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseParameterType(parameter: string): string | undefined {
  const withoutModifiers = parameter.trim().replace(/^(?:vararg|crossinline|noinline)\s+/, "");
  const colon = findTopLevelCharacter(withoutModifiers, ":");
  if (colon < 0) {
    return undefined;
  }

  const type = withoutModifiers.slice(colon + 1);
  const defaultValue = findTopLevelCharacter(type, "=");
  return normalizeTypeText((defaultValue >= 0 ? type.slice(0, defaultValue) : type).trim());
}

function inferDeclarationFunctionType(declaration: string, context: FunctionContext): string | undefined {
  const declaredType = parseDeclaredFunctionType(declaration);
  const initializer = parseDeclarationInitializer(declaration);
  if (!initializer || initializer === "null") {
    return undefined;
  }

  if (parseDeclaredType(declaration) && !declaredType) {
    return undefined;
  }

  if (declaredType && isFunctionValueInitializer(initializer, context)) {
    return declaredType;
  }

  const callableReference = resolveCallableReference(initializer, context);
  if (callableReference) {
    return callableReference;
  }

  if (/^(?:suspend\s+)?fun\s*(?:<[^>]+>\s*)?\(/.test(initializer)) {
    return parseFunctionType(initializer);
  }

  const cast = /\bas\s+(.+)$/.exec(initializer)?.[1];
  if (cast && isFunctionTypeText(cast)) {
    return canonicalizeTypeText(cast);
  }

  const variable = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(initializer)?.[1];
  if (variable) {
    return context.variableFunctionTypes.get(variable) ?? context.functionNames.get(variable);
  }

  const constructor = /^([A-Z][A-Za-z0-9_]*)\s*\(/.exec(initializer)?.[1];
  if (constructor) {
    return context.classFunctionTypes.get(constructor);
  }

  const functionCall = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(initializer)?.[1];
  if (functionCall) {
    const returnType = functionTypeReturn(context.functionNames.get(functionCall) ?? "");
    return returnType && isFunctionTypeText(returnType) ? returnType : undefined;
  }

  return inferLambdaFunctionType(initializer, context);
}

function inferCalledFunctionReturnType(
  body: string,
  functionNames: Map<string, string>,
  parameterTypes: Map<string, string> = new Map(),
): string | undefined {
  const functionName = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(body)?.[1];
  if (!functionName) {
    return undefined;
  }
  const matchingType = parameterTypes.get(functionName) ?? functionNames.get(functionName);
  return matchingType ? functionTypeReturn(matchingType) : undefined;
}

function collectClassMetadata(lines: WorksheetLine[]): Pick<
  FunctionContext,
  "classFunctionTypes" | "constructorTypes" | "memberFunctionTypes"
> {
  const classFunctionTypes = new Map<string, string>();
  const constructorTypes = new Map<string, string>();
  const memberFunctionTypes = new Map<string, string>();

  for (const statement of findWorksheetStatementsFromLines(lines)) {
    const declaration = lines
      .slice(statement.startLine - 1, statement.endLine)
      .map((line) => line.trimmed)
      .join(" ");
    const className = /^(?:(?:data|sealed|open|abstract|private|internal|public)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(declaration)?.[1];
    if (!className) {
      continue;
    }

    const headerEnd = findTopLevelCharacter(declaration, "{");
    const header = headerEnd >= 0 ? declaration.slice(0, headerEnd) : declaration;
    const constructorStart = header.indexOf("(");
    if (constructorStart >= 0) {
      const constructorEnd = findMatchingDelimiter(header, constructorStart, "(", ")");
      if (constructorEnd >= 0) {
        const parameters = splitTopLevel(header.slice(constructorStart + 1, constructorEnd))
          .map(parseParameterType)
          .filter((parameter): parameter is string => Boolean(parameter));
        const parameterCount = splitTopLevel(header.slice(constructorStart + 1, constructorEnd)).filter(Boolean).length;
        if (parameters.length === parameterCount) {
          constructorTypes.set(className, `(${parameters.join(", ")}) -> ${className}`);
        }
      }
    }

    const inheritanceStart = findTopLevelCharacter(header, ":");
    if (inheritanceStart >= 0) {
      const superType = normalizeTypeText(header.slice(inheritanceStart + 1));
      if (isFunctionTypeText(superType)) {
        classFunctionTypes.set(className, superType);
      }
    }

    const functionPattern = /\bfun\b/g;
    let match: RegExpExecArray | null;
    while ((match = functionPattern.exec(declaration))) {
      const candidate = declaration.slice(match.index);
      if (!isFunctionDeclaration(candidate)) {
        continue;
      }
      const name = parseFunctionName(candidate);
      const type = parseFunctionType(candidate);
      if (name && type) {
        memberFunctionTypes.set(`${className}.${name}`, type);
      }
    }
  }

  return { classFunctionTypes, constructorTypes, memberFunctionTypes };
}

function isFunctionDeclaration(text: string): boolean {
  return /^(?:(?:public|private|protected|internal|inline|infix|operator|tailrec|external|suspend|expect|actual|override|open|final)\s+)*fun\s+(?!interface\b)/.test(text.trim());
}

function parseFunctionName(text: string | undefined): string | undefined {
  if (!text || !isFunctionDeclaration(text)) {
    return undefined;
  }
  return /\bfun\s+(?:<[^>]+>\s*)?([A-Za-z_][A-Za-z0-9_]*)/.exec(text.trim())?.[1];
}

function parseDeclaredType(declaration: string): string | undefined {
  const equals = findTopLevelCharacter(declaration, "=");
  const left = equals >= 0 ? declaration.slice(0, equals) : declaration;
  return /^(?:val|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*(.+)$/.exec(left.trim())?.[1]
    ? normalizeTypeText(/^(?:val|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*(.+)$/.exec(left.trim())![1])
    : undefined;
}

function parseDeclaredFunctionType(declaration: string): string | undefined {
  const declaredType = parseDeclaredType(declaration);
  return declaredType && isFunctionTypeText(declaredType) ? canonicalizeTypeText(declaredType) : undefined;
}

function parseDeclarationInitializer(declaration: string): string | undefined {
  const equals = findTopLevelCharacter(declaration, "=");
  return equals >= 0 ? declaration.slice(equals + 1).trim() : undefined;
}

function isFunctionValueInitializer(initializer: string, context: FunctionContext): boolean {
  if (initializer === "null") {
    return false;
  }
  if (/^(?:suspend\s+)?fun\s*(?:<[^>]+>\s*)?\(/.test(initializer) || /^\{[\s\S]*\}$/.test(initializer)) {
    return true;
  }
  if (resolveCallableReference(initializer, context)) {
    return true;
  }
  if (/\bas\s+(.+)$/.test(initializer) && isFunctionTypeText(/\bas\s+(.+)$/.exec(initializer)![1])) {
    return true;
  }
  const variable = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(initializer)?.[1];
  if (variable && context.variableFunctionTypes.has(variable)) {
    return true;
  }
  const functionName = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(initializer)?.[1];
  const returnType = functionName ? functionTypeReturn(context.functionNames.get(functionName) ?? "") : undefined;
  return Boolean(returnType && isFunctionTypeText(returnType));
}

function resolveCallableReference(initializer: string, context: FunctionContext): string | undefined {
  const bareName = /^::([A-Za-z_][A-Za-z0-9_]*)$/.exec(initializer)?.[1];
  if (bareName) {
    return context.functionNames.get(bareName) ?? context.constructorTypes.get(bareName);
  }

  const qualified = /^([A-Za-z_][A-Za-z0-9_.]*)::([A-Za-z_][A-Za-z0-9_]*)$/.exec(initializer);
  if (!qualified) {
    return undefined;
  }

  const receiver = qualified[1];
  const member = context.memberFunctionTypes.get(`${receiver}.${qualified[2]}`);
  if (!member) {
    const receiverType = context.variableTypes.get(receiver);
    const boundMember = receiverType
      ? context.memberFunctionTypes.get(`${receiverType}.${qualified[2]}`)
      : undefined;
    return boundMember;
  }

  return prependFunctionReceiver(receiver, member);
}

function prependFunctionReceiver(receiver: string, functionType: string): string | undefined {
  const suspend = functionType.startsWith("suspend ") ? "suspend " : "";
  const type = suspend ? functionType.slice("suspend ".length) : functionType;
  const arrow = findTopLevelArrow(type);
  if (arrow < 0) {
    return undefined;
  }
  const parameters = type.slice(0, arrow).trim();
  const returnType = type.slice(arrow + 2).trim();
  const open = parameters.indexOf("(");
  const close = open >= 0 ? findMatchingDelimiter(parameters, open, "(", ")") : -1;
  if (open < 0 || close < 0) {
    return undefined;
  }
  const parameterText = parameters.slice(open + 1, close).trim();
  return `${suspend}(${receiver}${parameterText ? `, ${parameterText}` : ""}) -> ${returnType}`;
}

function inferLambdaFunctionType(initializer: string, context: FunctionContext): string | undefined {
  const lambda = /^\{([\s\S]*)\}$/.exec(initializer);
  if (!lambda) {
    return undefined;
  }

  const arrow = findLastTopLevelArrow(lambda[1]);
  const parameterText = arrow < 0 ? "" : lambda[1].slice(0, arrow).trim();
  const body = (arrow < 0 ? lambda[1] : lambda[1].slice(arrow + 2)).trim();
  const parameters = splitTopLevel(parameterText).filter(Boolean);
  const parameterTypes = parameters.map(parseParameterType);
  if (parameterTypes.some((type) => !type)) {
    return undefined;
  }

  const parameterNames = new Map<string, string>();
  parameters.forEach((parameter, index) => {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(parameter.trim())?.[1];
    const type = parameterTypes[index];
    if (name && type) {
      parameterNames.set(name, type);
    }
  });
  const returnType = inferLambdaReturnType(body, context, parameterNames);
  return returnType ? canonicalizeTypeText(`(${parameterTypes.join(", ")}) -> ${returnType}`) : undefined;
}

function inferLambdaReturnType(
  body: string,
  context: FunctionContext,
  parameterTypes: Map<string, string>,
): string | undefined {
  const trimmed = body.trim();
  if (/^\{[\s\S]*\}$/.test(trimmed)) {
    return inferLambdaFunctionType(trimmed, context);
  }

  const returns = [...trimmed.matchAll(/\breturn\s+([^\n}]+)/g)].map((match) => match[1].trim());
  if (returns.length > 0) {
    return inferExpressionType(returns[returns.length - 1], context, parameterTypes);
  }
  return inferExpressionType(trimmed, context, parameterTypes);
}

function inferExpressionType(
  expression: string,
  context: FunctionContext,
  parameterTypes: Map<string, string>,
): string | undefined {
  const trimmed = expression.trim().replace(/;$/, "").trim();
  if (!trimmed) {
    return "Unit";
  }
  if (trimmed === "null") {
    return "Nothing?";
  }
  if (/\berror\s*\(/.test(trimmed)) {
    return "Nothing";
  }
  if (/^if\b[\s\S]*\belse\b/.test(trimmed)) {
    const elseIndex = trimmed.lastIndexOf("else");
    const trueBranch = trimmed.slice(trimmed.indexOf(")") + 1, elseIndex).trim().replace(/^\{|\}$/g, "").trim();
    const falseBranch = trimmed.slice(elseIndex + 4).trim().replace(/^\{|\}$/g, "").trim();
    const trueType = inferExpressionType(trueBranch, context, parameterTypes);
    const falseType = inferExpressionType(falseBranch, context, parameterTypes);
    if (trueType && falseType && trueType !== falseType) {
      if (trueType === "Nothing?") return `${falseType}?`;
      if (falseType === "Nothing?") return `${trueType}?`;
    }
    return trueType ?? falseType;
  }
  if (/^(?:println|print)\s*\(/.test(trimmed) || /\bprintln\s*\(/.test(trimmed)) {
    return "Unit";
  }
  if (/^"[\s\S]*"$/.test(trimmed) || trimmed.includes("\"$")) {
    return "String";
  }
  if (/System\.currentTimeMillis\s*\(\)/.test(trimmed)) {
    return "Long";
  }
  if (/\.toString\s*\(\)/.test(trimmed)) {
    return "String";
  }
  const optionalInvocation = /^([A-Za-z_][A-Za-z0-9_]*)\?\.invoke\s*\(/.exec(trimmed)?.[1];
  if (optionalInvocation) {
    return functionTypeReturn(parameterTypes.get(optionalInvocation) ?? "");
  }
  if (/\.size\b/.test(trimmed) || /(?:[<>]=?|==|!=|&&|\|\|)/.test(trimmed.replace(/->/g, ""))) {
    return /\.size\b/.test(trimmed) && !/(?:[<>]=?|==|!=|&&|\|\|)/.test(trimmed.replace(/->/g, "")) ? "Int" : "Boolean";
  }
  if (/\bUnit\b/.test(trimmed)) {
    return "Unit";
  }
  if (/^-?\d+$/.test(trimmed) || /[+\-*/%]/.test(trimmed)) {
    return "Int";
  }

  const first = /\b([A-Za-z_][A-Za-z0-9_]*)\.first\s*\(\)/.exec(trimmed)?.[1];
  if (first) {
    const element = genericArgument(parameterTypes.get(first) ?? "", 0);
    if (element) return element;
  }
  const flattened = /\b([A-Za-z_][A-Za-z0-9_]*)\.values\.flatten\s*\(\)/.exec(trimmed)?.[1];
  if (flattened) {
    const mapType = parameterTypes.get(flattened) ?? "";
    const listType = genericArgument(mapType, 1);
    const element = listType ? genericArgument(listType, 0) : undefined;
    if (element) return `List<${element}>`;
  }

  return inferCalledFunctionReturnType(trimmed, context.functionNames, parameterTypes);
}

function genericArgument(type: string, index: number): string | undefined {
  const open = type.indexOf("<");
  const close = type.lastIndexOf(">");
  if (open < 0 || close < open) return undefined;
  return splitTopLevel(type.slice(open + 1, close))[index]?.trim();
}

function functionTypeReturn(functionType: string): string | undefined {
  let type = functionType.trim().replace(/^suspend\s+/, "");
  if (type.endsWith("?")) {
    type = type.slice(0, -1).trim();
  }
  while (isWrappedByParentheses(type)) {
    type = type.slice(1, -1).trim();
  }
  const arrow = findTopLevelArrow(type);
  return arrow >= 0 ? normalizeTypeText(type.slice(arrow + 2)) : undefined;
}

function isFunctionTypeText(type: string): boolean {
  let candidate = normalizeTypeText(type);
  if (candidate.endsWith("?")) {
    candidate = candidate.slice(0, -1).trim();
  }
  while (isWrappedByParentheses(candidate)) {
    candidate = candidate.slice(1, -1).trim();
  }
  return findTopLevelArrow(candidate.replace(/^suspend\s+/, "")) >= 0;
}

function normalizeTypeText(type: string): string {
  return type
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*->\s*/g, " -> ")
    .trim();
}

function canonicalizeTypeText(type: string): string {
  const normalized = normalizeTypeText(type);
  const nullableBase = normalized.slice(0, -1).trim();
  if (normalized.endsWith("?") && findTopLevelArrow(nullableBase) < 0 && isFunctionTypeText(nullableBase)) {
    return `(${canonicalizeTypeText(normalized.slice(0, -1))})?`;
  }
  return isFunctionTypeText(normalized) ? canonicalizeFunctionType(normalized) : normalized;
}

function canonicalizeFunctionType(type: string): string {
  let candidate = normalizeTypeText(type);
  const suspend = candidate.startsWith("suspend ") ? "suspend " : "";
  if (suspend) {
    candidate = candidate.slice(suspend.length).trim();
  }
  if (isWrappedByParentheses(candidate)) {
    return canonicalizeFunctionType(candidate.slice(1, -1));
  }

  const arrow = findTopLevelArrow(candidate);
  if (arrow < 0) {
    return normalizeTypeText(type);
  }

  const parameters = candidate.slice(0, arrow).trim();
  const returnType = candidate.slice(arrow + 2).trim();
  const open = parameters.indexOf("(");
  const close = open >= 0 ? findMatchingDelimiter(parameters, open, "(", ")") : -1;
  const formattedParameters = open === 0 && close === parameters.length - 1
    ? `(${splitTopLevel(parameters.slice(1, -1)).filter(Boolean).map(canonicalizeTypeText).join(", ")})`
    : canonicalizeTypeText(parameters);
  return `${suspend}${formattedParameters} -> ${canonicalizeTypeText(returnType)}`;
}

function findTopLevelArrow(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length - 1; index += 1) {
    if ("(<[{".includes(text[index])) depth += 1;
    else if (")]}>".includes(text[index])) {
      if (text[index] === ">" && text[index - 1] === "-") continue;
      depth = Math.max(0, depth - 1);
    }
    else if (text[index] === "-" && text[index + 1] === ">" && depth === 0) return index;
  }
  return -1;
}

function findLastTopLevelArrow(text: string): number {
  let lastArrow = -1;
  let depth = 0;
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] === "-" && text[index + 1] === ">" && depth === 0) {
      lastArrow = index;
    } else if ("(<[{".includes(text[index])) {
      depth += 1;
    } else if (")]}>".includes(text[index])) {
      if (text[index] === ">" && text[index - 1] === "-") continue;
      depth = Math.max(0, depth - 1);
    }
  }
  return lastArrow;
}

function findTopLevelCharacter(text: string, character: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === character && depth === 0) return index;
    if ("(<[{".includes(text[index])) depth += 1;
    else if (")]}>".includes(text[index])) {
      if (text[index] === ">" && text[index - 1] === "-") continue;
      depth = Math.max(0, depth - 1);
    }
  }
  return -1;
}

function findTopLevelBodyStart(text: string): number {
  const equals = findTopLevelCharacter(text, "=");
  const brace = findTopLevelCharacter(text, "{");
  if (equals < 0) return brace;
  if (brace < 0) return equals;
  return Math.min(equals, brace);
}

function findMatchingAngleDelimiter(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "<") depth += 1;
    else if (text[index] === ">") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isWrappedByParentheses(text: string): boolean {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  return findMatchingDelimiter(text, 0, "(", ")") === text.length - 1;
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
  if (isNonExecutableDeclaration(trimmed)) {
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

function isNonExecutableDeclaration(trimmed: string): boolean {
  return isFunctionDeclaration(trimmed)
    || /^(?:(?:public|private|protected|internal|sealed|data|enum|annotation)\s+)*(?:fun\s+interface|class|object|interface|enum|typealias|annotation)\b/.test(trimmed)
    || /^(?:val|var)\b/.test(trimmed);
}

function pushDeclarationResult(
  generated: string[],
  generatedLineToSourceLine: number[],
  markerPrefix: string,
  sourceLine: number,
  expression: string,
  declarationText: string,
  functionContext: FunctionContext,
  resultRange?: WorksheetRange,
): void {
  if (!isResultLine(sourceLine, resultRange)) {
    return;
  }

  const staticType = functionContext.functionTypes.get(sourceLine)
    ?? inferDeclarationFunctionType(declarationText, functionContext);
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
