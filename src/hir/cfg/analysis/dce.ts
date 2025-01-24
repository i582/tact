import * as H from "../../hir";
import {Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID} from "../block";

export class DeadCodeElimination {
    private usedVariables: Set<string> = new Set();
    private definedVariables: Map<string, H.HirStmt> = new Map();

    constructor(private cfg: Cfg) {
    }

    optimize(): void {
        this.collectDefinitions();
        this.findUsages();
        this.removeUnused();
    }

    private collectDefinitions(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            const block = this.cfg[blockId]!;

            for (const stmt of block.stmts) {
                if (stmt.kind === "variable") {
                    this.definedVariables.set(stmt.name.name, stmt);
                }
            }
        }
    }

    private findUsages(): void {
        const processExpr = (expr: H.HirExpr): void => {
            switch (expr.kind) {
                case "identifier":
                    this.usedVariables.add(expr.name);
                    break;
                case "binary":
                    processExpr(expr.left);
                    processExpr(expr.right);
                    break;
                case "call":
                    expr.args.forEach(processExpr);
                    break;
                case "number":
                    break;
            }
        };

        const processStmt = (stmt: H.HirStmt): void => {
            switch (stmt.kind) {
                case "return":
                    if (stmt.expr) processExpr(stmt.expr);
                    break;
                case "expr_stmt":
                    processExpr(stmt.expr);
                    break;
                case "assign":
                    processExpr(stmt.left);
                    processExpr(stmt.right);
                    break;
                case "variable":
                    processExpr(stmt.value);
                    break;
                case "if":
                    processExpr(stmt.condition);
                    stmt.then.stmts.forEach(processStmt);
                    stmt.else?.stmts.forEach(processStmt);
                    break;
                case "block":
                    stmt.stmts.forEach(processStmt);
                    break;
            }
        };

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            const block = this.cfg[blockId]!;

            block.stmts.forEach(processStmt);

            if (block.terminator.kind === "conditional") {
                processExpr(block.terminator.condition);
            }
        }
    }

    private removeUnused(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            const block = this.cfg[blockId]!;

            block.stmts = block.stmts.filter(stmt => {
                if (stmt.kind !== "variable") return true;

                const name = stmt.name.name;
                return this.usedVariables.has(name) || this.hasEffects(stmt.value);
            });
        }
    }

    private hasEffects(expr: H.HirExpr): boolean {
        switch (expr.kind) {
            case "call":
                return true; // for now
            case "binary":
                return this.hasEffects(expr.left) || this.hasEffects(expr.right);
            case "identifier":
            case "number":
                return false;
        }
    }
} 
