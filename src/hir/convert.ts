import {
    AstExpression,
    AstNode,
    AstStatement,
    AstStatementBlock,
    AstTypedParameter,
} from "../ast/ast";
import {
    HirBinaryOp,
    HirBlock,
    HirCall,
    HirExpr,
    HirIdentifier,
    HirParam,
    HirStmt,
    HirVariable,
} from "./hir";
import { SrcInfo } from "../grammar";
import { CompilerContext } from "../context/context";
import * as A from "../ast/ast";
import { TypeRef } from "../types/types";
import { store } from "../types/resolveExpression";
import { throwInternalCompilerError } from "../error/errors";

export class Convertor {
    currentBlock: HirBlock | null = null;
    blocksStack: HirBlock[] = [];
    currentIdxStack: number[] = [];
    currentAddedStmtsStack: number[] = [];
    currentIdx: number = 0;
    currentAddedStmts: number = 0;
    parents: AstNode[] = [];
    variablesCounter: number = 0;

    constructor(private ctx: CompilerContext) {}

    getType(expr: A.AstExpression): TypeRef {
        const r = store.get(this.ctx!, expr.id);
        if (!r) {
            throwInternalCompilerError(`Type for ${expr.id} not found`);
        }
        return r.description;
    }

    convertParam(param: AstTypedParameter): HirParam {
        return {
            kind: "param",
            name: param.name.text,
        };
    }

    convertBlock(block: AstStatementBlock): HirBlock {
        const result: HirStmt[] = [];

        const newBlock = {
            kind: "block",
            stmts: result,
        } as HirBlock;

        this.blocksStack.push(newBlock);
        this.currentIdxStack.push(this.currentIdx);
        this.currentAddedStmtsStack.push(this.currentAddedStmts);
        this.currentBlock = newBlock;

        this.parents.push(block);
        for (let i = 0; i < block.statements.length; i++) {
            this.currentIdx = i + this.currentAddedStmts;
            result.push(this.convertStatement(block.statements[i]!));
        }
        this.parents.pop();

        if (this.blocksStack.length > 1) {
            this.blocksStack.pop();
            this.currentBlock = this.blocksStack.at(-1) ?? null;
            this.currentIdx = this.currentIdxStack.at(-1) ?? 0;
            this.currentAddedStmts = this.currentAddedStmtsStack.at(-1) ?? 0;
        } else {
            this.currentBlock = null;
            this.currentIdx = 0;
        }

        return newBlock;
    }

    convertStatement(stmt: AstStatement): HirStmt {
        const loc = {} as SrcInfo;

        if (stmt.kind === "statement_condition") {
            this.parents.push(stmt);
            const condition = this.convertExpression(stmt.condition);
            const thenBlock = this.convertBlock({
                kind: "statement_block",
                statements: stmt.trueStatements,
                id: 0,
                loc: loc,
            });
            const elseBlock = stmt.falseStatements
                ? this.convertBlock({
                      kind: "statement_block",
                      statements: stmt.falseStatements,
                      id: 0,
                      loc: loc,
                  })
                : undefined;
            this.parents.pop();

            return {
                kind: "if",
                condition,
                then: thenBlock,
                else: elseBlock,
            };
        }

        if (stmt.kind === "statement_return") {
            this.parents.push(stmt);
            const expr = this.convertOptExpression(stmt.expression);
            this.parents.pop();

            return {
                kind: "return",
                expr: expr,
            };
        }

        if (stmt.kind === "statement_expression") {
            this.parents.push(stmt);
            const expr = this.convertExpression(stmt.expression);
            this.parents.pop();

            return {
                kind: "expr_stmt",
                expr: expr,
            };
        }

        if (stmt.kind === "statement_let") {
            this.parents.push(stmt);
            const value = this.convertExpression(stmt.expression);
            this.parents.pop();

            const type = this.getType(stmt.expression);

            return {
                kind: "variable",
                name: {
                    kind: "identifier",
                    name: stmt.name.text,
                    type: type,
                },
                value: value,
            };
        }

        if (stmt.kind === "statement_assign") {
            this.parents.push(stmt);
            const left = this.convertExpression(stmt.path);
            const right = this.convertExpression(stmt.expression);
            this.parents.pop();

            return {
                kind: "assign",
                left: left,
                right: right,
            };
        }

        throw new Error("Unhandled statement kind: " + stmt.kind);
    }

    convertOptExpression(expr: AstExpression | null): HirExpr | null {
        if (expr === null) return null;
        return this.convertExpression(expr);
    }

    convertExpression(expr: AstExpression): HirExpr {
        if (expr.kind === "number") {
            return {
                kind: "number",
                value: expr.value,
            };
        }

        if (expr.kind === "id") {
            const type = this.getType(expr);
            return {
                kind: "identifier",
                name: expr.text,
                type: type,
            };
        }

        if (expr.kind === "op_binary") {
            this.parents.push(expr);
            const left = this.convertExpression(expr.left);
            const right = this.convertExpression(expr.right);
            this.parents.pop();

            const newExpr = {
                kind: "binary",
                left: left,
                op: expr.op,
                right: right,
            } as HirBinaryOp;

            const parent = this.parents.at(-1);
            if (this.isComplexExpr(parent)) {
                return this.insertVar(newExpr, expr);
            }

            return newExpr;
        }

        if (expr.kind === "op_unary") {
            return this.convertExpression(expr.operand);
        }

        if (expr.kind === "static_call") {
            const name = {
                kind: "identifier",
                name: expr.function.text,
            };

            this.parents.push(expr);
            const args = expr.args.map((arg) => this.convertExpression(arg));
            this.parents.pop();

            const newExpr = {
                kind: "call",
                name: name,
                args: args,
            } as HirCall;

            const parent = this.parents.at(-1);
            if (this.isComplexExpr(parent)) {
                return this.insertVar(newExpr, expr);
            }

            return newExpr;
        }

        throw new Error("Unhandled expression kind: " + expr.kind);
    }

    insertVar(init: HirExpr, expr: AstExpression): HirIdentifier {
        if (!this.currentBlock)
            throw new Error("Unexpected state without block");

        const newVar = {
            kind: "variable",
            name: {
                kind: "identifier",
                name: `_${this.variablesCounter}`,
            },
            value: init,
        } as HirVariable;
        this.variablesCounter++;

        if (this.currentIdx < this.currentBlock.stmts.length) {
            this.currentBlock.stmts.splice(this.currentIdx, 0, newVar);
            this.currentAddedStmts++;
        }

        if (this.currentIdx == this.currentBlock.stmts.length) {
            this.currentBlock.stmts.push(newVar);
            this.currentAddedStmts++;
        }

        this.currentIdx++;

        const type = this.getType(expr);

        return {
            kind: "identifier",
            name: newVar.name.name,
            type: type,
        };
    }

    isComplexExpr(expr: AstNode | undefined): boolean {
        if (!expr) return false;
        return (
            expr.kind === "op_binary" ||
            expr.kind === "static_call" ||
            expr.kind === "statement_return" ||
            expr.kind === "statement_condition"
        );
    }
}
