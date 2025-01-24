import {FunctionDescription} from "../../types/types";
import {getAllStaticFunctions} from "../../types/resolveDescriptors";
import {CompilerContext} from "../../context/context";
import {writeFileSync} from "fs";
import {Convertor} from "../../hir/convert";
import {print} from "../../hir/hir-printer";
import {HirBlock, HirExpr, HirFunc, HirParam, HirStmt, HirVariable} from "../../hir/hir";
import {hash} from "../../hir/hir-hash";
import {replace, traverseStmt} from "../../hir/hir-visitor";
import {InlinePass} from "../../hir-passes/InlinePass";
import {cfgToString, buildCfg, generateSvg} from "../../hir/cfg";
import {CommonSubexpressionElimination} from "../../hir/cfg/analysis/cse";
import {CopyPropagation} from "../../hir/cfg/analysis/copy";
import {CommonStatementsExtraction} from "../../hir/cfg/analysis/common_stmts";
import {CfgSimplifier} from "../../hir/cfg/analysis/simplify";
import {DeadCodeElimination} from "../../hir/cfg/analysis/dce";

export class Generator {
    out: string = "";

    code: string[] = [];

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
        // this.writeIdent();
        // this.out += line + "\n";

        this.code.push(line + "\n");
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
        const funcs = getAllStaticFunctions(ctx).map((f) => {
            return this.processFunction(f);
        }).filter(n => n !== undefined);

        const pass = new InlinePass(funcs)
        pass.run()

        funcs.forEach(func => {
            console.log(print(func.body))

            const cfg = buildCfg(func);
            console.log(cfgToString(cfg))
            generateSvg(cfg, "cfg.svg")

            const cse = new CommonSubexpressionElimination(cfg);
            cse.optimize();

            const copyProp = new CopyPropagation(cfg);
            copyProp.optimize();

            const commonStmts = new CommonStatementsExtraction(cfg);
            commonStmts.optimize();

            const simplifier = new CfgSimplifier(cfg);
            simplifier.optimize();

            for (let i = 0; i < 5; i++) {
                const deadCode = new DeadCodeElimination(cfg);
                deadCode.optimize();
            }

            generateSvg(cfg, "cfg_after.svg")

            this.generateFunction(func)
        })

        this.popIdent();
        this.footer();
    }

    generateFunction(f: HirFunc) {
        this.write(`DECLPROC ${f.name}`);
        this.write(`${f.name} PROC:<{`);

        this.pushIdent();

        if (f.params.length !== 0) {
            this.countVars += f.params.length;
            this.countParams = f.params.length;
        }

        for (const statement of f.body.stmts) {
            this.processStatement(statement);
        }

        this.popIdent();

        this.write(`}>`);

        this.countVars = 0;
    }

    processFunction(f: FunctionDescription): HirFunc | undefined {
        this.countVars = 0;

        const enabled = false;

        if (f.name === "recv_internal" || f.name === "add" || f.name === "sub") {
            this.func = f;

            let result: HirBlock | undefined = undefined;
            let params: HirParam[] = [];

            if (f.ast.kind === "function_def") {
                const conv = new Convertor()

                params = f.ast.params.map(p => conv.convertParam(p))

                result = conv.convertBlock({
                    kind: "statement_block",
                    statements: f.ast.statements,
                    loc: f.ast.loc,
                    id: 0,
                })

                if (enabled) {
                    const vars: Map<number, HirVariable[]> = new Map()

                    for (const stmt of result.stmts) {
                        if (stmt.kind === "variable") {
                            const h = hash(stmt.value)

                            if (vars.has(h)) {
                                const arr = vars.get(h)!
                                arr.push(stmt)
                                vars.set(h, arr)
                            } else {
                                vars.set(h, [stmt])
                            }
                        }
                    }

                    const duplicatedVars = [...vars.values()].filter(it => it.length > 1);
                    duplicatedVars.forEach(vv => {
                        console.log(vv.map(v => v.name))
                    })

                    result.stmts.forEach(v => {
                        traverseStmt(v, (n, parent) => {
                            if (n.kind === "identifier") {
                                const array = duplicatedVars[0]!;
                                const index = array.findIndex(v => v.name === n.name)
                                if (index > 0) {
                                    replace(n, parent as HirExpr, {
                                        kind: "identifier",
                                        name: array[0]!.name
                                    })
                                }
                            }
                        })
                    })

                    result.stmts = result.stmts.filter(s => {
                        if (s.kind === "variable") {
                            const array = duplicatedVars[0]!;
                            const index = array.findIndex(v => v.name === s.name)
                            return !(index > 0)
                        }
                        return true
                    })
                }
            }

            return {
                kind: "func",
                name: f.ast.name.text,
                params: params,
                body: result!,
            };
        }

        return undefined;
    }

    processStatement(statement: HirStmt) {
        if (statement.kind === "expr_stmt") {
            this.processExpr(statement.expr);
        }

        if (statement.kind === "variable") {
            this.processExpr(statement.value);
            this.locals.push(statement.name.name);
        }

        if (statement.kind === "if") {
            this.processExpr(statement.condition);

            this.write(`IF:<{`);
            for (const stmt of statement.then.stmts) {
                this.processStatement(stmt)
            }
            this.write(`}>`);

            if (statement.else !== undefined) {
                this.write(`ELSE:<{`);
                for (const stmt of statement.else.stmts) {
                    this.processStatement(stmt)
                }
                this.write(`}>`);
            }
        }

        if (
            statement.kind === "return" &&
            statement.expr !== null
        ) {
            this.processExpr(statement.expr);

            if (this.countVars !== 0) {
                this.write(`s0 s${this.countVars - 1} XCHG`);
                this.write(`${this.countVars - 1} BLKDROP`);
            }
        }
    }

    processExpr(expr: HirExpr) {
        if (expr.kind === "number") {
            this.write(`${expr.value.toString()} PUSHINT`);
            this.countVars++;
        }

        if (expr.kind === "identifier" && this.func !== null) {
            const name = expr.name;
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

        if (expr.kind === "binary") {
            this.processExpr(expr.left);
            this.processExpr(expr.right);

            if (expr.op === "+") {
                if (this.code.at(-1) === "s1 PUSH\n" && this.code.at(-2) === "s1 PUSH\n") {
                    this.code = this.code.slice(0, -2)
                    // this.countVars -= 1;
                }
                this.write("ADD");
            }
            if (expr.op === "*") {
                this.write("MUL");
            }
            if (expr.op === "==") {
                this.write("EQUAL");
            }

            this.countVars--;
        }

        if (expr.kind === "call") {
            if (expr.name.name === "dumpStack") {
                this.write("DUMPSTK");
                return;
            }

            this.countStack.push(this.countVars);
            this.countVars = 0;
            expr.args.forEach((arg) => {
                this.processExpr(arg);
            });

            this.write(`${expr.name.name} INLINECALLDICT`);
            this.countVars = this.countStack.at(-1)!;
            this.countStack.pop();
        }
    }

    dumpToFile() {
        const code = this.code.join("");
        writeFileSync("out.fif", code);
    }
}
