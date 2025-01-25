import * as H from "./hir";

export class HirPrinter {
    private result: string[] = [];
    private indent: number = 0;

    private line(text: string) {
        this.result.push("    ".repeat(this.indent) + text);
    }

    private printExpr(expr: H.HirExpr): string {
        switch (expr.kind) {
            case "identifier":
                return expr.name;
            case "number":
                return expr.value.toString();
            case "binary":
                return `${this.printExpr(expr.left)} ${expr.op} ${this.printExpr(expr.right)}`;
            case "call": {
                const args = expr.args.map(arg => this.printExpr(arg)).join(", ");
                return `${expr.name.name}(${args})`;
            }
            case "phi": {
                const args = expr.args.map(arg => this.printExpr(arg)).join(", ");
                return `phi(${args})`;
            }
        }
    }

    private printStmt(stmt: H.HirStmt) {
        switch (stmt.kind) {
            case "return":
                this.line(`return${stmt.expr ? " " + this.printExpr(stmt.expr) : ""}`);
                break;
            case "expr_stmt":
                this.line(this.printExpr(stmt.expr));
                break;
            case "assign":
                this.line(`${this.printExpr(stmt.left)} = ${this.printExpr(stmt.right)}`);
                break;
            case "variable":
                this.line(`let ${stmt.name.name} = ${this.printExpr(stmt.value)}`);
                break;
            case "if":
                this.line(`if (${this.printExpr(stmt.condition)}) `);
                this.printBlock(stmt.then);
                if (stmt.else) {
                    this.line("else ");
                    this.printBlock(stmt.else);
                }
                break;
            case "block": {
                throw new Error('Not implemented yet: "block" case')
            }
        }
    }

    private printBlock(block: H.HirBlock) {
        this.line("{");
        this.indent++;

        for (const stmt of block.stmts) {
            this.printStmt(stmt);
        }

        this.indent--;
        this.line("}");
    }

    print(node: H.HirExpr | H.HirStmt | H.HirBlock): string {
        this.result = [];
        this.indent = 0;

        if (node.kind === "identifier") {
            return node.name;
        }

        if (node.kind === "assign") {
            this.printStmt(node);
            return this.result.join("\n");
        }

        if ("stmts" in node) {
            this.printBlock(node);
        } else if ("expr" in node || "name" in node) {
            this.printStmt(node as H.HirStmt);
        } else {
            this.line(this.printExpr(node as H.HirExpr));
        }

        return this.result.join("\n");
    }
}

export function print(node: H.HirExpr | H.HirStmt | H.HirBlock): string {
    return new HirPrinter().print(node);
} 
