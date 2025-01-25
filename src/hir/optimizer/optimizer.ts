import {HirBinaryOp, HirExpr, HirFunc, HirStmt} from "../hir";
import {Visitor, walkStmt} from "../hir-visitor";

export type HirRule<T extends HirExpr> = {
    nodeKind: T['kind'];
    match: (node: T) => boolean;
    rewrite: (node: T) => HirExpr;
};

export function rule<T extends HirExpr>(
    nodeKind: T['kind'],
    match: (n: T) => boolean,
    rewrite: (n: T) => HirExpr
) {
    return {nodeKind, match, rewrite};
}

export const binary = (match: (n: HirBinaryOp) => boolean, rewrite: (n: HirBinaryOp) => HirExpr) =>
    rule("binary", match, rewrite);

export class Optimizer implements Visitor {
    // eslint-disable-next-line
    private rules: HirRule<any>[] = [];
    parents: (HirExpr | HirStmt)[] = [];

    addRule<T extends HirExpr>(rule: HirRule<T>): void {
        this.rules.push(rule);
    }

    optimize(node: HirExpr): HirExpr {
        for (const rule of this.rules) {
            if (rule.nodeKind === node.kind && rule.match(node)) {
                return this.optimize(rule.rewrite(node));
            }
        }

        return node;
    }

    optimizeFunction(func: HirFunc) {
        func.body.stmts.forEach(node => {
            walkStmt(this, node)
        })
    }

    visitExpr(expr: HirExpr): void {
        const newExpr = this.optimize(expr)
        Object.assign(expr, newExpr);
    }

    visitStmt(_: HirStmt): void {
    }
}
