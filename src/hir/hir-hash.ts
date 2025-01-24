import * as H from "./hir";

export class HirHasher {
    private hash: number = 0;

    private combineHash(h: number) {
        this.hash = ((this.hash << 5) - this.hash) + h;
        this.hash = this.hash & this.hash;
    }

    private hashString(str: string) {
        for (let i = 0; i < str.length; i++) {
            this.combineHash(str.charCodeAt(i));
        }
    }

    private hashNumber(n: bigint) {
        this.hashString(n.toString());
    }

    private hashExpr(expr: H.HirExpr) {
        this.combineHash(expr.kind.length);
        this.hashString(expr.kind);

        switch (expr.kind) {
            case "identifier":
                this.hashIdentifier(expr);
                break;
            case "number":
                this.hashNumberLiteral(expr);
                break;
            case "binary":
                this.hashBinary(expr);
                break;
            case "call":
                this.hashCall(expr);
                break;
            default:
                this.assertNever(expr);
        }
    }

    private hashStmt(stmt: H.HirStmt) {
        this.combineHash(stmt.kind.length);
        this.hashString(stmt.kind);

        switch (stmt.kind) {
            case "return":
                if (stmt.expr !== null) {
                    this.hashExpr(stmt.expr);
                }
                break;
            case "expr_stmt":
                this.hashExpr(stmt.expr);
                break;
            case "variable":
                this.hashString(stmt.name);
                this.hashExpr(stmt.value);
                break;
            case "block":
                this.combineHash(stmt.stmts.length);
                for (const s of stmt.stmts) {
                    this.hashStmt(s);
                }
                break;
            case "if":
                this.hashExpr(stmt.condition);
                this.hashStmt(stmt.then);
                if (stmt.else) {
                    this.hashStmt(stmt.else);
                }
                break;
            default:
                this.assertNeverStmt(stmt);
        }
    }

    private hashIdentifier(node: H.HirIdentifier) {
        this.hashString(node.name);
    }

    private hashNumberLiteral(node: H.HirNumber) {
        this.hashNumber(node.value);
    }

    private hashBinary(node: H.HirBinaryOp) {
        this.hashString(node.op);
        this.hashExpr(node.left);
        this.hashExpr(node.right);
    }

    private hashCall(node: H.HirCall) {
        this.hashIdentifier(node.name);
        this.combineHash(node.args.length);
        for (const arg of node.args) {
            this.hashExpr(arg);
        }
    }

    private assertNever(x: H.HirExpr): never {
        throw new Error(`Unexpected expression type: ${x.kind}`);
    }

    private assertNeverStmt(x: H.HirStmt): never {
        throw new Error(`Unexpected statement type: ${x.kind}`);
    }

    calcHash(node: H.HirExpr | H.HirStmt): number {
        this.hash = 0;
        if (H.isStatement(node.kind)) {
            this.hashStmt(node as H.HirStmt);
        } else {
            this.hashExpr(node as H.HirExpr);
        }
        return this.hash;
    }
}

export function hash(node: H.HirExpr | H.HirStmt): number {
    return new HirHasher().calcHash(node);
}
