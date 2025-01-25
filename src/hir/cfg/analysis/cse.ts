import * as H from "../../hir";
import { Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID, BasicBlock } from "../block";
import { hash } from "../../hir-hash";

type ExpressionTable = Record<number, string>;

export class CommonSubexpressionElimination {
    constructor(private cfg: Cfg) {}

    private replaceWithTemp(stmt: H.HirStmt, tempVar: string): H.HirStmt {
        if (stmt.kind !== "variable") return stmt;

        return {
            kind: "variable",
            name: stmt.name,
            value: {
                kind: "identifier",
                name: tempVar,
            },
        };
    }

    private optimizeBlock(block: BasicBlock): void {
        const expressionTable: ExpressionTable = {};

        for (let i = 0; i < block.stmts.length; i++) {
            const stmt = block.stmts[i]!;

            if (stmt.kind === "variable") {
                const expr = stmt.value;

                if (H.isExpression(expr.kind)) {
                    const exprHash = hash(expr);

                    if (exprHash in expressionTable) {
                        block.stmts[i] = this.replaceWithTemp(
                            stmt,
                            expressionTable[exprHash]!,
                        );
                    } else {
                        expressionTable[exprHash] = stmt.name.name;
                    }
                }
            }
        }
    }

    optimize(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID)
                continue;
            this.optimizeBlock(this.cfg[blockId]!);
        }
    }
}
