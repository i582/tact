export type HirExpr = HirIdentifier | HirNumber | HirBinaryOp | HirCall;
export type HirStmt = HirReturn | HirExprStmt | HirVariable | HirBlock | HirIfStmt;

export type HirExprParent = HirExpr | HirStmt | null;
export type HirStmtParent = HirStmt | null;

export function isStatement(kind: string): boolean {
    return kind === "return" || kind === "variable" || kind === "expr_stmt" || kind === "block" || kind === "if"
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
    op: string
    right: HirExpr
}

export type HirCall = {
    kind: "call"
    name: HirIdentifier
    args: HirExpr[]
}

export type HirVariable = {
    kind: "variable";
    name: string;
    value: HirExpr
}

export type HirExprStmt = {
    kind: "expr_stmt"
    expr: HirExpr
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
