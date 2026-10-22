/**
 * Lexer for the Arduino C++ subset the simulator executes.
 *
 * This is not a C++ front end and does not try to become one. It reads the shape
 * of sketch code — declarations, control flow, arithmetic, calls — and rejects
 * everything else with a line number, which is more useful to a learner than a
 * partial parse that silently ignores what it did not understand.
 *
 * Preprocessor lines are handled here rather than in a separate pass: `#include`
 * is dropped because the simulator provides the library surface itself, and
 * `#define NAME value` is recorded for the parser to fold in as a constant.
 */

export type TokenType = 'number' | 'string' | 'char' | 'identifier' | 'operator' | 'eof';

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly line: number;
}

export interface TokenizeResult {
  readonly tokens: readonly Token[];
  /** `#define NAME value` pairs, substituted by the parser. */
  readonly defines: ReadonlyMap<string, string>;
}

export class FirmwareSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'FirmwareSyntaxError';
  }
}

/**
 * Longest first. `<<=` must be tried before `<<`, which must be tried before
 * `<`, or the lexer splits a compound operator into two valid-looking pieces and
 * the parser fails somewhere far from the real mistake.
 */
const OPERATORS: readonly string[] = [
  '<<=',
  '>>=',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '::',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
  '~',
  '&',
  '|',
  '^',
  '?',
  ':',
  ';',
  ',',
  '.',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
];

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const defines = new Map<string, string>();
  let index = 0;
  let line = 1;

  const peek = (offset = 0): string => source[index + offset] ?? '';

  while (index < source.length) {
    const ch = peek();

    if (ch === '\n') {
      line++;
      index++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      index++;
      continue;
    }

    // Comments. A block comment can span lines, so the line counter has to keep
    // running inside it or every later error points at the wrong place.
    if (ch === '/' && peek(1) === '/') {
      while (index < source.length && peek() !== '\n') index++;
      continue;
    }
    if (ch === '/' && peek(1) === '*') {
      index += 2;
      while (index < source.length && !(peek() === '*' && peek(1) === '/')) {
        if (peek() === '\n') line++;
        index++;
      }
      index += 2;
      continue;
    }

    // Preprocessor. Consumed whole-line and never handed to the parser.
    if (ch === '#') {
      const start = index;
      while (index < source.length && peek() !== '\n') index++;
      const directive = source.slice(start, index).trim();
      const define = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(directive);
      if (define) defines.set(define[1], define[2].trim());
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(peek(1)))) {
      const start = index;
      if (
        ch === '0' &&
        (peek(1) === 'x' || peek(1) === 'X' || peek(1) === 'b' || peek(1) === 'B')
      ) {
        index += 2;
        while (index < source.length && /[0-9A-Fa-f]/.test(peek())) index++;
      } else {
        while (index < source.length && (isDigit(peek()) || peek() === '.')) index++;
      }
      // Numeric suffixes: 100UL, 2.5f. Recorded as part of the literal and
      // stripped when the value is read, because the VM has one number type.
      while (index < source.length && /[uUlLfF]/.test(peek())) index++;
      tokens.push({ type: 'number', value: source.slice(start, index), line });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line;
      index++;
      let value = '';
      while (index < source.length && peek() !== quote) {
        if (peek() === '\\') {
          index++;
          const escape = peek();
          value +=
            escape === 'n'
              ? '\n'
              : escape === 't'
                ? '\t'
                : escape === 'r'
                  ? '\r'
                  : escape === '0'
                    ? '\0'
                    : escape;
          index++;
          continue;
        }
        if (peek() === '\n') line++;
        value += peek();
        index++;
      }
      if (index >= source.length) {
        throw new FirmwareSyntaxError('สตริงไม่ได้ปิดเครื่องหมายคำพูด', startLine);
      }
      index++;
      tokens.push({ type: quote === '"' ? 'string' : 'char', value, line: startLine });
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = index;
      while (index < source.length && isIdentifierPart(peek())) index++;
      tokens.push({ type: 'identifier', value: source.slice(start, index), line });
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: 'operator', value: operator, line });
      index += operator.length;
      continue;
    }

    throw new FirmwareSyntaxError(`ไม่รู้จักอักขระ "${ch}"`, line);
  }

  tokens.push({ type: 'eof', value: '', line });
  return { tokens, defines };
}
