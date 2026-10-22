import type {
  Block,
  Expression,
  FunctionDeclaration,
  Identifier,
  Index,
  Program,
  Statement,
  VariableDeclaration,
  UserTypeDeclaration,
} from './ast';
import { FirmwareSyntaxError, tokenize, type Token } from './tokenizer';

/**
 * Recursive-descent parser for the Arduino subset.
 *
 * Type names are recognised only well enough to know that a declaration is
 * starting and to skip the type itself: the VM has one numeric type, so `int`,
 * `long`, and `float` differ in nothing it can observe. Keeping the distinction
 * would mean implementing integer overflow and truncation to be honest about it,
 * which is a much larger promise than this simulator makes.
 */

const TYPE_KEYWORDS = new Set([
  'void',
  'int',
  'long',
  'short',
  'char',
  'float',
  'double',
  'bool',
  'boolean',
  'byte',
  'word',
  'size_t',
  'uint8_t',
  'uint16_t',
  'uint32_t',
  'int8_t',
  'int16_t',
  'int32_t',
  'String',
]);

/** Modifiers that may precede a type and carry no meaning for the VM. */
const TYPE_MODIFIERS = new Set(['const', 'unsigned', 'signed', 'static', 'volatile']);

const KEYWORDS = new Set([
  'if',
  'else',
  'while',
  'do',
  'for',
  'return',
  'break',
  'continue',
  'true',
  'false',
  'switch',
  'case',
  'default',
  'enum',
]);

/** Binary precedence, loosest first. Mirrors C's table for the operators we accept. */
const BINARY_PRECEDENCE: readonly (readonly string[])[] = [
  ['|'],
  ['^'],
  ['&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['<<', '>>'],
  ['+', '-'],
  ['*', '/', '%'],
];

const ASSIGNMENT_OPERATORS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
]);

export function parseFirmware(source: string): Program {
  const { tokens, defines } = tokenize(source);
  return new Parser(tokens, defines).parseProgram();
}

/**
 * A function prototype was read and consumed. Distinct from "not a function": rewinding
 * after a prototype re-read `int twice(int value);` as a variable built from `int value`.
 */
const PROTOTYPE = Symbol('prototype');

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly defines: ReadonlyMap<string, string>,
  ) {}

  parseProgram(): Program {
    const functions = new Map<string, FunctionDeclaration>();
    const userTypes = new Map<string, UserTypeDeclaration>();
    const globals: VariableDeclaration[] = [];

    while (!this.atEnd()) {
      if (this.checkIdentifier('template')) {
        this.skipTemplatePrefix();
        continue;
      }
      if (this.checkIdentifier('struct') || this.checkIdentifier('class')) {
        const type = this.parseUserType();
        userTypes.set(type.name, type);
        continue;
      }
      if (
        this.checkIdentifier('enum') ||
        (this.checkIdentifier('typedef') && this.peek(1).value === 'enum')
      ) {
        globals.push(...this.parseEnum());
        continue;
      }

      const checkpoint = this.position;
      const declaration = this.tryParseFunction();
      if (declaration === PROTOTYPE) continue;
      if (declaration) {
        functions.set(declaration.name, declaration);
        continue;
      }
      this.position = checkpoint;

      if (this.startsDeclaration()) {
        globals.push(...this.parseVariableDeclaration());
        continue;
      }

      // A construct outside a function that is neither — a struct, a namespace, a
      // using-declaration. Skipped rather than rejected, so the rest still runs.
      this.skipToStatementEnd();
    }

    if (!functions.has('setup') && !functions.has('loop')) {
      throw new FirmwareSyntaxError('ไม่พบฟังก์ชัน setup() หรือ loop() ในโค้ด', this.peek().line);
    }
    return { functions, globals, userTypes };
  }

  private skipTemplatePrefix(): void {
    this.advance();
    this.expectOperator('<');
    let depth = 1;
    while (!this.atEnd() && depth > 0) {
      const token = this.advance();
      if (token.type !== 'operator') continue;
      if (token.value === '<') depth++;
      if (token.value === '>') depth--;
    }
  }

  private parseUserType(): UserTypeDeclaration {
    this.advance(); // struct or class
    const name = this.peek();
    if (name.type !== 'identifier') {
      throw new FirmwareSyntaxError('คาดว่าจะเป็นชื่อ struct หรือ class', name.line);
    }
    this.advance();
    this.expectOperator('{');
    const fields: VariableDeclaration[] = [];
    const methods = new Map<string, FunctionDeclaration>();
    while (!this.checkOperator('}')) {
      if (this.atEnd())
        throw new FirmwareSyntaxError('ปีกกาของ struct หรือ class ไม่ได้ปิด', name.line);
      if (
        (this.checkIdentifier('public') ||
          this.checkIdentifier('private') ||
          this.checkIdentifier('protected')) &&
        this.peek(1).value === ':'
      ) {
        this.advance();
        this.advance();
        continue;
      }
      if (this.checkIdentifier(name.value) && this.peek(1).value === '(') {
        methods.set('__constructor', this.parseConstructor(name.value));
        continue;
      }
      const checkpoint = this.position;
      const method = this.tryParseFunction();
      if (method === PROTOTYPE) continue;
      if (method) {
        methods.set(method.name, method);
        continue;
      }
      this.position = checkpoint;
      if (this.startsDeclaration()) {
        fields.push(...this.parseVariableDeclaration());
        continue;
      }
      this.skipToStatementEnd();
    }
    this.expectOperator('}');
    while (!this.checkOperator(';') && !this.atEnd()) this.advance();
    this.expectOperator(';');
    return { name: name.value, fields, methods };
  }

  private parseConstructor(typeName: string): FunctionDeclaration {
    const name = this.advance();
    this.expectOperator('(');
    const parameters: string[] = [];
    const referenceParameters: string[] = [];
    while (!this.checkOperator(')')) {
      const typeStart = this.position;
      this.skipTypeTokens();
      const parameter = this.peek();
      if (parameter.type !== 'identifier') {
        throw new FirmwareSyntaxError(
          `พารามิเตอร์ constructor ของ ${typeName} ไม่ถูกต้อง`,
          parameter.line,
        );
      }
      parameters.push(parameter.value);
      if (this.tokens.slice(typeStart, this.position).some((token) => token.value === '&'))
        referenceParameters.push(parameter.value);
      this.advance();
      if (this.checkOperator(',')) this.advance();
    }
    this.expectOperator(')');
    const body = this.parseBlock();
    return { name: '__constructor', parameters, referenceParameters, body, line: name.line };
  }

  // --- declarations --------------------------------------------------------

  private tryParseFunction(): FunctionDeclaration | typeof PROTOTYPE | null {
    if (!this.startsDeclaration()) return null;
    this.skipTypeTokens();

    const name = this.peek();
    if (name.type !== 'identifier') return null;
    this.advance();
    if (!this.checkOperator('(')) return null;
    this.advance();

    const parameters: string[] = [];
    const referenceParameters: string[] = [];
    /** Every parameter named a type. `DallasTemperature sensors(&oneWire);` does not. */
    let typedParameters = true;
    while (!this.checkOperator(')')) {
      const typeStart = this.position;
      this.skipTypeTokens();
      const parameter = this.peek();
      // Not a parameter list after all: `Adafruit_SSD1306 display(128, 64, &Wire, -1);`
      // builds an object with arguments, which the declaration path handles.
      if (parameter.type !== 'identifier') return null;
      if (
        !this.tokens.slice(typeStart, this.position).some((token) => token.type === 'identifier')
      ) {
        typedParameters = false;
      }
      parameters.push(parameter.value);
      if (this.tokens.slice(typeStart, this.position).some((token) => token.value === '&'))
        referenceParameters.push(parameter.value);
      this.advance();
      if (this.checkOperator('[')) {
        this.advance();
        this.expectOperator(']');
      }
      if (this.checkOperator(',')) this.advance();
    }
    this.expectOperator(')');

    // A prototype, not a definition. Skip it and let the real one register. Without a
    // type on every parameter it is an object built from variables, which the
    // declaration path handles.
    if (this.checkOperator(';')) {
      if (!typedParameters) return null;
      this.advance();
      return PROTOTYPE;
    }
    if (!this.checkOperator('{')) return null;

    const line = name.line;
    const body = this.parseBlock();
    return { name: name.value, parameters, referenceParameters, body, line };
  }

  private parseVariableDeclaration(): VariableDeclaration[] {
    const typeName = this.skipTypeTokens();
    const declarations: VariableDeclaration[] = [];

    for (;;) {
      const name = this.peek();
      if (name.type !== 'identifier') {
        throw new FirmwareSyntaxError('คาดว่าจะเป็นชื่อตัวแปร', name.line);
      }
      this.advance();

      let isArray = false;
      let arraySize: Expression | null = null;
      if (this.checkOperator('[')) {
        this.advance();
        isArray = true;
        if (!this.checkOperator(']')) arraySize = this.parseExpression();
        this.expectOperator(']');
      }

      let initializer: Expression | null = null;
      let elements: readonly Expression[] | null = null;
      let constructorArgs: readonly Expression[] | undefined;
      if (this.checkOperator('(')) {
        constructorArgs = this.parseArguments();
      } else if (this.checkOperator('=')) {
        this.advance();
        if (this.checkOperator('{')) {
          this.advance();
          const values: Expression[] = [];
          while (!this.checkOperator('}')) {
            values.push(this.parseExpression());
            if (this.checkOperator(',')) this.advance();
          }
          this.expectOperator('}');
          elements = values;
          isArray = true;
        } else {
          initializer = this.parseExpression();
        }
      }

      declarations.push({
        kind: 'variable',
        name: name.value,
        isArray,
        arraySize,
        initializer,
        elements,
        line: name.line,
        ...(typeName ? { typeName } : {}),
        ...(constructorArgs ? { constructorArgs } : {}),
      });

      if (this.checkOperator(',')) {
        this.advance();
        continue;
      }
      break;
    }

    this.expectOperator(';');
    return declarations;
  }

  // --- statements ----------------------------------------------------------

  private parseBlock(): Block {
    const line = this.peek().line;
    this.expectOperator('{');
    const body: Statement[] = [];
    while (!this.checkOperator('}')) {
      if (this.atEnd()) throw new FirmwareSyntaxError('ปีกกาไม่ได้ปิด', line);
      body.push(...this.parseStatementList());
    }
    this.expectOperator('}');
    return { kind: 'block', body, line };
  }

  /** Returns a list because `int a = 1, b = 2;` is several statements. */
  private parseStatementList(): Statement[] {
    if (this.startsDeclaration()) return this.parseVariableDeclaration();
    return [this.parseStatement()];
  }

  private parseStatement(): Statement {
    const token = this.peek();
    const line = token.line;

    if (this.checkOperator('{')) return this.parseBlock();
    if (this.checkOperator(';')) {
      this.advance();
      return { kind: 'empty', line };
    }

    if (token.type === 'identifier') {
      switch (token.value) {
        case 'if':
          return this.parseIf();
        case 'while':
          return this.parseWhile();
        case 'do':
          return this.parseDoWhile();
        case 'for':
          return this.parseFor();
        case 'switch':
          return this.parseSwitch();
        case 'return': {
          this.advance();
          const value = this.checkOperator(';') ? null : this.parseExpression();
          this.expectOperator(';');
          return { kind: 'return', value, line };
        }
        case 'break':
          this.advance();
          this.expectOperator(';');
          return { kind: 'break', line };
        case 'continue':
          this.advance();
          this.expectOperator(';');
          return { kind: 'continue', line };
      }
    }

    const expression = this.parseExpression();
    this.expectOperator(';');
    return { kind: 'expression', expression, line };
  }

  private parseIf(): Statement {
    const line = this.peek().line;
    this.advance();
    this.expectOperator('(');
    const test = this.parseExpression();
    this.expectOperator(')');
    const consequent = this.parseStatementOrDeclaration();
    let alternate: Statement | null = null;
    if (this.checkIdentifier('else')) {
      this.advance();
      alternate = this.parseStatementOrDeclaration();
    }
    return { kind: 'if', test, consequent, alternate, line };
  }

  private parseWhile(): Statement {
    const line = this.peek().line;
    this.advance();
    this.expectOperator('(');
    const test = this.parseExpression();
    this.expectOperator(')');
    return { kind: 'while', test, body: this.parseStatementOrDeclaration(), line };
  }

  private parseDoWhile(): Statement {
    const line = this.peek().line;
    this.advance();
    const body = this.parseStatementOrDeclaration();
    if (!this.checkIdentifier('while')) {
      throw new FirmwareSyntaxError('คาดว่าจะเป็น while หลัง do', this.peek().line);
    }
    this.advance();
    this.expectOperator('(');
    const test = this.parseExpression();
    this.expectOperator(')');
    this.expectOperator(';');
    return { kind: 'doWhile', test, body, line };
  }

  private parseFor(): Statement {
    const line = this.peek().line;
    this.advance();
    this.expectOperator('(');

    let init: Statement | null = null;
    if (!this.checkOperator(';')) {
      if (this.startsDeclaration()) {
        const declarations = this.parseVariableDeclaration();
        init = { kind: 'block', body: declarations, line };
      } else {
        const expression = this.parseExpression();
        this.expectOperator(';');
        init = { kind: 'expression', expression, line };
      }
    } else {
      this.advance();
    }

    const test = this.checkOperator(';') ? null : this.parseExpression();
    this.expectOperator(';');
    const update = this.checkOperator(')') ? null : this.parseExpression();
    this.expectOperator(')');

    return { kind: 'for', init, test, update, body: this.parseStatementOrDeclaration(), line };
  }

  private parseSwitch(): Statement {
    const line = this.peek().line;
    this.advance();
    this.expectOperator('(');
    const discriminant = this.parseExpression();
    this.expectOperator(')');
    this.expectOperator('{');

    const cases: { test: Expression | null; body: Statement[] }[] = [];
    while (!this.checkOperator('}')) {
      if (this.atEnd()) throw new FirmwareSyntaxError('ปีกกาของ switch ไม่ได้ปิด', line);
      if (this.checkIdentifier('case')) {
        this.advance();
        const test = this.parseConditional();
        this.expectOperator(':');
        cases.push({ test, body: [] });
        continue;
      }
      if (this.checkIdentifier('default')) {
        this.advance();
        this.expectOperator(':');
        cases.push({ test: null, body: [] });
        continue;
      }
      const current = cases[cases.length - 1];
      if (!current) {
        throw new FirmwareSyntaxError(
          'คำสั่งใน switch ต้องอยู่หลัง case หรือ default',
          this.peek().line,
        );
      }
      current.body.push(...this.parseStatementList());
    }
    this.expectOperator('}');
    return { kind: 'switch', discriminant, cases, line };
  }

  /**
   * `enum State { IDLE, RUNNING = 5, DONE };` becomes three constants. The enum's
   * own name is a type, and the VM ignores types.
   */
  private parseEnum(): VariableDeclaration[] {
    if (this.checkIdentifier('typedef')) this.advance();
    this.advance();
    if (this.checkIdentifier('class') || this.checkIdentifier('struct')) this.advance();
    if (this.peek().type === 'identifier') this.advance();
    // `enum class Mode : uint8_t { … }` names an underlying type.
    if (this.checkOperator(':')) {
      this.advance();
      this.skipTypeTokens();
      if (this.peek().type === 'identifier') this.advance();
    }
    this.expectOperator('{');

    const declarations: VariableDeclaration[] = [];
    let previous: string | null = null;
    while (!this.checkOperator('}')) {
      const name = this.peek();
      if (name.type !== 'identifier') {
        throw new FirmwareSyntaxError('คาดว่าจะเป็นชื่อใน enum', name.line);
      }
      this.advance();
      let initializer: Expression;
      if (this.checkOperator('=')) {
        this.advance();
        initializer = this.parseConditional();
      } else if (previous) {
        initializer = {
          kind: 'binary',
          operator: '+',
          left: { kind: 'identifier', name: previous, line: name.line },
          right: { kind: 'number', value: 1, line: name.line },
          line: name.line,
        };
      } else {
        initializer = { kind: 'number', value: 0, line: name.line };
      }
      declarations.push({
        kind: 'variable',
        name: name.value,
        isArray: false,
        arraySize: null,
        initializer,
        elements: null,
        line: name.line,
      });
      previous = name.value;
      if (this.checkOperator(',')) this.advance();
    }
    this.expectOperator('}');
    // `typedef enum { … } Name;` ends with the type's name before the semicolon.
    while (!this.checkOperator(';') && !this.atEnd()) this.advance();
    this.expectOperator(';');
    return declarations;
  }

  /** A single-statement body may itself be a declaration: `if (x) int y = 1;`. */
  private parseStatementOrDeclaration(): Statement {
    const statements = this.parseStatementList();
    if (statements.length === 1) return statements[0];
    return { kind: 'block', body: statements, line: statements[0].line };
  }

  // --- expressions ---------------------------------------------------------

  /** Public so a `#define` body can be re-parsed as a standalone expression. */
  parseExpression(): Expression {
    return this.parseAssignment();
  }

  private parseAssignment(): Expression {
    const left = this.parseConditional();
    const token = this.peek();
    if (token.type !== 'operator' || !ASSIGNMENT_OPERATORS.has(token.value)) return left;

    if (left.kind !== 'identifier' && left.kind !== 'index' && left.kind !== 'memberRead') {
      throw new FirmwareSyntaxError('ฝั่งซ้ายของการกำหนดค่าต้องเป็นตัวแปร', token.line);
    }
    this.advance();
    const value = this.parseAssignment();
    return {
      kind: 'assignment',
      operator: token.value,
      target: left as Identifier | Index | Extract<Expression, { kind: 'memberRead' }>,
      value,
      line: token.line,
    };
  }

  private parseConditional(): Expression {
    const test = this.parseLogicalOr();
    if (!this.checkOperator('?')) return test;
    const line = this.peek().line;
    this.advance();
    const consequent = this.parseAssignment();
    this.expectOperator(':');
    const alternate = this.parseAssignment();
    return { kind: 'conditional', test, consequent, alternate, line };
  }

  private parseLogicalOr(): Expression {
    let left = this.parseLogicalAnd();
    while (this.checkOperator('||')) {
      const line = this.peek().line;
      this.advance();
      left = { kind: 'logical', operator: '||', left, right: this.parseLogicalAnd(), line };
    }
    return left;
  }

  private parseLogicalAnd(): Expression {
    let left = this.parseBinary(0);
    while (this.checkOperator('&&')) {
      const line = this.peek().line;
      this.advance();
      left = { kind: 'logical', operator: '&&', left, right: this.parseBinary(0), line };
    }
    return left;
  }

  private parseBinary(level: number): Expression {
    if (level >= BINARY_PRECEDENCE.length) return this.parseUnary();

    let left = this.parseBinary(level + 1);
    for (;;) {
      const token = this.peek();
      if (token.type !== 'operator' || !BINARY_PRECEDENCE[level].includes(token.value)) return left;
      this.advance();
      left = {
        kind: 'binary',
        operator: token.value,
        left,
        right: this.parseBinary(level + 1),
        line: token.line,
      };
    }
  }

  private parseUnary(): Expression {
    const token = this.peek();

    if (token.value === 'sizeof') {
      this.advance();
      if (this.checkOperator('(')) {
        this.advance();
        if (TYPE_KEYWORDS.has(this.peek().value) || TYPE_MODIFIERS.has(this.peek().value)) {
          const start = this.position;
          const typeName = this.skipTypeTokens();
          if (this.tokens.slice(start, this.position).some((part) => part.value === '*')) {
            throw new FirmwareSyntaxError('ตัวจำลองยังไม่รองรับ sizeof ของ pointer', token.line);
          }
          this.expectOperator(')');
          return { kind: 'sizeof', typeName, line: token.line };
        }
        const operand = this.parseExpression();
        this.expectOperator(')');
        return { kind: 'sizeof', operand, line: token.line };
      }
      return { kind: 'sizeof', operand: this.parseUnary(), line: token.line };
    }

    if (token.type === 'operator' && (token.value === '++' || token.value === '--')) {
      this.advance();
      const target = this.parseUnary();
      if (target.kind !== 'identifier' && target.kind !== 'index' && target.kind !== 'memberRead') {
        throw new FirmwareSyntaxError('++ และ -- ใช้ได้กับตัวแปรเท่านั้น', token.line);
      }
      return { kind: 'update', operator: token.value, prefix: true, target, line: token.line };
    }

    if (
      token.type === 'operator' &&
      (token.value === '-' ||
        token.value === '+' ||
        token.value === '!' ||
        token.value === '~' ||
        token.value === '&' ||
        token.value === '*')
    ) {
      this.advance();
      return {
        kind: 'unary',
        operator: token.value,
        operand: this.parseUnary(),
        line: token.line,
      };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expression = this.parsePrimary();

    for (;;) {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '++' || token.value === '--')) {
        if (
          expression.kind !== 'identifier' &&
          expression.kind !== 'index' &&
          expression.kind !== 'memberRead'
        )
          return expression;
        this.advance();
        expression = {
          kind: 'update',
          operator: token.value,
          prefix: false,
          target: expression,
          line: token.line,
        };
        continue;
      }

      if (this.checkOperator('[')) {
        this.advance();
        const index = this.parseExpression();
        this.expectOperator(']');
        expression =
          expression.kind === 'identifier'
            ? { kind: 'index', array: expression, index, line: token.line }
            : { kind: 'elementRead', array: expression, index, line: token.line };
        continue;
      }

      if (this.checkOperator('.')) {
        this.advance();
        const method = this.peek();
        if (method.type !== 'identifier') {
          throw new FirmwareSyntaxError('คาดว่าจะเป็นชื่อเมท็อดหลังจุด', method.line);
        }
        this.advance();
        if (!this.checkOperator('(')) {
          expression = {
            kind: 'memberRead',
            object: expression,
            field: method.value,
            line: token.line,
          };
          continue;
        }
        if (expression.kind !== 'identifier')
          throw new FirmwareSyntaxError('เก็บผลลัพธ์ในตัวแปรก่อนเรียกเมท็อด', token.line);
        expression = {
          kind: 'memberCall',
          object: expression.name,
          method: method.value,
          args: this.checkOperator('(') ? this.parseArguments() : [],
          line: token.line,
        };
        continue;
      }

      return expression;
    }
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    if (token.type === 'number') {
      this.advance();
      return { kind: 'number', value: parseNumericLiteral(token.value), line: token.line };
    }

    if (token.type === 'string') {
      this.advance();
      return { kind: 'string', value: token.value, line: token.line };
    }

    if (token.type === 'char') {
      this.advance();
      return { kind: 'number', value: token.value.charCodeAt(0) || 0, line: token.line };
    }

    if (this.checkOperator('(')) {
      this.advance();
      // A cast such as `(float)total` carries no meaning for the VM, which has a
      // single numeric type. Drop it and parse what it was applied to.
      const cast = this.peek();
      if (
        cast.type === 'identifier' &&
        (TYPE_KEYWORDS.has(cast.value) || TYPE_MODIFIERS.has(cast.value)) &&
        this.tokens[this.position + 1]?.value === ')'
      ) {
        this.advance();
        this.advance();
        return this.parseUnary();
      }
      const expression = this.parseExpression();
      this.expectOperator(')');
      return expression;
    }

    if (token.type === 'identifier') {
      if (token.value === 'true' || token.value === 'false') {
        this.advance();
        return { kind: 'boolean', value: token.value === 'true', line: token.line };
      }

      const substitution = this.defines.get(token.value);
      if (substitution !== undefined) {
        this.advance();
        return parseDefineValue(substitution, token.line);
      }

      this.advance();
      if (this.checkOperator('(')) {
        return { kind: 'call', callee: token.value, args: this.parseArguments(), line: token.line };
      }
      return { kind: 'identifier', name: token.value, line: token.line };
    }

    throw new FirmwareSyntaxError(`ไม่คาดคิดว่าจะเจอ "${token.value || 'จบไฟล์'}"`, token.line);
  }

  private parseArguments(): Expression[] {
    this.expectOperator('(');
    const args: Expression[] = [];
    while (!this.checkOperator(')')) {
      args.push(this.parseExpression());
      if (this.checkOperator(',')) this.advance();
    }
    this.expectOperator(')');
    return args;
  }

  // --- token helpers -------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    return this.tokens[this.position++];
  }

  private atEnd(): boolean {
    return this.peek().type === 'eof';
  }

  private checkOperator(value: string): boolean {
    const token = this.peek();
    return token.type === 'operator' && token.value === value;
  }

  private checkIdentifier(value: string): boolean {
    const token = this.peek();
    return token.type === 'identifier' && token.value === value;
  }

  private expectOperator(value: string): void {
    if (!this.checkOperator(value)) {
      const token = this.peek();
      throw new FirmwareSyntaxError(
        `คาดว่าจะเจอ "${value}" แต่เจอ "${token.value || 'จบไฟล์'}"`,
        token.line,
      );
    }
    this.advance();
  }

  /**
   * True when the tokens ahead open a declaration.
   *
   * A bare `String` or a library type followed by an identifier also counts, so
   * `LiquidCrystal_I2C lcd(...)` is recognised as a declaration and skipped
   * rather than parsed as a call to an undefined function.
   */
  private startsDeclaration(): boolean {
    const token = this.peek();
    if (token.type !== 'identifier') return false;
    if (KEYWORDS.has(token.value)) return false;
    if (TYPE_MODIFIERS.has(token.value) || TYPE_KEYWORDS.has(token.value)) return true;

    // An unknown identifier immediately followed by another identifier is a
    // declaration using a library type.
    const next = this.peek(1);
    return next.type === 'identifier' && !KEYWORDS.has(next.value);
  }

  /** Skips a type as written and returns its name, e.g. `DHT` for `static DHT`. */
  private skipTypeTokens(): string | undefined {
    let typeName: string | undefined;
    while (!this.atEnd()) {
      const token = this.peek();
      if (token.type === 'identifier' && TYPE_MODIFIERS.has(token.value)) {
        this.advance();
        continue;
      }
      if (token.type === 'identifier' && TYPE_KEYWORDS.has(token.value)) {
        typeName = token.value;
        this.advance();
        continue;
      }
      // A library type name, or a namespace-qualified one.
      if (token.type === 'identifier' && this.peek(1).type === 'identifier') {
        typeName = token.value;
        this.advance();
        continue;
      }
      if (this.checkOperator('*') || this.checkOperator('&')) {
        this.advance();
        continue;
      }
      return typeName;
    }
    return typeName;
  }

  /** Consumes an unsupported construct up to and including its terminator. */
  private skipToStatementEnd(): void {
    let depth = 0;
    while (!this.atEnd()) {
      const token = this.advance();
      if (token.type !== 'operator') continue;
      if (token.value === '{') depth++;
      else if (token.value === '}') {
        depth--;
        if (depth <= 0) return;
      } else if (token.value === ';' && depth === 0) return;
    }
  }
}

function parseNumericLiteral(raw: string): number {
  // `F` is a hex digit, so only `u`/`l` can be a suffix on a hex literal: stripping
  // it turned the LCD address 0x3F into 0x3.
  if (/^0[xX]/.test(raw)) return parseInt(raw.slice(2).replace(/[uUlL]+$/, ''), 16);
  const cleaned = raw.replace(/[uUlLfF]+$/, '');
  if (/^0[bB]/.test(cleaned)) return parseInt(cleaned.slice(2), 2);
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** `#define` bodies are re-tokenized so `#define PIN (2 + 3)` works. */
function parseDefineValue(value: string, line: number): Expression {
  try {
    const { tokens } = tokenize(`${value};`);
    return new Parser(tokens, new Map()).parseExpression();
  } catch {
    return { kind: 'number', value: 0, line };
  }
}
