import {FunctionDescription} from "../../types/types";
import {getAllStaticFunctions} from "../../types/resolveDescriptors";
import {CompilerContext} from "../../context/context";
import {writeFileSync} from "fs";
import {Convertor} from "../../hir/convert";
import {print} from "../../hir/hir-printer";
import {HirExpr, HirFunc, HirStmt} from "../../hir/hir";
import {buildCfg, cfgToString, generateSvg} from "../../hir/cfg";
import {DeadCodeElimination} from "../../hir/cfg/analysis/dce";
import {SsaConverter} from "../../hir/cfg/ssa";
import {CommonSubexpressionElimination} from "../../hir/cfg/analysis/cse";
import {CommonStatementsExtraction} from "../../hir/cfg/analysis/common_stmts";
import {CfgSimplifier} from "../../hir/cfg/analysis/simplify";

type StackEntry = { name: string };

const TOP_OF_STACK = 0;

class Stack {
    values: StackEntry[] = []

    push(val: StackEntry) {
        this.values.push(val);
    }

    pop(count: number) {
        if (count === 0) return

        if (count > this.values.length)
            throw new Error(`stack underflow: size: ${this.values.length}, pop count: ${count}`);
        this.values = this.values.slice(0, -count);
    }

    rot2() {
        const last = this.values.at(-1)!
        this.values[this.values.length - 1] = this.values.at(-2)!;
        this.values[this.values.length - 2] = last;
    }

    rev_rot() {
        const last = this.values.at(-1)!
        const prev = this.values.at(-2)!;
        const grand = this.values.at(-3)!;
        this.values[this.values.length - 1] = prev;
        this.values[this.values.length - 2] = grand;
        this.values[this.values.length - 3] = last;
    }

    dup() {
        const last = this.values.at(-1)!
        this.values.push(last)
    }

    size(): number {
        return this.values.length;
    }

    top(): string {
        return this.values.at(-1)!.name
    }

    indexOf(name: string): number {
        const index = this.values.findIndex(e => e.name === name);
        if (index === -1) return -1
        return this.size() - index - 1;
    }

    indexOfExpr(expr: HirExpr): number {
        if (expr.kind !== "identifier") return -1;
        return this.indexOf(expr.name)
    }

    toString(): string {
        let result = "[ "

        for (let i = 0; i < this.values.length; i++) {
            const index = this.values.length - i - 1
            result += `${index}: `
            result += this.values[i]!.name

            if (i !== this.values.length - 1) {
                result += `, `
            }
        }

        result += " ]"
        return result
    }
}

export class Generator {
    out: string = "";

    code: string[] = [];

    indent: number = 0;
    func: FunctionDescription | null = null;

    countVars: number = 0;
    countParams: number = 0;

    stack: Stack = new Stack();

    stacks: Stack[] = [];

    pushStack() {
        const prevStack = this.stack;
        this.stacks.push(this.stack)
        this.stack = new Stack()

        prevStack.values.forEach((v) => {
            this.stack.push(v)
        })
    }

    popStack() {
        this.stack = this.stacks.at(-1)!
        this.stacks.pop()
    }

    pushIndent() {
        this.indent += 1;
    }

    popIdent() {
        this.indent -= 1;
    }

    getIdent(): string {
        return "   ".repeat(this.indent);
    }

    write(line: string) {
        this.code.push(this.getIdent() + line + "\n");
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
        this.pushIndent();
        const funcs = getAllStaticFunctions(ctx).map((f) => {
            return this.convertFunction(f);
        }).filter(n => n !== undefined);

        // const pass = new InlinePass(funcs)
        // pass.run()

        funcs.forEach(func => {
            console.log(print(func.body))

            const cfg = buildCfg(func);
            console.log(cfgToString(cfg))
            
            generateSvg(cfg, `${func!.name}_cfg.svg`)

            const ssaConverter = new SsaConverter(cfg);
            
            generateSvg(cfg, `${func!.name}_cfg_dominance.svg`, {
                showDominanceFrontier: ssaConverter.getDominanceFrontier(),
                showDominanceTree: ssaConverter.getDominanceTree()
            });
            
            ssaConverter.convert();

            const cse = new CommonSubexpressionElimination(cfg);
            cse.optimize();

            const commonStmts = new CommonStatementsExtraction(cfg);
            commonStmts.optimize();

            const simplifier = new CfgSimplifier(cfg);
            simplifier.optimize();

            for (let i = 0; i < 5; i++) {
                const deadCode = new DeadCodeElimination(cfg);
                deadCode.optimize();
            }

            generateSvg(cfg, `${func!.name}_cfg_after.svg`)

            this.generateFunction(func)
        })

        this.popIdent();
        this.footer();
    }

    generateFunction(f: HirFunc) {
        this.stack = new Stack();

        for (const param of f.params) {
            this.stack.push({
                name: param.name
            })
        }

        this.write(`DECLPROC ${f.name}`);
        this.write(`${f.name} PROC:<{`);

        this.pushIndent();

        this.write("// Initial stack: " + this.stack.toString());

        if (f.params.length !== 0) {
            this.countVars += f.params.length;
            this.countParams = f.params.length;
        }

        for (const statement of f.body.stmts) {
            this.processStatement(statement);
        }

        const lastStmt = f.body.stmts.at(-1);
        if (lastStmt === undefined || lastStmt.kind !== "return") {
            // implicit return
            // clean up stack
            const toPop = this.stack.size()
            if (toPop > 0) {
                this.stack.pop(toPop);
                this.write(`${toPop} BLKDROP`);
            }
            this.write(`RET`);
        }

        this.popIdent();

        this.write(`}>`);

        this.countVars = 0;
    }

    convertFunction(f: FunctionDescription): HirFunc | undefined {
        this.countVars = 0;

        if (f.ast.kind === "function_def" &&
            (f.name === "recv_internal" ||
                f.name === "add" ||
                f.name === "sub" ||
                f.name === "get_value" ||
                f.name === "some_func")
        ) {
            this.func = f;

            const conv = new Convertor()

            const params = f.ast.params.map(p => conv.convertParam(p))

            const result = conv.convertBlock({
                kind: "statement_block",
                statements: f.ast.statements,
                loc: f.ast.loc,
                id: 0,
            })

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
            if (statement.value.kind === "number") { // TODO: better way
                this.stack.pop(1)
            }
            this.stack.push({name: statement.name.name});
        }

        if (statement.kind === "assign") {
            const leftIndex = this.stack.indexOfExpr(statement.left)
            const rightIndex = this.stack.indexOfExpr(statement.right)
            if (leftIndex === 0 && rightIndex === -1) {
                this.write("DROP")
                this.stack.pop(1)
                this.processExpr(statement.right);
            }

            // this.processExpr(statement.value);
            // this.stack.push({name: statement.name.name});
        }

        if (statement.kind === "if") {
            const onTop = this.processExpr(statement.condition);
            this.stack.pop(1)

            this.pushStack()
            this.write(`IF:<{`);

            this.pushIndent();
            for (const stmt of statement.then.stmts) {
                if (onTop) {
                    // this.stack.pop(1)
                    // this.write(`DROP // drop duplicated value for condition`);
                }

                this.processStatement(stmt)
            }
            this.popIdent();
            this.write(`}>`);
            this.popStack()

            if (statement.else !== undefined) {
                this.pushStack()
                this.write(`ELSE:<{`);
                this.pushIndent();
                for (const stmt of statement.else.stmts) {
                    this.processStatement(stmt)
                }
                this.popIdent();
                this.write(`}>`);
                this.popStack()
            }
        }

        if (
            statement.kind === "return" &&
            statement.expr !== null
        ) {
            const exprIndex = this.stack.indexOfExpr(statement.expr)
            if (exprIndex === 0) {
                const size = this.stack.size();
                if (size === 1) {
                    // nothing to do, value already on the top of the stack
                    return
                }

                const countToDrop = size - 1
                this.write(`${countToDrop} 1 BLKDROP2 // stack before: ${this.stack.toString()}`)
                return;
            }

            // need to pop this count of expressions
            if (exprIndex > 0) {
                this.write(`${exprIndex} BLKDROP`);
            }

            // push things like integer and booleans on the top of the stack
            this.processNonIdentExpr(statement.expr);
            this.write(`RET`);
        }

        if (
            statement.kind === "return" &&
            statement.expr === null
        ) {
            // clean up stack
            const toPop = this.stack.size()

            if (toPop > 0) {
                this.stack.pop(toPop);
                this.write(`${toPop} BLKDROP`);
            }
            this.write(`RET`);
        }
    }

    processNonIdentExpr(expr: HirExpr) {
        if (expr.kind === "identifier") return

        if (expr.kind === "number") {
            this.write(`${expr.value.toString()} PUSHINT`);
            this.stack.push({name: expr.value.toString()});
        }
    }

    processExpr(expr: HirExpr): boolean {
        this.processNonIdentExpr(expr)

        if (expr.kind === "identifier" && this.func !== null) {
            const index = this.stack.indexOf(expr.name)
            if (index === TOP_OF_STACK) {
                // nothing to do, variable already on top of the stack
                return true
            }

            // otherwise push this variable on top of the stack
            this.write(`s${index} PUSH // ${expr.name}`);
            this.stack.push({name: expr.name});

            // const name = expr.name;
            // const paramIndex = this.func.params.findIndex(
            //     (p) => p.name.text === name,
            // );
            // if (paramIndex !== -1) {
            //     const idx = this.countVars - paramIndex - 1;
            //     this.write(`s${idx} PUSH`);
            //     this.countVars++;
            //     return;
            // }
            //
            // const localIndex = this.locals.findIndex((p) => p === name);
            // if (localIndex !== -1) {
            //     const idx = this.countVars - localIndex - 1 - this.countParams;
            //     this.write(`s${idx} PUSH`);
            //     this.countVars++;
            // }
        }

        const binaryOpCommand = (op: string): string => {
            if (op === "+") return "ADD"
            if (op === "*") return "MUL"
            if (op === "-") return "SUB"
            if (op === "/") return "DIV"
            if (op === "==") return "EQUAL"
            if (op === "!=") return "NEQ"
            if (op === ">") return "GREATER"
            if (op === "<") return "LESS"
            if (op === "<=") return "LEQ"
            if (op === ">=") return "GEQ"
            return "NOP"
        }

        if (expr.kind === "binary") {
            const leftIndex = this.stack.indexOfExpr(expr.left)
            const rightIndex = this.stack.indexOfExpr(expr.right)

            if (expr.op === "+" || expr.op === "*" || expr.op === "==" || expr.op === "!=") {
                // if both values already on top of the stack
                if (leftIndex === 0 && rightIndex === 1 || leftIndex === 1 && rightIndex === 0) {
                    const op = binaryOpCommand(expr.op)
                    this.write(op);
                    this.stack.pop(2);
                    return false
                }

                // imagine we have [a, b, c] and we want to sum `a` and `b`
                // then we transform stack to [c, a, b], and sum up [c. res]
                if (leftIndex === 1 && rightIndex === 2 || leftIndex === 2 && rightIndex === 1) {
                    this.stack.rev_rot();
                    this.write(`-ROT // -> ${this.stack.toString()}`);

                    const op = binaryOpCommand(expr.op)
                    this.write(op);
                    this.stack.pop(2);
                    return false
                }
            }

            if (
                expr.op === "-" || expr.op === "/" ||
                expr.op === "<" || expr.op === ">" ||
                expr.op === "<=" || expr.op === ">="
            ) {
                if (leftIndex === 1 && rightIndex === 0) {
                    const op = expr.op === "-" ? "SUB" : "DIV"
                    this.write(op);
                    this.stack.pop(2);
                    return false
                }

                // `b - a`, need to rotate
                if (leftIndex === 0 && rightIndex === 1) {
                    this.write("SWAP // we need to exchange s[0] and s[1] for correct order");
                    this.stack.rot2();

                    const op = binaryOpCommand(expr.op)
                    this.write(op);
                    this.stack.pop(2);
                    return false
                }
            }

            const needDup = this.processExpr(expr.left);
            if (needDup) {
                this.write(`DUP // duplicate top element (${this.stack.top()}) for binary ${expr.op}`);
                this.stack.dup();
            }

            const needDup2 = this.processExpr(expr.right);
            if (needDup2) {
                this.write(`DUP // duplicate top element (${this.stack.top()}) for binary ${expr.op}`);
                this.stack.dup();
            }

            if (expr.op === "+") {
                this.write("ADD");
            }
            if (expr.op === "-") {
                this.write("SUB");
            }
            if (expr.op === "*") {
                this.write("MUL");
            }
            if (expr.op === "==") {
                this.write("EQUAL");
            }

            this.stack.pop(2);
        }

        if (expr.kind === "call") {
            if (expr.name.name === "dumpStack") {
                this.write("DUMPSTK");
                return false
            }

            expr.args.forEach((arg) => {
                const onTop = this.processExpr(arg);

                // if we call function with argument that on top of the stack we need
                // to duplicate it
                if (onTop) {
                    this.write("DUP // duplicate top element for call");
                    this.stack.dup();
                }
            });

            this.write(`${expr.name.name} INLINECALLDICT`);

            this.stack.pop(expr.args.length);
        }

        return false
    }

    dumpToFile() {
        const code = this.code.join("");
        writeFileSync("out.fif", code);
    }
}
