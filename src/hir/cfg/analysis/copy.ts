import * as H from "../../hir";
import {BasicBlock, Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID} from "../block";

type CopyTable = Record<string, string>;
type ConstTable = Map<string, H.HirNumber>;

export class CopyPropagation {
    constructor(private cfg: Cfg) {
    }

    private optimizeBlock(block: BasicBlock): void {
        const copyTable: CopyTable = {};
        const constTable: ConstTable = new Map();

        for (const stmt of block.stmts) {
            if (stmt.kind === "variable") {
                const name = stmt.name.name;
                if (stmt.value.kind === "number") {
                    constTable.set(name, stmt.value);
                } else if (stmt.value.kind === "identifier") {
                    const constValue = constTable.get(stmt.value.name);
                    if (constValue) {
                        constTable.set(name, constValue);
                    } else {
                        constTable.delete(name);
                    }
                } else {
                    constTable.delete(name);
                }
            } else if (stmt.kind === "assign" && stmt.left.kind === "identifier") {
                constTable.delete(stmt.left.name);
            }
        }

        for (let i = 0; i < block.stmts.length; i++) {
            const stmt = block.stmts[i]!;
            
            if (stmt.kind === "variable") {
                const expr = stmt.value;

                if (expr.kind === "identifier") {
                    copyTable[stmt.name.name] = expr.name;

                    const original = this.findOriginal(expr.name, copyTable);
                    if (original !== expr.name) {
                        block.stmts[i] = {
                            kind: "variable",
                            name: stmt.name,
                            value: {
                                kind: "identifier",
                                name: original
                            }
                        };
                    }
                } else {
                    block.stmts[i] = {
                        kind: "variable",
                        name: stmt.name,
                        value: this.replaceConstants(this.replaceCopies(expr, copyTable), constTable)
                    };
                }
            }
        }

        block.stmts = block.stmts.filter((stmt, i) => {
            if (stmt.kind !== "variable") return true;

            const name = stmt.name.name;

            if (constTable.has(name)) {
                return block.stmts.slice(i + 1).some(s =>
                    this.usesVariable(s, name));
            }

            if (stmt.value.kind === "identifier") {
                return block.stmts.slice(i + 1).some(s =>
                    this.usesVariable(s, name));
            }

            return true;
        });
    }

    private replaceConstants(expr: H.HirExpr, constTable: ConstTable): H.HirExpr {
        switch (expr.kind) {
            case "identifier": {
                const constValue = constTable.get(expr.name);
                if (constValue) {
                    return constValue;
                }
                return expr;
            }
            case "binary": {
                const left = this.replaceConstants(expr.left, constTable);
                const right = this.replaceConstants(expr.right, constTable);
                
                if (left.kind === "number" && right.kind === "number") {
                    switch (expr.op) {
                        case "+": return { kind: "number", value: left.value + right.value };
                        case "-": return { kind: "number", value: left.value - right.value };
                        case "*": return { kind: "number", value: left.value * right.value };
                    }
                }
                
                return {
                    kind: "binary",
                    left,
                    op: expr.op,
                    right
                };
            }
            case "call":
                return {
                    kind: "call",
                    name: expr.name,
                    args: expr.args.map(arg => this.replaceConstants(arg, constTable))
                };
            default:
                return expr;
        }
    }

    private findOriginal(varName: string, copyTable: CopyTable): string {
        let current: string | undefined = varName;
        const seen: Set<string> = new Set();

        while (current && current in copyTable && !seen.has(current)) {
            seen.add(current);
            current = copyTable[current];
        }

        if (!current) return ""
        return current;
    }

    private replaceCopies(expr: H.HirExpr, copyTable: CopyTable): H.HirExpr {
        switch (expr.kind) {
            case "identifier": {
                const original = this.findOriginal(expr.name, copyTable);
                return {
                    kind: "identifier",
                    name: original
                };
            }
            case "binary":
                return {
                    kind: "binary",
                    left: this.replaceCopies(expr.left, copyTable),
                    op: expr.op,
                    right: this.replaceCopies(expr.right, copyTable)
                };
            case "call":
                return {
                    kind: "call",
                    name: expr.name,
                    args: expr.args.map(arg => this.replaceCopies(arg, copyTable))
                };
            default:
                return expr;
        }
    }

    private usesVariable(stmt: H.HirStmt, varName: string): boolean {
        if (stmt.kind === "variable") {
            return this.containsVariable(stmt.value, varName);
        }
        if (stmt.kind === "return" && stmt.expr) {
            return this.containsVariable(stmt.expr, varName);
        }
        if (stmt.kind === "if") {
            return this.containsVariable(stmt.condition, varName) ||
                stmt.then.stmts.some(s => this.usesVariable(s, varName)) ||
                (stmt.else?.stmts.some(s => this.usesVariable(s, varName)) ?? false);
        }
        return false;
    }

    private containsVariable(expr: H.HirExpr, varName: string): boolean {
        switch (expr.kind) {
            case "identifier":
                return expr.name === varName;
            case "binary":
                return this.containsVariable(expr.left, varName) ||
                    this.containsVariable(expr.right, varName);
            case "call":
                return expr.args.some(arg => this.containsVariable(arg, varName));
            default:
                return false;
        }
    }

    optimize(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            this.optimizeBlock(this.cfg[blockId]!);
        }
    }
} 
