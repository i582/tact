export type HirExpr = HirIdentifier | HirNumber | HirBinaryOp | HirCall | HirPhi;
export type HirStmt = HirReturn | HirAssign | HirExprStmt | HirVariable | HirBlock | HirIfStmt;

export type HirExprParent = HirExpr | HirStmt | null;
export type HirStmtParent = HirStmt | null;

export type BinaryOps = "+" | "-" | "*" | "/" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export function isStatement(kind: string): boolean {
    return kind === "return" || kind === "variable" || kind === "expr_stmt" || kind === "block" || kind === "if" || kind === "assign" || kind === "phi";
}

export function isExpression(kind: string): boolean {
    return kind === "identifier" || kind === "number" || kind === "binary" || kind === "call"
}

export type HirIdentifier = {
    kind: "identifier";
    name: string;
};

export type HirNumber = {
    kind: "number";
    value: bigint;
};

export type HirBinaryOp = {
    kind: "binary"
    left: HirExpr
    op: BinaryOps
    right: HirExpr
}

export type HirCall = {
    kind: "call"
    name: HirIdentifier
    args: HirExpr[]
}

export type HirVariable = {
    kind: "variable";
    name: HirIdentifier;
    value: HirExpr
}

export type HirExprStmt = {
    kind: "expr_stmt"
    expr: HirExpr
}

export type HirAssign = {
    kind: "assign"
    left: HirExpr
    right: HirExpr
}

export type HirReturn = {
    kind: "return"
    expr: HirExpr | null
}

export type HirBlock = {
    kind: "block"
    stmts: HirStmt[]
}

export type HirParam = {
    kind: "param"
    name: string;
}

export type HirFunc = {
    kind: "func"
    name: string
    params: HirParam[]
    body: HirBlock
}

export type HirIfStmt = {
    kind: "if"
    condition: HirExpr
    then: HirBlock
    else?: HirBlock
}

export interface HirPhi {
    kind: "phi";
    args: HirIdentifier[];
}
