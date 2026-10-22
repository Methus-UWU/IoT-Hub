import type {
  Block,
  Expression,
  FunctionDeclaration,
  Identifier,
  Index,
  Program,
  Statement,
  VariableDeclaration,
} from './ast';
import {
  FirmwareRuntimeError,
  formatPrint,
  formatPrintf,
  isFirmwareFunction,
  isFirmwareRecord,
  isLibraryObject,
  numeric,
  stringify,
  truthy,
  type FirmwareValue,
  type LibraryHost,
} from './firmware-values';
import { LIBRARY_CLASSES, LIBRARY_CONSTANTS, createLibraryGlobals } from './libraries';

export { FirmwareRuntimeError, truthy };
export type { FirmwareArray, FirmwareValue } from './firmware-values';

/**
 * Resumable interpreter for the Arduino subset.
 *
 * The whole design turns on one constraint: the circuit solver ticks at 20 Hz on
 * the UI thread, and a sketch that calls `delay(1000)` must not block it. So
 * execution is written as generators that yield between steps, and the machine
 * runs them for a bounded number of steps per tick. `delay()` yields a duration
 * and the machine simply does not resume until its virtual clock has passed it.
 *
 * This also contains a tight loop such as `while (true) {}`: it burns its step
 * budget and the machine returns, so the page stays responsive instead of
 * freezing the tab.
 */

export type PinMode = 'input' | 'output' | 'input_pullup';

/** What the interpreter is allowed to do to the world outside itself. */
export interface FirmwareIo {
  pinMode(pin: number, mode: PinMode): void;
  digitalWrite(pin: number, high: boolean): void;
  digitalRead(pin: number): boolean;
  analogRead(pin: number): number;
  /** `value` is 0–255, matching `analogWrite`. */
  analogWrite(pin: number, value: number): void;
  /** A square wave at `hz`, for `durationMs` or until `noTone`. */
  tone(pin: number, hz: number, durationMs?: number): void;
  noTone(pin: number): void;
  serialWrite(text: string): void;
  /** The rate the sketch opened the port at, so the monitor can report it. */
  serialBegin(baud: number): void;
  /** Virtual milliseconds since the sketch started. */
  now(): number;
  /** What library emulations may reach: pins, bus data, the I2C bus. */
  readonly library: LibraryHost;
}

type Signal = { readonly type: 'step' } | { readonly type: 'delay'; readonly ms: number };

type Completion =
  | { readonly type: 'normal' }
  | { readonly type: 'break' }
  | { readonly type: 'continue' }
  | { readonly type: 'return'; readonly value: FirmwareValue };

const NORMAL: Completion = { type: 'normal' };
const STEP: Signal = { type: 'step' };

/** Depth beyond which recursion is reported rather than left to blow the JS stack. */
const MAX_CALL_DEPTH = 64;

interface ReferenceBinding {
  get(): FirmwareValue;
  set(value: FirmwareValue): void;
  readonly bytes?: number;
}

class Scope {
  private readonly references = new Map<string, ReferenceBinding>();
  private readonly sizes = new Map<string, number>();
  private readonly values = new Map<string, FirmwareValue>();
  /** Names declared with an integer type; every value stored in them is truncated. */
  private readonly integers = new Set<string>();

  constructor(private readonly parent: Scope | null) {}

  declare(name: string, value: FirmwareValue, integer = false, bytes?: number): void {
    if (bytes !== undefined) this.sizes.set(name, bytes);
    if (integer) this.integers.add(name);
    this.values.set(name, integer ? toInteger(value) : value);
  }

  has(name: string): boolean {
    return this.references.has(name) || this.values.has(name) || (this.parent?.has(name) ?? false);
  }

  get(name: string): FirmwareValue | undefined {
    if (this.references.has(name)) return this.references.get(name)!.get();
    if (this.values.has(name)) return this.values.get(name);
    return this.parent?.get(name);
  }

  /** Assigns in the scope that declared the name, so closures over globals work. */
  set(name: string, value: FirmwareValue): boolean {
    const reference = this.references.get(name);
    if (reference) { reference.set(value); return true; }
    if (this.values.has(name)) {
      this.values.set(name, this.integers.has(name) ? toInteger(value) : value);
      return true;
    }
    return this.parent?.set(name, value) ?? false;
  }

  bind(name: string, reference: ReferenceBinding): void {
    this.references.set(name, reference);
  }

  sizeOf(name: string): number | undefined {
    if (this.references.has(name)) return this.references.get(name)!.bytes;
    if (this.values.has(name)) return this.sizes.get(name);
    return this.parent?.sizeOf(name);
  }
}

const CONSTANTS: Readonly<Record<string, FirmwareValue>> = {
  HIGH: 1,
  LOW: 0,
  INPUT: 0,
  OUTPUT: 1,
  INPUT_PULLUP: 2,
  LED_BUILTIN: 13,
  // The Arduino analog header continues the digital numbering at 14, which is
  // what lets `analogRead(A0)` resolve through the same pin map as a digital pin.
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
  A6: 20,
  A7: 21,
  PI: Math.PI,
  DEC: 10,
  HEX: 16,
  BIN: 2,
  OCT: 8,
  NAN: Number.NaN,
  INFINITY: Number.POSITIVE_INFINITY,
  ...LIBRARY_CONSTANTS,
  // `Serial` used as a value is the port's `operator bool`, which reports ready.
  // Without it the common `while (!Serial) {}` guard stops `setup()` on line one.
  Serial: 1,
  CHANGE: 1,
  FALLING: 2,
  RISING: 3,
};

export class Interpreter {
  private readonly globals = new Scope(null);
  private callDepth = 0;
  /** ESP32 LEDC channels (or pins, on core 3.x): the pin each drives and its duty resolution. */
  private readonly ledc = new Map<number, { pin: number | null; bits: number }>();
  private readonly interruptHandlers = new Map<number, { functionName: string; mode: number; previous: boolean }>();
  private interruptHandlersEnabled = true;

  constructor(
    private readonly program: Program,
    private readonly io: FirmwareIo,
    private readonly intBytes = 4,
    /** Per-board values of core constants, e.g. `LED_BUILTIN`; they shadow the defaults. */
    boardConstants: Readonly<Record<string, FirmwareValue>> = {},
  ) {
    for (const [name, value] of Object.entries(boardConstants)) {
      this.globals.declare(name, value, true);
    }
    // `Wire` and its kind exist before the sketch's first line, as the headers
    // declare them.
    for (const [name, object] of createLibraryGlobals(io.library)) {
      this.globals.declare(name, object);
    }
  }

  /** Runs global declarations. Yields, because an initializer may call a function. */
  *initGlobals(): Generator<Signal, void> {
    for (const declaration of this.program.globals) {
      yield* this.declareVariable(declaration, this.globals);
    }
  }

  hasFunction(name: string): boolean {
    return this.program.functions.has(name);
  }

  *callFunction(
    name: string,
    args: readonly FirmwareValue[] = [],
  ): Generator<Signal, FirmwareValue> {
    const declaration = this.program.functions.get(name);
    if (!declaration) throw new FirmwareRuntimeError(`ไม่พบฟังก์ชัน ${name}()`, 0);
    return yield* this.invoke(declaration, args);
  }

  /** Runs callbacks for GPIO edges observed since the previous simulator tick. */
  *serviceInterrupts(): Generator<Signal, void> {
    for (const [pin, handler] of this.interruptHandlers) {
      const current = this.io.digitalRead(pin);
      const changed = current !== handler.previous;
      const triggered = changed && (
        handler.mode === CONSTANTS['CHANGE'] ||
        (handler.mode === CONSTANTS['RISING'] && current) ||
        (handler.mode === CONSTANTS['FALLING'] && !current)
      );
      handler.previous = current;
      if (triggered && this.interruptHandlersEnabled) {
        yield* this.callFunction(handler.functionName);
      }
    }
  }

  private *invoke(
    declaration: FunctionDeclaration,
    args: readonly FirmwareValue[],
  ): Generator<Signal, FirmwareValue> {
    return yield* this.invokeWithParent(declaration, args, this.globals);
  }

  private *invokeWithParent(
    declaration: FunctionDeclaration,
    args: readonly FirmwareValue[],
    parent: Scope,
    references: ReadonlyMap<string, ReferenceBinding> = new Map(),
  ): Generator<Signal, FirmwareValue> {
    if (this.callDepth >= MAX_CALL_DEPTH) {
      throw new FirmwareRuntimeError(
        `เรียกฟังก์ชันซ้อนกันเกิน ${MAX_CALL_DEPTH} ชั้น น่าจะเรียกตัวเองไม่รู้จบ`,
        declaration.line,
      );
    }

    const scope = new Scope(parent);
    declaration.parameters.forEach((parameter, index) => {
      const reference = references.get(parameter);
      if (reference) scope.bind(parameter, reference);
      else scope.declare(parameter, args[index] ?? 0);
    });

    this.callDepth++;
    try {
      const completion = yield* this.execBlock(declaration.body, scope);
      return completion.type === 'return' ? completion.value : 0;
    } finally {
      this.callDepth--;
    }
  }

  // --- statements ----------------------------------------------------------

  private *execBlock(block: Block, parent: Scope): Generator<Signal, Completion> {
    const scope = new Scope(parent);
    for (const statement of block.body) {
      const completion = yield* this.execStatement(statement, scope);
      if (completion.type !== 'normal') return completion;
    }
    return NORMAL;
  }

  private *execStatement(statement: Statement, scope: Scope): Generator<Signal, Completion> {
    yield STEP;

    switch (statement.kind) {
      case 'empty':
        return NORMAL;

      case 'block':
        return yield* this.execBlock(statement, scope);

      case 'variable':
        yield* this.declareVariable(statement, scope);
        return NORMAL;

      case 'expression':
        yield* this.evaluate(statement.expression, scope);
        return NORMAL;

      case 'if': {
        const test = truthy(yield* this.evaluate(statement.test, scope));
        if (test) return yield* this.execStatement(statement.consequent, scope);
        if (statement.alternate) return yield* this.execStatement(statement.alternate, scope);
        return NORMAL;
      }

      case 'while':
        for (;;) {
          if (!truthy(yield* this.evaluate(statement.test, scope))) return NORMAL;
          const completion = yield* this.execStatement(statement.body, scope);
          if (completion.type === 'break') return NORMAL;
          if (completion.type === 'return') return completion;
        }

      case 'doWhile':
        for (;;) {
          const completion = yield* this.execStatement(statement.body, scope);
          if (completion.type === 'break') return NORMAL;
          if (completion.type === 'return') return completion;
          if (!truthy(yield* this.evaluate(statement.test, scope))) return NORMAL;
        }

      case 'for': {
        // The loop variable belongs to the loop, not to the enclosing block.
        const loopScope = new Scope(scope);
        // `for (int i = 0; …)` parses its declaration as a block. Running that block
        // would give `i` a scope of its own that ends before the test reads it, so
        // its statements run directly in the loop's scope.
        if (statement.init?.kind === 'block') {
          for (const declaration of statement.init.body) {
            yield* this.execStatement(declaration, loopScope);
          }
        } else if (statement.init) {
          yield* this.execStatement(statement.init, loopScope);
        }
        for (;;) {
          if (statement.test && !truthy(yield* this.evaluate(statement.test, loopScope))) {
            return NORMAL;
          }
          const completion = yield* this.execStatement(statement.body, loopScope);
          if (completion.type === 'break') return NORMAL;
          if (completion.type === 'return') return completion;
          if (statement.update) yield* this.evaluate(statement.update, loopScope);
        }
      }

      case 'return': {
        const value = statement.value ? yield* this.evaluate(statement.value, scope) : 0;
        return { type: 'return', value };
      }

      case 'break':
        return { type: 'break' };

      case 'continue':
        return { type: 'continue' };

      case 'switch': {
        const value = numeric(yield* this.evaluate(statement.discriminant, scope), statement.line);
        let start = -1;
        for (let index = 0; index < statement.cases.length && start < 0; index++) {
          const test = statement.cases[index].test;
          if (test && numeric(yield* this.evaluate(test, scope), test.line) === value)
            start = index;
        }
        if (start < 0) start = statement.cases.findIndex((entry) => entry.test === null);
        if (start < 0) return NORMAL;

        // Cases fall through into the next until a `break`, as in C.
        const caseScope = new Scope(scope);
        for (const entry of statement.cases.slice(start)) {
          for (const inner of entry.body) {
            const completion = yield* this.execStatement(inner, caseScope);
            if (completion.type === 'break') return NORMAL;
            if (completion.type !== 'normal') return completion;
          }
        }
        return NORMAL;
      }
    }
  }

  private *declareVariable(
    declaration: VariableDeclaration,
    scope: Scope,
  ): Generator<Signal, void> {
    if (declaration.isArray) {
      if (declaration.elements) {
        const values: FirmwareValue[] = [];
        for (const element of declaration.elements) {
          values.push(yield* this.evaluate(element, scope));
        }
        if (declaration.arraySize) {
          const size = numeric(yield* this.evaluate(declaration.arraySize, scope), declaration.line);
          if (!Number.isInteger(size) || size < values.length || size > 65536) {
            throw new FirmwareRuntimeError('ขนาดอาร์เรย์ไม่ถูกต้องหรือเกินขีดจำกัดตัวจำลอง', declaration.line);
          }
          while (values.length < size) values.push(0);
        }
        if (isIntegerType(declaration.typeName)) {
          for (let index = 0; index < values.length; index++)
            values[index] = toInteger(values[index]);
          integerArrays.add(values);
        }
        const elementBytes = this.typeBytes(declaration.typeName);
        scope.declare(declaration.name, values, false,
          elementBytes === undefined ? undefined : values.length * elementBytes);
        return;
      }
      const size = declaration.arraySize
        ? numeric(yield* this.evaluate(declaration.arraySize, scope), declaration.line)
        : 0;
      const array = new Array<FirmwareValue>(Math.max(0, size)).fill(0);
      if (isIntegerType(declaration.typeName)) integerArrays.add(array);
      const elementBytes = this.typeBytes(declaration.typeName);
      scope.declare(declaration.name, array, false,
        elementBytes === undefined ? undefined : array.length * elementBytes);
      return;
    }

    const userType = declaration.typeName
      ? this.program.userTypes.get(declaration.typeName)
      : undefined;
    if (userType) {
      const record = { className: userType.name, fields: new Map<string, FirmwareValue>() };
      const fields = new Scope(scope);
      fields.declare('this', record);
      for (const field of userType.fields) {
        const value = field.initializer ? yield* this.evaluate(field.initializer, fields) : 0;
        record.fields.set(field.name, value);
        fields.declare(field.name, value, isIntegerType(field.typeName));
      }
      const constructor = userType.methods.get('__constructor');
      if (constructor) {
        const { args, references } = yield* this.prepareArguments(constructor, declaration.constructorArgs ?? [], scope);
        yield* this.invokeWithParent(constructor, args, fields, references);
        for (const name of record.fields.keys()) record.fields.set(name, fields.get(name) ?? 0);
      } else if (declaration.constructorArgs?.length) {
        throw new FirmwareRuntimeError(`${userType.name} ไม่มี constructor ที่รับพารามิเตอร์`, declaration.line);
      }
      scope.declare(declaration.name, record);
      return;
    }

    const factory = declaration.typeName ? LIBRARY_CLASSES.get(declaration.typeName) : undefined;
    if (factory && !declaration.initializer) {
      const args: FirmwareValue[] = [];
      for (const argument of declaration.constructorArgs ?? []) {
        args.push(yield* this.evaluate(argument, scope));
      }
      scope.declare(declaration.name, factory(args, this.io.library, declaration.line));
      return;
    }
    if (declaration.constructorArgs) {
      // `int x(5)` is ordinary C++; anything else built with arguments is a
      // library object this simulator does not emulate.
      if (declaration.typeName && !isPlainType(declaration.typeName)) {
        throw new FirmwareRuntimeError(
          `ตัวจำลองยังไม่รองรับ library ของ ${declaration.typeName}`,
          declaration.line,
        );
      }
      const [first] = declaration.constructorArgs;
      scope.declare(
        declaration.name,
        first ? yield* this.evaluate(first, scope) : 0,
        isIntegerType(declaration.typeName),
        this.typeBytes(declaration.typeName),
      );
      return;
    }

    const value = declaration.initializer
      ? yield* this.evaluate(declaration.initializer, scope)
      : 0;
    scope.declare(declaration.name, value, isIntegerType(declaration.typeName), this.typeBytes(declaration.typeName));
  }

  // --- expressions ---------------------------------------------------------

  private *evaluate(expression: Expression, scope: Scope): Generator<Signal, FirmwareValue> {
    switch (expression.kind) {
      case 'sizeof': {
        const bytes = expression.typeName
          ? this.typeBytes(expression.typeName)
          : expression.operand ? this.expressionBytes(expression.operand, scope) : undefined;
        if (bytes === undefined) throw new FirmwareRuntimeError('ตัวจำลองยังคำนวณ sizeof ของชนิดนี้ไม่ได้', expression.line);
        return bytes;
      }
      case 'number':
      case 'string':
      case 'boolean':
        return expression.value;

      case 'identifier': {
        if (scope.has(expression.name)) return scope.get(expression.name) ?? 0;
        const constant = CONSTANTS[expression.name];
        if (constant !== undefined) return constant;
        if (this.program.functions.has(expression.name)) {
          return {
            className: 'Function',
            functionName: expression.name,
            call: (_method, _args, line) => {
              throw new FirmwareRuntimeError('เรียก function callback เป็น object ไม่ได้', line);
            },
          };
        }
        throw new FirmwareRuntimeError(`ไม่รู้จักตัวแปร ${expression.name}`, expression.line);
      }

      case 'unary': {
        const operand = yield* this.evaluate(expression.operand, scope);
        switch (expression.operator) {
          case '-':
            return -numeric(operand, expression.line);
          case '+':
            return numeric(operand, expression.line);
          case '!':
            return !truthy(operand);
          case '~':
            return ~numeric(operand, expression.line);
          // No addresses in the VM: `&Wire` and `*ptr` are the value itself.
          case '&':
          case '*':
            return operand;
        }
        return 0;
      }

      case 'logical': {
        const left = yield* this.evaluate(expression.left, scope);
        // Short-circuit: the right side must not run when the left decides it.
        if (expression.operator === '&&' && !truthy(left)) return false;
        if (expression.operator === '||' && truthy(left)) return true;
        return truthy(yield* this.evaluate(expression.right, scope));
      }

      case 'binary': {
        const left = yield* this.evaluate(expression.left, scope);
        const right = yield* this.evaluate(expression.right, scope);
        return applyBinary(expression.operator, left, right, expression.line);
      }

      case 'conditional': {
        const test = truthy(yield* this.evaluate(expression.test, scope));
        return yield* this.evaluate(test ? expression.consequent : expression.alternate, scope);
      }

      case 'assignment': {
        const value = yield* this.evaluate(expression.value, scope);
        if (expression.operator === '=') {
          yield* this.assign(expression.target, value, scope);
          return value;
        }
        const current = yield* this.readTarget(expression.target, scope);
        const operator = expression.operator.slice(0, -1);
        const next = applyBinary(operator, current, value, expression.line);
        yield* this.assign(expression.target, next, scope);
        return next;
      }

      case 'update': {
        const current = numeric(yield* this.readTarget(expression.target, scope), expression.line);
        const next = expression.operator === '++' ? current + 1 : current - 1;
        yield* this.assign(expression.target, next, scope);
        return expression.prefix ? next : current;
      }

      case 'index': {
        const array = yield* this.readIdentifier(expression.array, scope);
        const position = numeric(yield* this.evaluate(expression.index, scope), expression.line);
        if (!Array.isArray(array)) {
          throw new FirmwareRuntimeError(
            `${expression.array.name} ไม่ใช่อาร์เรย์`,
            expression.line,
          );
        }
        // Reading past the end is undefined behaviour in C and a silent bug in a
        // sketch. Reporting it is the whole point of running the code here.
        if (position < 0 || position >= array.length) {
          throw new FirmwareRuntimeError(
            `อ่านนอกขอบเขตอาร์เรย์ ${expression.array.name}[${position}] ซึ่งมี ${array.length} ช่อง`,
            expression.line,
          );
        }
        return array[position] ?? 0;
      }

      case 'call':
        return yield* this.evaluateCall(expression.callee, expression.args, scope, expression.line);

      case 'memberCall':
        return yield* this.evaluateMemberCall(expression, scope);
      case 'memberRead': {
        const object = yield* this.evaluate(expression.object, scope);
        if (isFirmwareRecord(object)) {
          if (!object.fields.has(expression.field)) {
            throw new FirmwareRuntimeError(`${object.className} ไม่มี field ${expression.field}`, expression.line);
          }
          return object.fields.get(expression.field) ?? 0;
        }
        if (!isLibraryObject(object) || !object.read) throw new FirmwareRuntimeError(`ไม่รองรับ field ${expression.field}`, expression.line);
        return object.read(expression.field, expression.line);
      }
      case 'elementRead': {
        const array = yield* this.evaluate(expression.array, scope);
        const index = numeric(yield* this.evaluate(expression.index, scope), expression.line);
        if (!Array.isArray(array) || !Number.isInteger(index) || index < 0 || index >= array.length) throw new FirmwareRuntimeError('อ่านนอกขอบเขตอาร์เรย์', expression.line);
        return array[index];
      }
    }
  }

  private *readIdentifier(identifier: Identifier, scope: Scope): Generator<Signal, FirmwareValue> {
    if (!scope.has(identifier.name)) {
      throw new FirmwareRuntimeError(`ไม่รู้จักตัวแปร ${identifier.name}`, identifier.line);
    }
    return scope.get(identifier.name) ?? 0;
  }

  private *readTarget(
    target: Identifier | Index | Extract<Expression, { kind: 'memberRead' }>,
    scope: Scope,
  ): Generator<Signal, FirmwareValue> {
    return yield* this.evaluate(target, scope);
  }

  private *assign(
    target: Identifier | Index | Extract<Expression, { kind: 'memberRead' }>,
    value: FirmwareValue,
    scope: Scope,
  ): Generator<Signal, void> {
    if (target.kind === 'identifier') {
      if (!scope.set(target.name, value)) {
        // An assignment to a name that was never declared is a typo, not an
        // implicit global. Declaring it silently would hide the mistake.
        throw new FirmwareRuntimeError(`ไม่รู้จักตัวแปร ${target.name}`, target.line);
      }
      return;
    }

    if (target.kind === 'memberRead') {
      const object = yield* this.evaluate(target.object, scope);
      if (!isFirmwareRecord(object) || !object.fields.has(target.field)) {
        throw new FirmwareRuntimeError(`กำหนดค่า field ${target.field} ไม่ได้`, target.line);
      }
      object.fields.set(target.field, value);
      if (target.object.kind === 'identifier' && target.object.name === 'this') {
        scope.set(target.field, value);
      }
      return;
    }

    const array = yield* this.readIdentifier(target.array, scope);
    const position = numeric(yield* this.evaluate(target.index, scope), target.line);
    if (!Array.isArray(array)) {
      throw new FirmwareRuntimeError(`${target.array.name} ไม่ใช่อาร์เรย์`, target.line);
    }
    if (position < 0 || position >= array.length) {
      throw new FirmwareRuntimeError(
        `เขียนนอกขอบเขตอาร์เรย์ ${target.array.name}[${position}] ซึ่งมี ${array.length} ช่อง`,
        target.line,
      );
    }
    array[position] = integerArrays.has(array) ? toInteger(value) : value;
  }

  private typeBytes(type?: string): number | undefined {
    if (!type) return undefined;
    if (['bool', 'boolean', 'char', 'byte', 'int8_t', 'uint8_t'].includes(type)) return 1;
    if (['short', 'word', 'int16_t', 'uint16_t'].includes(type)) return 2;
    if (['int', 'size_t'].includes(type)) return this.intBytes;
    if (['long', 'float', 'int32_t', 'uint32_t'].includes(type)) return 4;
    if (type === 'double') return this.intBytes === 2 ? 4 : 8;
    return undefined;
  }

  /** sizeof never evaluates its operand: even an index with i++ has no side effects. */
  private expressionBytes(expression: Expression, scope: Scope): number | undefined {
    if (expression.kind === 'identifier') return scope.sizeOf(expression.name);
    if (expression.kind === 'index') {
      const array = scope.get(expression.array.name);
      const bytes = scope.sizeOf(expression.array.name);
      return Array.isArray(array) && array.length && bytes !== undefined ? bytes / array.length : undefined;
    }
    if (expression.kind === 'number') return Number.isInteger(expression.value) ? this.intBytes : this.typeBytes('double');
    if (expression.kind === 'boolean') return 1;
    if (expression.kind === 'string') return new TextEncoder().encode(expression.value).length + 1;
    if (expression.kind === 'update') return this.expressionBytes(expression.target, scope);
    return undefined;
  }

  private *prepareArguments(
    declaration: FunctionDeclaration,
    expressions: readonly Expression[],
    scope: Scope,
  ): Generator<Signal, { args: FirmwareValue[]; references: Map<string, ReferenceBinding> }> {
    const args: FirmwareValue[] = [];
    const references = new Map<string, ReferenceBinding>();
    for (const [index, expression] of expressions.entries()) {
      const parameter = declaration.parameters[index];
      if (declaration.referenceParameters?.includes(parameter)) {
        const reference = yield* this.referenceTo(expression, scope);
        references.set(parameter, reference);
        args.push(reference.get());
      } else args.push(yield* this.evaluate(expression, scope));
    }
    return { args, references };
  }

  private *referenceTo(expression: Expression, scope: Scope): Generator<Signal, ReferenceBinding> {
    if (expression.kind === 'identifier' && scope.has(expression.name)) {
      return {
        get: () => scope.get(expression.name) ?? 0,
        set: (value) => { scope.set(expression.name, value); },
        bytes: scope.sizeOf(expression.name),
      };
    }
    if (expression.kind === 'index') {
      const array = yield* this.readIdentifier(expression.array, scope);
      const index = numeric(yield* this.evaluate(expression.index, scope), expression.line);
      if (Array.isArray(array) && Number.isInteger(index) && index >= 0 && index < array.length) {
        return {
          get: () => array[index],
          set: (value) => { array[index] = integerArrays.has(array) ? toInteger(value) : value; },
          bytes: this.expressionBytes(expression, scope),
        };
      }
    }
    if (expression.kind === 'memberRead') {
      const object = yield* this.evaluate(expression.object, scope);
      if (isFirmwareRecord(object) && object.fields.has(expression.field)) {
        return { get: () => object.fields.get(expression.field) ?? 0, set: (value) => { object.fields.set(expression.field, value); } };
      }
    }
    throw new FirmwareRuntimeError('พารามิเตอร์อ้างอิงต้องรับตัวแปรหรือสมาชิกอาร์เรย์ที่มีอยู่', expression.line);
  }

  private *evaluateCall(
    callee: string,
    argExpressions: readonly Expression[],
    scope: Scope,
    line: number,
  ): Generator<Signal, FirmwareValue> {
    const user = this.program.functions.get(callee);
    if (user) {
      const { args, references } = yield* this.prepareArguments(user, argExpressions, scope);
      return yield* this.invokeWithParent(user, args, this.globals, references);
    }
    const args: FirmwareValue[] = [];
    for (const argument of argExpressions) {
      args.push(yield* this.evaluate(argument, scope));
    }


    const factory = LIBRARY_CLASSES.get(callee);
    if (factory) return factory(args, this.io.library, line);
    return yield* this.callBuiltin(callee, args, line);
  }

  private *callBuiltin(
    name: string,
    args: readonly FirmwareValue[],
    line: number,
  ): Generator<Signal, FirmwareValue> {
    const number = (index: number): number => numeric(args[index] ?? 0, line);

    switch (name) {
      case 'pinMode':
        this.io.pinMode(number(0), pinModeFrom(args[1]));
        return 0;

      case 'digitalWrite':
        this.io.digitalWrite(number(0), truthy(args[1]));
        return 0;

      case 'digitalRead':
        return this.io.digitalRead(number(0)) ? 1 : 0;

      case 'analogRead':
        return this.io.analogRead(number(0));

      case 'analogWrite':
        this.io.analogWrite(number(0), number(1));
        return 0;

      // ESP32 LEDC. Core 2.x addresses a channel set up with ledcSetup and bound
      // with ledcAttachPin; core 3.x addresses the pin itself after ledcAttach.
      // Either way the duty is scaled by the resolution the channel was given.
      case 'ledcSetup':
        this.ledc.set(number(0), { pin: this.ledc.get(number(0))?.pin ?? null, bits: number(2) || 8 });
        return number(1);
      case 'ledcAttachPin':
        this.ledc.set(number(1), { pin: number(0), bits: this.ledc.get(number(1))?.bits ?? 8 });
        return 0;
      case 'ledcAttach':
        this.ledc.set(number(0), { pin: number(0), bits: number(2) || 8 });
        return 1;
      case 'ledcAttachChannel':
        this.ledc.set(number(0), { pin: number(0), bits: number(2) || 8 });
        return 1;
      case 'ledcDetach':
      case 'ledcDetachPin':
        return 0;
      case 'ledcWrite': {
        const channel = this.ledc.get(number(0));
        const pin = channel?.pin ?? number(0);
        const full = 2 ** (channel?.bits ?? 8) - 1;
        this.io.analogWrite(pin, (number(1) / full) * 255);
        return 1;
      }
      case 'ledcWriteTone': {
        const pin = this.ledc.get(number(0))?.pin ?? number(0);
        if (number(1) > 0) this.io.tone(pin, number(1));
        else this.io.noTone(pin);
        return number(1);
      }

      case 'tone':
        this.io.tone(number(0), number(1), args.length >= 3 ? number(2) : undefined);
        return 0;
      case 'noTone':
        this.io.noTone(number(0));
        return 0;

      case 'delay':
        yield { type: 'delay', ms: Math.max(0, number(0)) };
        return 0;

      case 'delayMicroseconds':
        yield { type: 'delay', ms: Math.max(0, number(0)) / 1000 };
        return 0;

      case 'millis':
        return Math.floor(this.io.now());

      case 'micros':
        return Math.floor(this.io.now() * 1000);

      case 'map': {
        const [value, inMin, inMax, outMin, outMax] = [0, 1, 2, 3, 4].map(number);
        if (inMax === inMin) return outMin;
        // Arduino's map() is integer arithmetic on longs: the division truncates.
        return Math.trunc(((value - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
      }

      case 'constrain':
        return Math.min(Math.max(number(0), number(1)), number(2));

      case 'min':
        return Math.min(number(0), number(1));

      case 'max':
        return Math.max(number(0), number(1));

      case 'abs':
        return Math.abs(number(0));

      case 'pow':
        return Math.pow(number(0), number(1));

      case 'sqrt':
        return Math.sqrt(number(0));

      case 'floor':
        return Math.floor(number(0));

      case 'ceil':
        return Math.ceil(number(0));

      case 'round':
        return Math.round(number(0));

      case 'sin':
        return Math.sin(number(0));

      case 'cos':
        return Math.cos(number(0));

      case 'random':
        // One argument is an exclusive maximum; two are a range.
        return args.length >= 2
          ? Math.floor(Math.random() * (number(1) - number(0))) + number(0)
          : Math.floor(Math.random() * number(0));

      case 'randomSeed':
        return 0;

      case 'isnan':
        return Number.isNaN(number(0)) ? 1 : 0;

      case 'isinf':
        return Number.isFinite(number(0)) || Number.isNaN(number(0)) ? 0 : 1;

      // `F("text")` keeps a string in flash on an AVR; to the VM it is the string.
      case 'F':
        return args[0] ?? '';

      case 'String':
        return formatPrint(args[0], args[1]);

      case 'digitalPinToInterrupt':
        return number(0);

      case 'attachInterrupt': {
        const callback = args[1];
        if (!isFirmwareFunction(callback)) {
          throw new FirmwareRuntimeError('attachInterrupt ต้องรับชื่อฟังก์ชัน callback', line);
        }
        const pin = number(0);
        this.interruptHandlers.set(pin, {
          functionName: callback.functionName,
          mode: number(2),
          previous: this.io.digitalRead(pin),
        });
        return 0;
      }
      case 'detachInterrupt':
        this.interruptHandlers.delete(number(0));
        return 0;
      case 'yield':
        return 0;
      case 'noInterrupts':
        this.interruptHandlersEnabled = false;
        return 0;
      case 'interrupts':
        this.interruptHandlersEnabled = true;
        return 0;

      default:
        throw new FirmwareRuntimeError(`ยังไม่รองรับฟังก์ชัน ${name}() ในตัวจำลอง`, line);
    }
  }

  private *evaluateMemberCall(
    expression: Extract<Expression, { kind: 'memberCall' }>,
    scope: Scope,
  ): Generator<Signal, FirmwareValue> {
    const target = scope.has(expression.object) ? scope.get(expression.object) : undefined;
    if (isFirmwareRecord(target)) {
      const method = this.program.userTypes.get(target.className)?.methods.get(expression.method);
      if (!method) throw new FirmwareRuntimeError(`${target.className} ไม่มี method ${expression.method}()`, expression.line);
      const { args, references } = yield* this.prepareArguments(method, expression.args, scope);
      const fields = new Scope(this.globals);
      fields.declare('this', target);
      for (const [name, value] of target.fields) fields.declare(name, value);
      const result = yield* this.invokeWithParent(method, args, fields, references);
      for (const name of target.fields.keys()) target.fields.set(name, fields.get(name) ?? 0);
      return result;
    }
    const args: FirmwareValue[] = [];
    for (const argument of expression.args) {
      args.push(yield* this.evaluate(argument, scope));
    }

    if (expression.object === 'Serial') {
      switch (expression.method) {
        case 'begin':
          this.io.serialBegin(typeof args[0] === 'number' ? args[0] : Number(args[0] ?? 0));
          return 0;
        case 'end':
        case 'flush':
          return 0;
        case 'available':
          return 0;
        case 'print':
          this.io.serialWrite(formatPrint(args[0], args[1]));
          return 0;
        case 'println':
          this.io.serialWrite(`${args.length ? formatPrint(args[0], args[1]) : ''}\n`);
          return 0;
        case 'printf':
          this.io.serialWrite(formatPrintf(stringify(args[0]), args.slice(1)));
          return 0;
        default:
          return 0;
      }
    }

    // A library object: `dht.readTemperature()`, `display.print(...)`.
    if (typeof target === 'string') {
      const value = target;
      switch (expression.method) {
        case 'length':
          return value.length;
        case 'charAt':
          return value.charCodeAt(Math.max(0, Math.trunc(numeric(args[0] ?? 0, expression.line)))) || 0;
        case 'indexOf':
          return value.indexOf(stringify(args[0]), Math.max(0, Math.trunc(numeric(args[1] ?? 0, expression.line))));
        case 'startsWith':
          return value.startsWith(stringify(args[0])) ? 1 : 0;
        case 'endsWith':
          return value.endsWith(stringify(args[0])) ? 1 : 0;
        case 'equals':
          return value === stringify(args[0]) ? 1 : 0;
        case 'equalsIgnoreCase':
          return value.toLocaleLowerCase() === stringify(args[0]).toLocaleLowerCase() ? 1 : 0;
        case 'substring': {
          const start = Math.max(0, Math.trunc(numeric(args[0] ?? 0, expression.line)));
          const end = args.length > 1
            ? Math.max(0, Math.trunc(numeric(args[1], expression.line)))
            : value.length;
          return value.substring(Math.min(start, end), Math.max(start, end));
        }
        case 'toInt': {
          const match = value.trimStart().match(/^[+-]?\d+/);
          return match ? Number.parseInt(match[0], 10) : 0;
        }
        case 'toFloat': {
          const parsed = Number.parseFloat(value.trimStart());
          return Number.isFinite(parsed) ? parsed : 0;
        }
        case 'trim':
          scope.set(expression.object, value.trim());
          return 0;
        case 'toLowerCase':
          scope.set(expression.object, value.toLocaleLowerCase());
          return 0;
        case 'toUpperCase':
          scope.set(expression.object, value.toLocaleUpperCase());
          return 0;
        default:
          throw new FirmwareRuntimeError(`ตัวจำลองยังไม่รองรับ String.${expression.method}()`, expression.line);
      }
    }
    if (isLibraryObject(target)) {
      return target.call(expression.method, args, expression.line);
    }

    throw new FirmwareRuntimeError(
      scope.has(expression.object)
        ? `${expression.object} ไม่ใช่อ็อบเจกต์ที่มีเมท็อด ${expression.method}()`
        : `ตัวจำลองยังไม่รองรับ ${expression.object}.${expression.method}() — ไม่รู้จัก ${expression.object} หรือ library ของมัน`,
      expression.line,
    );
  }
}

/**
 * Integer variables hold integers: `int percent = 20.28` is 20, and
 * `raw = total / samples` into an int drops the remainder, as the board does.
 * Overflow is still not modelled; only the truncation a sketch can print.
 */
const INTEGER_TYPES = new Set([
  'int',
  'long',
  'short',
  'byte',
  'word',
  'size_t',
  'uint8_t',
  'uint16_t',
  'uint32_t',
  'uint64_t',
  'int8_t',
  'int16_t',
  'int32_t',
  'int64_t',
]);

function isIntegerType(typeName: string | undefined): boolean {
  return typeName !== undefined && INTEGER_TYPES.has(typeName);
}

/** Arrays declared with an integer element type. */
const integerArrays = new WeakSet<FirmwareValue[]>();

function toInteger(value: FirmwareValue): FirmwareValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'number') return value;
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Built-in C++ types that may be written with constructor syntax, `int x(5)`. */
function isPlainType(typeName: string): boolean {
  return /^(u?int(8|16|32|64)?_t|int|long|short|char|float|double|bool|boolean|byte|word|size_t|String|unsigned|signed)$/.test(
    typeName,
  );
}

function pinModeFrom(value: FirmwareValue | undefined): PinMode {
  const mode = typeof value === 'number' ? value : Number(value ?? 0);
  if (mode === 1) return 'output';
  if (mode === 2) return 'input_pullup';
  return 'input';
}

function applyBinary(
  operator: string,
  left: FirmwareValue,
  right: FirmwareValue,
  line: number,
): FirmwareValue {
  // String concatenation is the one place a non-numeric `+` is meaningful.
  if (operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
    return `${stringify(left)}${stringify(right)}`;
  }

  const a = numeric(left, line);
  const b = numeric(right, line);

  switch (operator) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) throw new FirmwareRuntimeError('หารด้วยศูนย์', line);
      return a / b;
    case '%':
      if (b === 0) throw new FirmwareRuntimeError('หารเอาเศษด้วยศูนย์', line);
      return a % b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '&':
      return a & b;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '<<':
      return a << b;
    case '>>':
      return a >> b;
    default:
      throw new FirmwareRuntimeError(`ไม่รองรับตัวดำเนินการ ${operator}`, line);
  }
}

export type { Signal };
