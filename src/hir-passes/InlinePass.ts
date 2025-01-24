import {HirBlock, HirExpr, HirFunc, HirNumber, HirStmt, isStatement} from "../hir/hir";
import {replace, ReplaceNameVisitor, Visitor, walkStmt} from "../hir/hir-visitor";
import {hash} from "../hir/hir-hash";


export class InlinePass implements Visitor {
    parents: (HirExpr | HirStmt)[] = [];

    public constructor(public functions: HirFunc[]) {
    }

    run() {
        this.functions.forEach(func => {
            walkStmt(this, func.body);
        })
    }

    visitExpr(expr: HirExpr): void {
        if (expr.kind === "call") {
            console.log(expr)
            const func = this.findFunc(expr.name.name)
            if (!func) return

            const reverse = this.parents.reverse();
            const stmtIndex = reverse.findIndex(n => isStatement(n.kind));
            const stmt = reverse[stmtIndex] as HirStmt
            // if (!stmt) return

            const block = reverse[stmtIndex + 1] as HirBlock

            const index = block.stmts.findIndex(s => hash(s) === hash(stmt))

            let returnExpr: HirExpr | null = null
            let addStmts = func.body.stmts
            const lastStmt = addStmts.at(-1)!;
            if (lastStmt.kind === "return") {
                addStmts = addStmts.slice(0, -1)
                returnExpr = lastStmt.expr
            }

            const mapping: Map<string, HirExpr> = new Map();

            for (let i = 0; i < expr.args.length; i++) {
                const arg = expr.args[i]!
                const funcParam = func.params[i]!

                mapping.set(funcParam.name, arg)
            }

            const renamer = new ReplaceNameVisitor(mapping)

            addStmts.forEach(stmt => {
                walkStmt(renamer, stmt)
            })

            block.stmts.splice(index, 0, ...addStmts)

            if (returnExpr) {
                replace(expr, stmt, returnExpr)
            }
        }
    }

    visitStmt(_stmt: HirStmt): void {

    }

    findFunc(name: string): HirFunc | null {
        return this.functions.find(func => func.name === name) ?? null
    }
}
