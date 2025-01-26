import { getAllStaticFunctions } from "../../types/resolveDescriptors";
import { CompilerContext } from "../../context/context";
import { Convertor } from "../../hir/convert";
import { HirExpr, HirFunc, HirStmt } from "../../hir/hir";
import { BlockId, buildCfg, cfgToString, generateSvg } from "../../hir/cfg";
import { createOp, Op } from "../../hir/bytecode/bytecode";
import { BasicBlock, Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID } from "../../hir/cfg";
import { BytecodeEmitter } from "./BytecodeEmitter";
import { optimizer } from "../../hir/optimizer/rules";
import { CommonSubexpressionElimination } from "../../hir/cfg/analysis/cse";
import { CommonStatementsExtraction } from "../../hir/cfg/analysis/common_stmts";
import { CfgSimplifier } from "../../hir/cfg/analysis/simplify";
import { DeadCodeElimination } from "../../hir/cfg/analysis/dce";
import { SsaConverter } from "../../hir/cfg/ssa";
import { print } from "../../hir/hir-printer";
import { VariableUsageAnalyzer } from "../../hir/cfg/analysis/var_usage";

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
    private stack: Stack = new Stack();
    private usages: Map<string, number> = new Map();
    private stacks: Stack[] = [];
    private ctx: CompilerContext | null = null;

    private block: BasicBlock | null = null;

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

    processProgram(ctx: CompilerContext) {
        this.ctx = ctx;
        const funcs = getAllStaticFunctions(ctx)
            .map((f) => {
                const conv = new Convertor(this.ctx!);
                return conv.convertFunction(f);
            })
            .filter((n) => n !== undefined)
            .map((func) => {
                console.log(print(func!.body));

                const cfg = buildCfg(func);

                console.log(cfgToString(cfg));

                generateSvg(cfg, `${func!.name}_cfg.svg`);

                const ssaConverter = new SsaConverter(cfg);
                ssaConverter.convert();

                generateSvg(cfg, `${func!.name}_cfg_dominance.svg`, {
                    showDominanceFrontier: ssaConverter.getDominanceFrontier(),
                    showDominanceTree: ssaConverter.getDominanceTree(),
                });

                const usageAnalyzer = new VariableUsageAnalyzer(cfg);
                const usages = usageAnalyzer.analyze();

                console.log("Variable usages:");
                for (const [varName, count] of usages) {
                    console.log(`  ${varName}: ${count} times`);
                }

                optimizer.optimizeFunction(func);

                generateSvg(cfg, `${func!.name}_cfg2.svg`);

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

                this.processFunction(func!, cfg, usages);

                generateSvg(cfg, `${func!.name}_cfg_bytecode.svg`, {
                    showBytecode: true,
                });

                return { cfg, name: func!.name };
            });

        const emitter = new BytecodeEmitter();
        emitter.emitProgram(funcs);
    }

    private processFunction(f: HirFunc, cfg: Cfg, usages: Map<string, number>) {
        this.stack = new Stack();
        this.usages = usages;

        for (const param of f.params) {
            this.stack.push({ name: param.name });
        }

        const blockStacks: Map<BlockId, Stack> = new Map();

        const worklist: BlockId[] = [];

        const firstBlockId = Object.keys(cfg)
            .map(Number)
            .find((id) => id !== ENTRY_BLOCK_ID && id !== EXIT_BLOCK_ID);

        if (firstBlockId === undefined) return;

        blockStacks.set(firstBlockId, this.stack);
        worklist.push(firstBlockId);

        while (worklist.length > 0) {
            const blockId = worklist.pop()!;
            const block = cfg[blockId]!;

            if (block.predecessors.length > 1) {
                const stacks = block.predecessors
                    .map((predId) => blockStacks.get(predId))
                    .filter((s): s is Stack => s !== undefined);

                if (stacks.length > 0) {
                    const minDepth = Math.min(...stacks.map((s) => s.size()));
                    const mergedStack = new Stack();

                    for (let i = 0; i < minDepth; i++) {
                        const varName = stacks[0]!.values[i]!.name;
                        if (
                            stacks.every((s) => s.values[i]?.name === varName)
                        ) {
                            mergedStack.push({ name: varName });
                        }
                    }

                    this.stack = mergedStack;
                }
            } else {
                const predStack = block.predecessors
                    .map((predId) => blockStacks.get(predId))
                    .find((s) => s !== undefined);

                if (predStack) {
                    this.stack = new Stack();
                    predStack.values.forEach((v) => {
                        this.stack.push(v);
                    });
                }
            }

            this.generateBlockBytecode(block);

            blockStacks.set(blockId, this.stack);

            for (const nextId of block.successors) {
                if (nextId === EXIT_BLOCK_ID) continue;

                const nextBlock = cfg[nextId]!;
                if (
                    !blockStacks.has(nextId) ||
                    nextBlock.predecessors.every((predId) =>
                        blockStacks.has(predId),
                    )
                ) {
                    worklist.push(nextId);
                }
            }
        }
    }

    private generateBlockBytecode(block: BasicBlock) {
        this.block = block;
        block.bytecode = [];

        for (const stmt of block.stmts) {
            this.generateStmtBytecode(stmt);
        }

        if (block.terminator.kind === "return") {
            block.bytecode.push(createOp.return());
        }

        if (block.terminator.kind === "conditional") {
            this.processExpr(block.terminator.condition);
            this.stack.pop(1);
        }
    }

    private generateStmtBytecode(stmt: HirStmt) {
        if (stmt.kind === "expr_stmt") {
            this.processExpr(stmt.expr);
        }

        if (stmt.kind === "variable") {
            if (stmt.value.kind === "phi") {
                this.stack.push({ name: stmt.name.name });
                return;
            }

            const needDup = this.processExpr(stmt.value);

            // let a = b
            if (needDup) {
                // TODO
                this.emit(createOp.dup());
            }

            if (stmt.value.kind === "number") {
                // TODO: better way
                this.stack.pop(1);
            }
            this.stack.push({ name: stmt.name.name });
        }

        if (stmt.kind === "assign") {
            const leftIndex = this.stack.indexOfExpr(stmt.left);
            const rightIndex = this.stack.indexOfExpr(stmt.right);
            if (leftIndex === 0 && rightIndex === -1) {
                this.emitDrop();
                this.processExpr(stmt.right);
            }
        }

        if (stmt.kind === "return" && stmt.expr !== null) {
            const exprIndex = this.stack.indexOfExpr(stmt.expr);
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
            this.processNonIdentExpr(stmt.expr);
            this.emitReturn();
        }

        if (stmt.kind === "return" && stmt.expr === null) {
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

        if (expr.kind === "identifier") {
            const index = this.stack.indexOf(expr.name);
            if (index === TOP_OF_STACK) {
                // nothing to do, variable already on top of the stack
                return true;
            }

            // otherwise push this variable on top of the stack
            this.loadVariable(index, expr.name);
        }

        const binaryOpCommand = (op: string, type: string): Op => {
            switch (op) {
                case "+":
                    return createOp.add();
                case "*":
                    return createOp.mul();
                case "-":
                    return createOp.sub();
                case "/":
                    return createOp.div();
                case "==":
                    if (type === "Address") {
                        // TODO: Implement SDEQ operation
                        return createOp.equal();
                    }
                    return createOp.equal();
                case "!=":
                    return createOp.notEqual();
                case ">":
                    return createOp.greater();
                case "<":
                    return createOp.less();
                case "<=":
                    return createOp.lessOrEqual();
                case ">=":
                    return createOp.greaterOrEqual();
                default:
                    throw new Error(`Unknown binary operator: ${op}`);
            }
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
                    this.emit(op);
                    this.comment(print(expr));
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
                    this.emit(op);
                    this.comment(print(expr));
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
                    const op = binaryOpCommand(expr.op, typeOf(expr.left));
                    this.emit(op);
                    this.comment(print(expr));
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
                    this.emit(op);
                    this.comment(print(expr));
                    this.stack.pop(2);
                    return false;
                }
            }

            const onTop = this.processExpr(expr.left);
            if (onTop && this.usedManyTimes(expr.left)) {
                this.emitDup();
                this.comment(
                    `// duplicate top element (${this.stack.top()}) for binary ${expr.op}`,
                );
            }

            const onTop2 = this.processExpr(expr.right);
            if (onTop2 && this.usedManyTimes(expr.left)) {
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

            this.comment(print(expr));
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

    private usedManyTimes(expr: HirExpr): boolean {
        if (expr.kind !== "identifier") return true;
        const count = this.usages.get(expr.name) ?? 1;
        return count > 1;
    }

    private loadVariable(index: number, name: string): number {
        const id = this.emitPush(`s${index}`);
        this.comment(name);
        return id;
    }

    private emit(op: Op) {
        this.block?.bytecode.push(op);
        return op.id;
    }

    private comment(text: string) {
        const lastOp = this.getLastOp();
        if (lastOp) {
            this.block?.comments.set(lastOp.id, text);
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

    private emitDumpStack(): number {
        return this.emit(createOp.dumpStack());
    }

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

    getLastOp(): Op | undefined {
        if (!this.block) return undefined;
        return this.block.bytecode[this.block.bytecode.length - 1];
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
