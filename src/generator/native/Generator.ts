import { FunctionDescription } from "../../types/types";
import { AstExpression } from "../../ast/ast";
import { getAllStaticFunctions } from "../../types/resolveDescriptors";
import { CompilerContext } from "../../context/context";
import { writeFileSync } from "fs";

export class Generator {
    out: string = "";
    indent: number = 0;
    func: FunctionDescription | null = null;

    countStack: number[] = [];
    countVars: number = 0;
    countParams: number = 0;

    locals: string[] = [];

    pushIdent() {
        this.indent += 1;
    }

    popIdent() {
        this.indent -= 1;
    }

    writeIdent() {
        this.out += "   ".repeat(this.indent);
    }

    write(line: string) {
        this.writeIdent();
        this.out += line + "\n";
    }

    header() {
        this.write(`"Asm.fif" include`);
        this.write(`PROGRAM{`);
    }

    footer() {
        this.write(`}END>c`);
    }

    processProgram(ctx: CompilerContext) {
        this.header();
        this.pushIdent();
        getAllStaticFunctions(ctx).forEach((f) => {
            this.processFunction(f);
        });
        this.popIdent();
        this.footer();
    }

    processFunction(f: FunctionDescription) {
        this.countVars = 0;

        if (f.name === "recv_internal" || f.name === "add") {
            this.func = f;

            this.write(`DECLPROC ${f.name}`);
            this.write(`${f.name} PROC:<{`);

            this.pushIdent();

            if (f.params.length !== 0) {
                this.countVars += f.params.length;
                this.countParams = f.params.length;
            }

            if (f.ast.kind === "function_def") {
                f.ast.statements.forEach((statement) => {
                    if (statement.kind === "statement_expression") {
                        this.processExpr(statement.expression);
                    }

                    if (statement.kind === "statement_let") {
                        this.processExpr(statement.expression);
                        this.locals.push(statement.name.text);
                    }

                    if (
                        statement.kind === "statement_return" &&
                        statement.expression !== null
                    ) {
                        this.processExpr(statement.expression);

                        if (this.countVars !== 0) {
                            this.write(`s0 s${this.countVars - 1} XCHG`);
                            this.write(`${this.countVars - 1} BLKDROP`);
                        }
                    }
                });
            }

            this.popIdent();

            this.write(`}>`);

            this.countVars = 0;
        }
    }

    processExpr(expr: AstExpression) {
        if (expr.kind === "number") {
            this.write(`${expr.value.toString()} PUSHINT`);
            this.countVars++;
        }

        if (expr.kind === "id" && this.func !== null) {
            const name = expr.text;
            const paramIndex = this.func.params.findIndex(
                (p) => p.name.text === name,
            );
            if (paramIndex !== -1) {
                const idx = this.countVars - paramIndex - 1;
                this.write(`s${idx} PUSH`);
                this.countVars++;
                return;
            }

            const localIndex = this.locals.findIndex((p) => p === name);
            if (localIndex !== -1) {
                const idx = this.countVars - localIndex - 1 - this.countParams;
                this.write(`s${idx} PUSH`);
                this.countVars++;
            }
        }

        if (expr.kind === "op_binary") {
            this.processExpr(expr.left);
            this.processExpr(expr.right);

            if (expr.op === "+") {
                this.write("ADD");
            }
            if (expr.op === "*") {
                this.write("MUL");
            }

            this.countVars--;
        }

        if (expr.kind === "static_call") {
            if (expr.function.text === "dumpStack") {
                this.write("DUMPSTK");
                return;
            }

            this.countStack.push(this.countVars);
            this.countVars = 0;
            expr.args.forEach((arg) => {
                this.processExpr(arg);
            });

            this.write(`${expr.function.text} INLINECALLDICT`);
            this.countVars = this.countStack.at(-1)!;
            this.countStack.pop();
        }
    }

    dumpToFile() {
        writeFileSync("out.fif", this.out);
    }
}
