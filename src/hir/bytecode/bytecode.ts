export type BaseOp = {
    id: number;
};

export type Op = BaseOp &
    (
        | Push
        | PushInt
        | Add
        | Sub
        | Mul
        | Div
        | Equal
        | Less
        | Greater
        | LessOrEqual
        | GreaterOrEqual
        | NotEqual
        | Dup
        | Drop
        | BulkDrop
        | BulkDrop2
        | Swap
        | Rot
        | RevRot
        | Call
        | InlineCall
        | Return
        | DumpStack
        | Null
    );

// Базовые стековые операции
export type Push = {
    kind: "PUSH";
    value: string;
};

export type PushInt = {
    kind: "PUSHINT";
    value: bigint;
};

export type Dup = {
    kind: "DUP";
};

export type Drop = {
    kind: "DROP";
};

export type BulkDrop = {
    kind: "BLKDROP";
    count: number;
};

export type BulkDrop2 = {
    kind: "BLKDROP2";
    count: number;
    index: number;
};

export type Swap = {
    kind: "SWAP";
};

export type Rot = {
    kind: "ROT";
};

export type RevRot = {
    kind: "REVROT";
};

// Арифметические операции
export type Add = {
    kind: "ADD";
};

export type Sub = {
    kind: "SUB";
};

export type Mul = {
    kind: "MUL";
};

export type Div = {
    kind: "DIV";
};

// Операции сравнения
export type Equal = {
    kind: "EQUAL";
};

export type NotEqual = {
    kind: "NEQ";
};

export type Less = {
    kind: "LESS";
};

export type Greater = {
    kind: "GREATER";
};

export type LessOrEqual = {
    kind: "LEQ";
};

export type GreaterOrEqual = {
    kind: "GEQ";
};

// Операции управления
export type Call = {
    kind: "CALL";
    function: string;
};

export type InlineCall = {
    kind: "INLINECALLDICT";
    function: string;
};

export type Return = {
    kind: "RET";
};

export type Null = {
    kind: "NULL";
};

// Отладочные операции
export type DumpStack = {
    kind: "DUMPSTK";
};

// Вспомогательные типы
export type StackEffect = {
    consume: number;
    produce: number;
};

// Таблица эффектов команд на стек
export const stackEffects: Record<Op["kind"], StackEffect> = {
    PUSH: { consume: 0, produce: 1 },
    PUSHINT: { consume: 0, produce: 1 },
    DUP: { consume: 1, produce: 2 },
    DROP: { consume: 1, produce: 0 },
    BLKDROP: { consume: -1, produce: 0 }, // -1 означает переменное количество
    BLKDROP2: { consume: -1, produce: -1 }, // зависит от параметров
    SWAP: { consume: 2, produce: 2 },
    ROT: { consume: 3, produce: 3 },
    REVROT: { consume: 3, produce: 3 },
    ADD: { consume: 2, produce: 1 },
    SUB: { consume: 2, produce: 1 },
    MUL: { consume: 2, produce: 1 },
    DIV: { consume: 2, produce: 1 },
    EQUAL: { consume: 2, produce: 1 },
    NEQ: { consume: 2, produce: 1 },
    LESS: { consume: 2, produce: 1 },
    GREATER: { consume: 2, produce: 1 },
    LEQ: { consume: 2, produce: 1 },
    GEQ: { consume: 2, produce: 1 },
    CALL: { consume: -1, produce: 1 }, // -1 означает переменное количество
    INLINECALLDICT: { consume: -1, produce: 1 }, // -1 означает переменное количество
    RET: { consume: 1, produce: 0 },
    NULL: { consume: 0, produce: 1 },
    DUMPSTK: { consume: 0, produce: 0 },
};

// Добавим счетчик ID
let nextOpId = 0;
const getNextOpId = () => nextOpId++;

// Функции создания операций
export const createOp = {
    push: (value: string): Op & Push => ({
        id: getNextOpId(),
        kind: "PUSH",
        value,
    }),
    pushInt: (value: bigint): Op & PushInt => ({
        id: getNextOpId(),
        kind: "PUSHINT",
        value,
    }),
    dup: (): Op & Dup => ({
        id: getNextOpId(),
        kind: "DUP",
    }),
    drop: (): Op & Drop => ({
        id: getNextOpId(),
        kind: "DROP",
    }),
    bulkDrop: (count: number): Op & BulkDrop => ({
        id: getNextOpId(),
        kind: "BLKDROP",
        count,
    }),
    bulkDrop2: (count: number, index: number): Op & BulkDrop2 => ({
        id: getNextOpId(),
        kind: "BLKDROP2",
        count,
        index,
    }),
    swap: (): Op & Swap => ({
        id: getNextOpId(),
        kind: "SWAP",
    }),
    rot: (): Op & Rot => ({
        id: getNextOpId(),
        kind: "ROT",
    }),
    revRot: (): Op & RevRot => ({
        id: getNextOpId(),
        kind: "REVROT",
    }),
    add: (): Op & Add => ({
        id: getNextOpId(),
        kind: "ADD",
    }),
    sub: (): Op & Sub => ({
        id: getNextOpId(),
        kind: "SUB",
    }),
    mul: (): Op & Mul => ({
        id: getNextOpId(),
        kind: "MUL",
    }),
    div: (): Op & Div => ({
        id: getNextOpId(),
        kind: "DIV",
    }),
    equal: (): Op & Equal => ({
        id: getNextOpId(),
        kind: "EQUAL",
    }),
    notEqual: (): Op & NotEqual => ({
        id: getNextOpId(),
        kind: "NEQ",
    }),
    less: (): Op & Less => ({
        id: getNextOpId(),
        kind: "LESS",
    }),
    greater: (): Op & Greater => ({
        id: getNextOpId(),
        kind: "GREATER",
    }),
    lessOrEqual: (): Op & LessOrEqual => ({
        id: getNextOpId(),
        kind: "LEQ",
    }),
    greaterOrEqual: (): Op & GreaterOrEqual => ({
        id: getNextOpId(),
        kind: "GEQ",
    }),
    call: (func: string): Op & Call => ({
        id: getNextOpId(),
        kind: "CALL",
        function: func,
    }),
    inlineCall: (func: string): Op & InlineCall => ({
        id: getNextOpId(),
        kind: "INLINECALLDICT",
        function: func,
    }),
    return: (): Op & Return => ({
        id: getNextOpId(),
        kind: "RET",
    }),
    null: (): Op & Null => ({
        id: getNextOpId(),
        kind: "NULL",
    }),
    dumpStack: (): Op & DumpStack => ({
        id: getNextOpId(),
        kind: "DUMPSTK",
    }),
};
