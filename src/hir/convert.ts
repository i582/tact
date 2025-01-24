import {AstExpression, AstNode, AstStatement, AstStatementBlock, AstTypedParameter} from "../ast/ast";
import {HirBinaryOp, HirBlock, HirCall, HirExpr, HirIdentifier, HirParam, HirStmt, HirVariable} from "./hir";
import {SrcInfo} from "../grammar";

export class Convertor {
    currentBlock: HirBlock | null = null;
    currentIdx: number = 0;
    parents: AstNode[] = [];
    variablesCounter: number = 0;

    convertParam(param: AstTypedParameter): HirParam {
        return {
            kind: "param",
            name: param.name.text,
        }
    }

    convertBlock(block: AstStatementBlock): HirBlock {
        const result: HirStmt[] = []

        const newBlock = {
            kind: "block",
            stmts: result
        } as HirBlock;

        this.currentBlock = newBlock

        this.parents.push(block)
        for (let i = 0; i < block.statements.length; i++) {
            this.currentIdx = i;
            result.push(this.convertStatement(block.statements[i]!));
        }
        this.parents.pop()

        return newBlock
    }

    convertStatement(stmt: AstStatement): HirStmt {
        const loc = {} as SrcInfo

        if (stmt.kind === "statement_condition") {
            this.parents.push(stmt);
            const condition = this.convertExpression(stmt.condition);
            const thenBlock = this.convertBlock({
                kind: "statement_block",
                statements: stmt.trueStatements,
                id: 0,
                loc: loc
            });
            const elseBlock = stmt.falseStatements ? this.convertBlock({
                kind: "statement_block",
                statements: stmt.falseStatements,
                id: 0,
                loc: loc
            }) : undefined;
            this.parents.pop();

            return {
                kind: "if",
                condition,
                then: thenBlock,
                else: elseBlock
            };
        }

        if (stmt.kind === "statement_return") {
            this.parents.push(stmt)
            const expr = this.convertOptExpression(stmt.expression);
            this.parents.pop()

            return {
                kind: "return",
                expr: expr,
            }
        }

        if (stmt.kind === "statement_expression") {
            this.parents.push(stmt)
            const expr = this.convertExpression(stmt.expression);
            this.parents.pop()

            return {
                kind: "expr_stmt",
                expr: expr,
            }
        }

        if (stmt.kind === "statement_let") {
            this.parents.push(stmt)
            const value = this.convertExpression(stmt.expression);
            this.parents.pop()

            return {
                kind: "variable",
                name: {
                    kind: "identifier",
                    name: stmt.name.text,
                },
                value: value,
            }
        }

        if (stmt.kind === "statement_assign") {
            this.parents.push(stmt)
            const left = this.convertExpression(stmt.path);
            const right = this.convertExpression(stmt.expression);
            this.parents.pop()

            return {
                kind: "assign",
                left: left,
                right: right,
            }
        }

        throw new Error("Unhandled statement kind: " + stmt.kind)
    }

    convertOptExpression(expr: AstExpression | null): HirExpr | null {
        if (expr === null) return null
        return this.convertExpression(expr)
    }

    convertExpression(expr: AstExpression): HirExpr {
        if (expr.kind === "number") {
            return {
                kind: "number",
                value: expr.value
            }
        }

        if (expr.kind === "id") {
            return {
                kind: "identifier",
                name: expr.text,
            }
        }

        if (expr.kind === "op_binary") {
            this.parents.push(expr)
            const left = this.convertExpression(expr.left);
            const right = this.convertExpression(expr.right);
            this.parents.pop()

            const newExpr = {
                kind: "binary",
                left: left,
                op: expr.op,
                right: right,
            } as HirBinaryOp;

            const parent = this.parents.at(-1)
            if (this.isComplexExpr(parent)) {
                return this.insertVar(newExpr)
            }

            return newExpr
        }

        if (expr.kind === "static_call") {
            const name = {
                kind: "identifier",
                name: expr.function.text,
            }

            this.parents.push(expr)
            const args = expr.args.map(arg => this.convertExpression(arg))
            this.parents.pop()

            const newExpr = {
                kind: "call",
                name: name,
                args: args,
            } as HirCall;

            const parent = this.parents.at(-1)
            if (this.isComplexExpr(parent)) {
                return this.insertVar(newExpr)
            }

            return newExpr
        }

        throw new Error("Unhandled expression kind: " + expr.kind)
    }

    insertVar(init: HirExpr): HirIdentifier {
        if (!this.currentBlock) throw new Error("Unexpected state without block")

        const newVar = {
            kind: "variable",
            name: {
                kind: "identifier",
                name: `_${this.variablesCounter}`
            },
            value: init,
        } as HirVariable
        this.variablesCounter++

        if (this.currentIdx < this.currentBlock.stmts.length) {
            this.currentBlock.stmts.splice(this.currentIdx, 0, newVar);
        }

        if (this.currentIdx == this.currentBlock.stmts.length) {
            this.currentBlock.stmts.push(newVar)
        }

        this.currentIdx++

        return {
            kind: "identifier",
            name: newVar.name.name,
        }
    }

    isComplexExpr(expr: AstNode | undefined): boolean {
        if (!expr) return false;
        return expr.kind === "op_binary" ||
            expr.kind === "static_call" ||
            expr.kind === "statement_return" ||
            expr.kind === "statement_condition";
    }
}
