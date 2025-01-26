import { FunctionDescription } from "../../types/types";
import { getAllStaticFunctions } from "../../types/resolveDescriptors";
import { CompilerContext } from "../../context/context";
import { writeFileSync } from "fs";
import { Convertor } from "../../hir/convert";
import { print } from "../../hir/hir-printer";
import { HirExpr, HirFunc, HirStmt } from "../../hir/hir";
import { buildCfg, cfgToString, generateSvg } from "../../hir/cfg";
import { DeadCodeElimination } from "../../hir/cfg/analysis/dce";
import { SsaConverter } from "../../hir/cfg/ssa";
import { CommonSubexpressionElimination } from "../../hir/cfg/analysis/cse";
import { CommonStatementsExtraction } from "../../hir/cfg/analysis/common_stmts";
import { CfgSimplifier } from "../../hir/cfg/analysis/simplify";
import { optimizer } from "../../hir/optimizer/rules";
import { createOp, Op } from "../../hir/bytecode/bytecode";

type StackEntry = { name: string };

const TOP_OF_STACK = 0;

class Stack {
    values: StackEntry[] = [];

    push(val: StackEntry) {
        this.values.push(val);
    }

    pop(count: number) {
        if (count === 0) return;

        if (count > this.values.length)
            throw new Error(
                `stack underflow: size: ${this.values.length}, pop count: ${count}`,
            );
        this.values = this.values.slice(0, -count);
    }

    bulkDrop2(count: number, index: number) {
        // save top N elements
        const elementsToRemain = this.values.slice(this.values.length - index);
        // remove COUNT + N elements
        this.values = this.values.slice(0, this.values.length - count - index);
        // push top N elements back
        this.values.push(...elementsToRemain);
    }

    rot2() {
        const last = this.values.at(-1)!;
        this.values[this.values.length - 1] = this.values.at(-2)!;
        this.values[this.values.length - 2] = last;
    }

    rev_rot() {
        const last = this.values.at(-1)!;
        const prev = this.values.at(-2)!;
        const grand = this.values.at(-3)!;
        this.values[this.values.length - 1] = prev;
        this.values[this.values.length - 2] = grand;
        this.values[this.values.length - 3] = last;
    }

    dup() {
        const last = this.values.at(-1)!;
        this.values.push(last);
    }

    size(): number {
        return this.values.length;
    }

    top(): string {
        return this.values.at(-1)!.name;
    }

    indexOf(name: string): number {
        const index = this.values.findIndex((e) => e.name === name);
        if (index === -1) return -1;
        return this.size() - index - 1;
    }

    indexOfExpr(expr: HirExpr): number {
        if (expr.kind !== "identifier") return -1;
        return this.indexOf(expr.name);
    }

    toString(): string {
        let result = "[ ";

        for (let i = 0; i < this.values.length; i++) {
            const index = this.values.length - i - 1;
            result += `${index}: `;
            result += this.values[i]!.name;

            if (i !== this.values.length - 1) {
                result += `, `;
            }
        }

        result += " ]";
        return result;
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

    ctx: CompilerContext | null = null;

    private ops: Op[] = [];
    private comments: Map<number, string> = new Map();

    pushStack() {
        const prevStack = this.stack;
        this.stacks.push(this.stack);
        this.stack = new Stack();

        prevStack.values.forEach((v) => {
            this.stack.push(v);
        });
    }

    popStack() {
        this.stack = this.stacks.at(-1)!;
        this.stacks.pop();
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
        this.ctx = ctx;

        this.header();
        this.pushIndent();
        const funcs = getAllStaticFunctions(ctx)
            .map((f) => {
                const conv = new Convertor(this.ctx!);
                return conv.convertFunction(f);
            })
            .filter((n) => n !== undefined);

        // const pass = new InlinePass(funcs)
        // pass.run()

        funcs.forEach((func) => {
            console.log(print(func.body));

            const cfg = buildCfg(func);
            console.log(cfgToString(cfg));

            generateSvg(cfg, `${func!.name}_cfg.svg`);

            const ssaConverter = new SsaConverter(cfg);

            generateSvg(cfg, `${func!.name}_cfg_dominance.svg`, {
                showDominanceFrontier: ssaConverter.getDominanceFrontier(),
                showDominanceTree: ssaConverter.getDominanceTree(),
            });

            ssaConverter.convert();

            optimizer.optimizeFunction(func);

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

            generateSvg(cfg, `${func!.name}_cfg_after.svg`);

            this.generateFunction(func);
        });

        this.popIdent();
        this.footer();
    }

    generateFunction(f: HirFunc) {
        this.stack = new Stack();

        for (const param of f.params) {
            this.stack.push({
                name: param.name,
            });
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
            const toPop = this.stack.size();
            if (toPop > 0) {
                this.emitBulkDrop(toPop);
            }
            this.emitReturn();
        }

        this.popIdent();

        this.write(`}>`);

        this.countVars = 0;
    }

    processStatement(statement: HirStmt) {
        if (statement.kind === "expr_stmt") {
            this.processExpr(statement.expr);
        }

        if (statement.kind === "variable") {
            this.processExpr(statement.value);
            if (statement.value.kind === "number") {
                // TODO: better way
                this.stack.pop(1);
            }
            this.stack.push({ name: statement.name.name });
        }

        if (statement.kind === "assign") {
            const leftIndex = this.stack.indexOfExpr(statement.left);
            const rightIndex = this.stack.indexOfExpr(statement.right);
            if (leftIndex === 0 && rightIndex === -1) {
                this.emitDrop();
                this.processExpr(statement.right);
            }

            // this.processExpr(statement.value);
            // this.stack.push({name: statement.name.name});
        }

        if (statement.kind === "if") {
            const onTop = this.processExpr(statement.condition);
            this.stack.pop(1);

            this.pushStack();
            this.write(`IF:<{`);

            this.pushIndent();
            for (const stmt of statement.then.stmts) {
                if (onTop) {
                    // this.stack.pop(1)
                    // this.write(`DROP // drop duplicated value for condition`);
                }

                this.processStatement(stmt);
            }
            this.popIdent();
            this.write(`}>`);
            this.popStack();

            if (statement.else !== undefined) {
                this.pushStack();
                this.write(`ELSE:<{`);
                this.pushIndent();
                for (const stmt of statement.else.stmts) {
                    this.processStatement(stmt);
                }
                this.popIdent();
                this.write(`}>`);
                this.popStack();
            }
        }

        if (statement.kind === "return" && statement.expr !== null) {
            const exprIndex = this.stack.indexOfExpr(statement.expr);
            if (exprIndex === 0) {
                const size = this.stack.size();
                if (size === 1) {
                    // nothing to do, value already on the top of the stack
                    return;
                }

                const countToDrop = size - 1;
                this.emitBulkDrop2(countToDrop, 1);
                this.comment(`stack before: ${this.stack.toString()}`);
                return;
            }

            // need to pop this count of expressions
            if (exprIndex > 0) {
                this.emitBulkDrop(exprIndex);
            }

            // push things like integer and booleans on the top of the stack
            this.processNonIdentExpr(statement.expr);
            this.emitReturn();
        }

        if (statement.kind === "return" && statement.expr === null) {
            // clean up stack
            const toPop = this.stack.size();
            if (toPop > 0) {
                this.emitBulkDrop(toPop);
            }
            this.emitReturn();
        }
    }

    processNonIdentExpr(expr: HirExpr) {
        if (expr.kind === "identifier") return;

        if (expr.kind === "number") {
            this.emitPushInt(expr.value);
        }
    }

    processExpr(expr: HirExpr): boolean {
        this.processNonIdentExpr(expr);

        if (expr.kind === "identifier" && this.func !== null) {
            const index = this.stack.indexOf(expr.name);
            if (index === TOP_OF_STACK) {
                // nothing to do, variable already on top of the stack
                return true;
            }

            // otherwise push this variable on top of the stack
            this.loadVariable(index, expr.name);
        }

        const binaryOpCommand = (op: string, type: string): string => {
            if (op === "+") return "ADD";
            if (op === "*") return "MUL";
            if (op === "-") return "SUB";
            if (op === "/") return "DIV";
            if (op === "==") {
                if (type === "Address") {
                    return "SDEQ";
                }
                return "EQUAL";
            }
            if (op === "!=") return "NEQ";
            if (op === ">") return "GREATER";
            if (op === "<") return "LESS";
            if (op === "<=") return "LEQ";
            if (op === ">=") return "GEQ";
            return "NOP";
        };

        const typeOf = (expr: HirExpr): string => {
            if (expr.kind !== "identifier") return "";
            if (expr.type.kind === "ref") return expr.type.name;
            return "";
        };

        if (expr.kind === "binary") {
            const leftIndex = this.stack.indexOfExpr(expr.left);
            const rightIndex = this.stack.indexOfExpr(expr.right);

            if (
                expr.op === "+" ||
                expr.op === "*" ||
                expr.op === "==" ||
                expr.op === "!="
            ) {
                // if both values already on top of the stack
                if (
                    (leftIndex === 0 && rightIndex === 1) ||
                    (leftIndex === 1 && rightIndex === 0)
                ) {
                    const op = binaryOpCommand(expr.op, typeOf(expr.left));
                    this.write(op);
                    this.stack.pop(2);
                    return false;
                }

                // imagine we have [a, b, c] and we want to sum `a` and `b`
                // then we transform stack to [c, a, b], and sum up [c. res]
                if (
                    (leftIndex === 1 && rightIndex === 2) ||
                    (leftIndex === 2 && rightIndex === 1)
                ) {
                    this.emitRevRot();
                    this.comment(`-> ${this.stack.toString()}`);

                    const op = binaryOpCommand(expr.op, typeOf(expr.left));
                    this.write(op);
                    this.stack.pop(2);
                    return false;
                }
            }

            if (
                expr.op === "-" ||
                expr.op === "/" ||
                expr.op === "<" ||
                expr.op === ">" ||
                expr.op === "<=" ||
                expr.op === ">="
            ) {
                if (leftIndex === 1 && rightIndex === 0) {
                    const op = expr.op === "-" ? "SUB" : "DIV";
                    this.write(op);
                    this.stack.pop(2);
                    return false;
                }

                // `b - a`, need to rotate
                if (leftIndex === 0 && rightIndex === 1) {
                    this.emitSwap();
                    this.comment(
                        "// we need to exchange s[0] and s[1] for correct order",
                    );

                    const op = binaryOpCommand(expr.op, typeOf(expr.left));
                    this.write(op);
                    this.stack.pop(2);
                    return false;
                }
            }

            const needDup = this.processExpr(expr.left);
            if (needDup) {
                this.emitDup();
                this.comment(
                    `// duplicate top element (${this.stack.top()}) for binary ${expr.op}`,
                );
            }

            const needDup2 = this.processExpr(expr.right);
            if (needDup2) {
                this.emitDup();
                this.comment(
                    `// duplicate top element (${this.stack.top()}) for binary ${expr.op}`,
                );
            }

            if (expr.op === "+") {
                this.emitAdd();
            }
            if (expr.op === "-") {
                this.emitSub();
            }
            if (expr.op === "*") {
                this.emitMul();
            }
            if (expr.op === "/") {
                this.emitDiv();
            }
            if (expr.op === "==") {
                this.emitEqual();
            }
            if (expr.op === "!=") {
                this.emitNotEqual();
            }
            if (expr.op === "<") {
                this.emitLess();
            }
            if (expr.op === "<=") {
                this.emitLessOrEqual();
            }
            if (expr.op === ">") {
                this.emitGreater();
            }
            if (expr.op === ">=") {
                this.emitGreaterOrEqual();
            }
        }

        if (expr.kind === "call") {
            if (expr.name.name === "dumpStack") {
                this.emitDumpStack();
                return false;
            }

            if (expr.name.name === "sender2") {
                this.emitNull();
                return false;
            }

            expr.args.forEach((arg) => {
                const onTop = this.processExpr(arg);

                // if we call function with argument that on top of the stack we need
                // to duplicate it
                if (onTop) {
                    this.emitDup();
                    this.comment("duplicate top element for call");
                }
            });

            this.emitInlineCall(expr.name.name);

            this.stack.pop(expr.args.length);
        }

        return false;
    }

    dumpToFile() {
        const code = this.code.join("");
        writeFileSync("out.fif", code);
    }

    private loadVariable(index: number, name: string): number {
        const id = this.emitPush(`s${index}`);
        this.comment(name);
        return id;
    }

    private emit(op: Op) {
        this.write(op.kind);
        this.ops.push(op);
        return op.id;
    }

    private comment(text: string) {
        const lastOp = this.getLastOp();
        if (lastOp) {
            this.comments.set(lastOp.id, text);
        }
        return this;
    }

    // Stack manipulation
    private emitDup(): number {
        const id = this.emit(createOp.dup());
        this.stack.dup();
        return id;
    }

    private emitRevRot(): number {
        const id = this.emit(createOp.revRot());
        this.stack.rev_rot();
        return id;
    }

    private emitDrop(): number {
        const id = this.emit(createOp.drop());
        this.stack.pop(1);
        return id;
    }

    private emitSwap(): number {
        const id = this.emit(createOp.swap());
        this.stack.rot2();
        return id;
    }

    private emitBulkDrop(count: number): number {
        const id = this.emit(createOp.bulkDrop(count));
        this.stack.pop(count);
        return id;
    }

    private emitBulkDrop2(count: number, index: number): number {
        const id = this.emit(createOp.bulkDrop2(count, index));
        this.stack.bulkDrop2(count, index);
        return id;
    }

    // Arithmetic operations
    private emitAdd(): number {
        const id = this.emit(createOp.add());
        this.stack.pop(2);
        return id;
    }

    private emitSub(): number {
        const id = this.emit(createOp.sub());
        this.stack.pop(2);
        return id;
    }

    private emitMul(): number {
        const id = this.emit(createOp.mul());
        this.stack.pop(2);
        return id;
    }

    private emitDiv(): number {
        const id = this.emit(createOp.div());
        this.stack.pop(2);
        return id;
    }

    // Comparison operations
    private emitEqual(): number {
        const id = this.emit(createOp.equal());
        this.stack.pop(2);
        return id;
    }

    private emitNotEqual(): number {
        const id = this.emit(createOp.notEqual());
        this.stack.pop(2);
        return id;
    }

    private emitLess(): number {
        const id = this.emit(createOp.less());
        this.stack.pop(2);
        return id;
    }

    private emitGreater(): number {
        const id = this.emit(createOp.greater());
        this.stack.pop(2);
        return id;
    }

    private emitLessOrEqual(): number {
        const id = this.emit(createOp.lessOrEqual());
        this.stack.pop(2);
        return id;
    }

    private emitGreaterOrEqual(): number {
        const id = this.emit(createOp.greaterOrEqual());
        this.stack.pop(2);
        return id;
    }

    // Control flow
    private emitCall(func: string, argCount: number): number {
        const id = this.emit(createOp.call(func));
        this.stack.pop(argCount);
        return id;
    }

    private emitReturn(): number {
        return this.emit(createOp.return());
    }

    // Debug
    private emitDumpStack(): number {
        return this.emit(createOp.dumpStack());
    }

    // Value pushing
    private emitPush(value: string): number {
        const id = this.emit(createOp.push(value));
        this.stack.push({ name: value });
        return id;
    }

    private emitPushInt(value: bigint): number {
        const id = this.emit(createOp.pushInt(value));
        this.stack.push({ name: value.toString() });
        return id;
    }

    // Добавим методы для работы с комментариями
    getComment(opId: number): string | undefined {
        return this.comments.get(opId);
    }

    setComment(opId: number, comment: string) {
        this.comments.set(opId, comment);
    }

    // Добавим метод для получения операции по ID
    getOp(id: number): Op | undefined {
        return this.ops.find((op) => op.id === id);
    }

    // Добавим метод для получения строкового представления операции с комментарием
    formatOp(op: Op): string {
        const comment = this.comments.get(op.id);
        return comment ? `${op.kind} // ${comment}` : op.kind;
    }

    // Метод для получения всей последовательности операций
    getOps(): Op[] {
        return [...this.ops];
    }

    // Метод для получения последней операции
    getLastOp(): Op | undefined {
        return this.ops[this.ops.length - 1];
    }

    private emitNull(): number {
        const id = this.emit(createOp.null());
        this.stack.push({ name: "null" });
        return id;
    }

    private emitInlineCall(func: string): number {
        return this.emit(createOp.inlineCall(func));
    }
}
