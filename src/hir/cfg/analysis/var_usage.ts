import * as H from "../../hir";
import { Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID } from "../block";

export class VariableUsageAnalyzer {
    private usages: Map<string, number> = new Map();

    constructor(private cfg: Cfg) {}

    analyze(): Map<string, number> {
        this.usages.clear();

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID)
                continue;

            const block = this.cfg[blockId]!;

            for (const stmt of block.stmts) {
                this.analyzeStmt(stmt);
            }

            if (block.terminator.kind === "conditional") {
                this.analyzeExpr(block.terminator.condition);
            }
        }

        return this.usages;
    }

    private analyzeStmt(stmt: H.HirStmt) {
        switch (stmt.kind) {
            case "expr_stmt":
                this.analyzeExpr(stmt.expr);
                break;

            case "variable":
                this.analyzeExpr(stmt.value);
                break;

            case "assign":
                this.analyzeExpr(stmt.right);
                break;

            case "return":
                if (stmt.expr) {
                    this.analyzeExpr(stmt.expr);
                }
                break;
            case "block":
                break;
            case "if":
                break;
        }
    }

    private analyzeExpr(expr: H.HirExpr) {
        switch (expr.kind) {
            case "identifier":
                this.incrementUsage(expr.name);
                break;

            case "binary":
                this.analyzeExpr(expr.left);
                this.analyzeExpr(expr.right);
                break;

            case "call":
                this.analyzeExpr(expr.name);
                for (const arg of expr.args) {
                    this.analyzeExpr(arg);
                }
                break;

            case "phi":
                for (const arg of expr.args) {
                    this.incrementUsage(arg.name);
                }
                break;
            case "number":
                break;
        }
    }

    private incrementUsage(varName: string) {
        const currentCount = this.usages.get(varName) ?? 0;
        this.usages.set(varName, currentCount + 1);
    }
}
