/**
 * AST for the Arduino subset.
 *
 * Every node carries the source line so a runtime fault — a division by zero, a
 * call to something that was never defined — can be reported against the line
 * the user wrote rather than against the interpreter.
 */

export interface Node {
  readonly line: number;
}

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | Identifier
  | Unary
  | SizeOf
  | Binary
  | Logical
  | Assignment
  | Update
  | Conditional
  | Call
  | MemberCall
  | MemberRead
  | ElementRead
  | Index;

/** Read-only fields exported explicitly by a library, never JavaScript properties. */
export interface MemberRead extends Node {
  readonly kind: 'memberRead';
  readonly object: Expression;
  readonly field: string;
}

export interface ElementRead extends Node {
  readonly kind: 'elementRead';
  readonly array: Expression;
  readonly index: Expression;
}

export interface NumberLiteral extends Node {
  readonly kind: 'number';
  readonly value: number;
}

export interface StringLiteral extends Node {
  readonly kind: 'string';
  readonly value: string;
}

export interface BooleanLiteral extends Node {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface Identifier extends Node {
  readonly kind: 'identifier';
  readonly name: string;
}

export interface Unary extends Node {
  readonly kind: 'unary';
  /**
   * `&` and `*` are accepted so `&Wire` and `*ptr` parse; the VM has no
   * addresses, and a library object is passed by reference either way.
   */
  readonly operator: '-' | '+' | '!' | '~' | '&' | '*';
  readonly operand: Expression;
}

export interface SizeOf extends Node {
  readonly kind: 'sizeof';
  readonly typeName?: string;
  readonly operand?: Expression;
}

export interface Binary extends Node {
  readonly kind: 'binary';
  readonly operator: string;
  readonly left: Expression;
  readonly right: Expression;
}

/** Separate from `Binary` because `&&` and `||` must not evaluate both sides. */
export interface Logical extends Node {
  readonly kind: 'logical';
  readonly operator: '&&' | '||';
  readonly left: Expression;
  readonly right: Expression;
}

export interface Assignment extends Node {
  readonly kind: 'assignment';
  /** `=`, or a compound operator such as `+=`. */
  readonly operator: string;
  readonly target: Identifier | Index | MemberRead;
  readonly value: Expression;
}

export interface Update extends Node {
  readonly kind: 'update';
  readonly operator: '++' | '--';
  readonly prefix: boolean;
  readonly target: Identifier | Index | MemberRead;
}

export interface Conditional extends Node {
  readonly kind: 'conditional';
  readonly test: Expression;
  readonly consequent: Expression;
  readonly alternate: Expression;
}

export interface Call extends Node {
  readonly kind: 'call';
  readonly callee: string;
  readonly args: readonly Expression[];
}

/** `Serial.println(x)`, `dht.readTemperature()`. */
export interface MemberCall extends Node {
  readonly kind: 'memberCall';
  readonly object: string;
  readonly method: string;
  readonly args: readonly Expression[];
}

export interface Index extends Node {
  readonly kind: 'index';
  readonly array: Identifier;
  readonly index: Expression;
}

export type Statement =
  | VariableDeclaration
  | ExpressionStatement
  | Block
  | If
  | While
  | DoWhile
  | For
  | Return
  | Break
  | Continue
  | Switch
  | Empty;

export interface VariableDeclaration extends Node {
  readonly kind: 'variable';
  readonly name: string;
  /** Present for `int values[4]`; the size expression, or null for `int v[] = {…}`. */
  readonly arraySize: Expression | null;
  readonly isArray: boolean;
  readonly initializer: Expression | null;
  readonly elements: readonly Expression[] | null;
  /** The declared type as written, e.g. `DHT` or `int`. */
  readonly typeName?: string;
  /** `DHT dht(4, DHT22);` — arguments to the object's constructor. */
  readonly constructorArgs?: readonly Expression[];
}

export interface Switch extends Node {
  readonly kind: 'switch';
  readonly discriminant: Expression;
  /** In source order; `test` is null for `default:`. Bodies fall through. */
  readonly cases: readonly {
    readonly test: Expression | null;
    readonly body: readonly Statement[];
  }[];
}

export interface ExpressionStatement extends Node {
  readonly kind: 'expression';
  readonly expression: Expression;
}

export interface Block extends Node {
  readonly kind: 'block';
  readonly body: readonly Statement[];
}

export interface If extends Node {
  readonly kind: 'if';
  readonly test: Expression;
  readonly consequent: Statement;
  readonly alternate: Statement | null;
}

export interface While extends Node {
  readonly kind: 'while';
  readonly test: Expression;
  readonly body: Statement;
}

export interface DoWhile extends Node {
  readonly kind: 'doWhile';
  readonly test: Expression;
  readonly body: Statement;
}

export interface For extends Node {
  readonly kind: 'for';
  readonly init: Statement | null;
  readonly test: Expression | null;
  readonly update: Expression | null;
  readonly body: Statement;
}

export interface Return extends Node {
  readonly kind: 'return';
  readonly value: Expression | null;
}

export interface Break extends Node {
  readonly kind: 'break';
}

export interface Continue extends Node {
  readonly kind: 'continue';
}

export interface Empty extends Node {
  readonly kind: 'empty';
}

export interface FunctionDeclaration extends Node {
  readonly name: string;
  readonly parameters: readonly string[];
  readonly referenceParameters?: readonly string[];
  readonly body: Block;
}

export interface Program {
  readonly functions: ReadonlyMap<string, FunctionDeclaration>;
  readonly userTypes: ReadonlyMap<string, UserTypeDeclaration>;
  /** Declarations outside any function, run once before `setup()`. */
  readonly globals: readonly VariableDeclaration[];
}

/** A deliberately small, data-oriented C++ struct/class definition. */
export interface UserTypeDeclaration {
  readonly name: string;
  readonly fields: readonly VariableDeclaration[];
  readonly methods: ReadonlyMap<string, FunctionDeclaration>;
}
