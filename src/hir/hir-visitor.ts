import * as H from "./hir";
import {hash} from "./hir-hash";
import {HirExpr, HirStmt, isStatement} from "./hir";

export interface Visitor {
    parents: (H.HirExpr | H.HirStmt)[];

    visitExpr(expr: H.HirExpr): void;

    visitStmt(stmt: H.HirStmt): void;
}

export function walkExpr<V extends Visitor>(visitor: V, expr: H.HirExpr): void {
    visitor.visitExpr(expr);

    switch (expr.kind) {
        case "identifier":
            return;
        case "number":
            return;
        case "binary":
            visitor.parents.push(expr);
            walkExpr(visitor, expr.left);
            walkExpr(visitor, expr.right)
            visitor.parents.pop();
            return;
        case "call":
            visitor.parents.push(expr);
            walkExpr(visitor, expr.name)
            for (const arg of expr.args) {
                walkExpr(visitor, arg)
            }
            visitor.parents.pop();
            return;
        default:
            assertNever(expr);
    }
}

export function walkStmt<V extends Visitor>(visitor: V, stmt: H.HirStmt): void {
    visitor.visitStmt(stmt);

    switch (stmt.kind) {
        case "return":
            visitor.parents.push(stmt);
            if (stmt.expr !== null) {
                walkExpr(visitor, stmt.expr)
            }
            visitor.parents.pop();
            return;
        case "expr_stmt":
            visitor.parents.push(stmt);
            walkExpr(visitor, stmt.expr)
            visitor.parents.pop();
            return;
        case "assign":
            visitor.parents.push(stmt);
            walkExpr(visitor, stmt.left)
            walkExpr(visitor, stmt.right)
            visitor.parents.pop();
            return;
        case "variable":
            visitor.parents.push(stmt);
            walkExpr(visitor, stmt.name)
            walkExpr(visitor, stmt.value)
            visitor.parents.pop();
            return;
        case "block":
            visitor.parents.push(stmt);
            stmt.stmts.forEach(stmt => {
                walkStmt(visitor, stmt)
            })
            visitor.parents.pop();
            return;
        case "if":
            visitor.parents.push(stmt);
            walkExpr(visitor, stmt.condition);
            walkStmt(visitor, stmt.then);
            if (stmt.else) {
                walkStmt(visitor, stmt.else);
            }
            visitor.parents.pop();
            return;
        default:
            assertNeverStmt(stmt);
    }
}

export function visitFunc<V extends Visitor>(visitor: V, func: H.HirFunc): void {
    for (const stmt of func.body.stmts) {
        visitor.visitStmt(stmt);
    }
}

function assertNever(x: H.HirExpr): never {
    throw new Error(`Unexpected expression type: ${x.kind}`);
}

function assertNeverStmt(x: H.HirStmt): never {
    throw new Error(`Unexpected statement type: ${x.kind}`);
}

class TraverseVisitor implements Visitor {
    public parents: (H.HirExpr | H.HirStmt)[] = [];

    constructor(
        private exprCallback: (expr: H.HirExpr, parent: H.HirExprParent) => void,
        private stmtCallback?: (stmt: H.HirStmt, parent: H.HirStmtParent) => void
    ) {
    }

    visitExpr(expr: H.HirExpr): void {
        const parent = this.parents[this.parents.length - 1] ?? null;
        this.exprCallback(expr, parent);
    }

    visitStmt(stmt: H.HirStmt): void {
        const parent = this.parents[this.parents.length - 1] as H.HirStmt | null;
        this.stmtCallback?.(stmt, parent);
    }
}

class ReplaceVisitor implements Visitor {
    public parents: (H.HirExpr | H.HirStmt)[] = [];

    constructor(
        private what: H.HirExpr | H.HirStmt,
        private with_: H.HirExpr | H.HirStmt
    ) {
    }

    visitExpr(expr: H.HirExpr): void {
        if (!H.isStatement(this.what.kind) && hash(expr) === hash(this.what)) {
            Object.assign(expr, this.with_);
            return;
        }
    }

    visitStmt(stmt: H.HirStmt): void {
        if (H.isStatement(this.what.kind) && hash(stmt) === hash(this.what)) {
            Object.assign(stmt, this.with_);
            return;
        }
    }
}

export function traverse(expr: H.HirExpr, callback: (expr: H.HirExpr, parent: H.HirExprParent) => void): void {
    new TraverseVisitor(callback).visitExpr(expr);
}

export function traverseStmt(
    stmt: H.HirStmt,
    exprCallback: (expr: H.HirExpr, parent: H.HirExprParent) => void,
    stmtCallback: (stmt: H.HirStmt, parent: H.HirStmtParent) => void = () => {
    }
): void {
    new TraverseVisitor(exprCallback, stmtCallback).visitStmt(stmt);
}

export function replace(
    what: H.HirExpr | H.HirStmt,
    where: H.HirExpr | H.HirStmt,
    with_: H.HirExpr | H.HirStmt
): void {
    if (H.isStatement(what.kind) !== H.isStatement(with_.kind)) {
        throw new Error("Cannot replace expression with statement or vice versa");
    }

    const visitor = new ReplaceVisitor(what, with_);
    if (isStatement(where.kind)) {
        walkStmt(visitor, where as HirStmt);
    } else {
        walkStmt(visitor, where as HirStmt);
    }
}

export class ReplaceNameVisitor implements Visitor {
    public parents: (H.HirExpr | H.HirStmt)[] = [];

    constructor(
        private names: Map<string, HirExpr>,
    ) {
    }

    visitExpr(expr: H.HirExpr): void {
        if (expr.kind === "identifier" && this.names.has(expr.name)) {
            Object.assign(expr, this.names.get(expr.name));
            return;
        }

        if (expr.kind === "identifier" && expr.name.startsWith("_")) {
            expr.name = `_${expr.name}`
            return;
        }
    }

    visitStmt(_stmt: H.HirStmt): void {
    }
}
