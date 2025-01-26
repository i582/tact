import {
    Cfg,
    BlockId,
    ENTRY_BLOCK_ID,
    EXIT_BLOCK_ID,
    BasicBlock,
} from "../../hir/cfg";
import { Op } from "../../hir/bytecode/bytecode";
import { writeFileSync } from "fs";

export class BytecodeEmitter {
    private code: string[] = [];
    private indent: number = 0;
    private blockLabels: Map<BlockId, string> = new Map();
    private nextLabelId: number = 0;
    private comments: Map<number, string> = new Map();
    private cfg: Cfg | null = null;
    private emittedBlocks: Set<BlockId> = new Set();

    constructor() {}

    emitProgram(funcs: { cfg: Cfg; name: string }[]): void {
        this.emitHeader();

        for (const func of funcs) {
            this.emitFunction(func.cfg, func.name);
        }

        this.emitFooter();
        this.dumpToFile();
    }

    private emitHeader() {
        this.write(`"Asm.fif" include`);
        this.write(`PROGRAM{`);
        this.pushIndent();
    }

    private emitFooter() {
        this.popIndent();
        this.write(`}END>c`);
    }

    private emitFunction(cfg: Cfg, funcName: string) {
        this.cfg = cfg;
        this.emittedBlocks.clear();
        this.emitFunctionHeader(funcName);

        const firstBlockId = Object.keys(cfg)
            .map(Number)
            .find((id) => id !== ENTRY_BLOCK_ID && id !== EXIT_BLOCK_ID);

        if (firstBlockId !== undefined) {
            this.emitBlock(cfg[firstBlockId]!);
        }

        this.emitFunctionFooter();
    }

    private emitFunctionHeader(funcName: string) {
        this.write(`DECLPROC ${funcName}`);
        this.write(`${funcName} PROC:<{`);
        this.pushIndent();
    }

    private emitFunctionFooter() {
        this.popIndent();
        this.write(`}>`);
    }

    private emitBlock(block: BasicBlock) {
        if (this.emittedBlocks.has(block.id)) {
            return;
        }

        this.comments = block.comments;
        this.emittedBlocks.add(block.id);

        for (const op of block.bytecode) {
            this.emitOp(op);
        }

        this.emitTerminator(block);
    }

    private emitTerminator(block: BasicBlock) {
        switch (block.terminator.kind) {
            case "conditional": {
                this.write(`IF:<{`);
                this.pushIndent();
                const trueBlock = this.cfg![block.terminator.ifTrue]!;
                if (!this.emittedBlocks.has(trueBlock.id)) {
                    for (const op of trueBlock.bytecode) {
                        this.emitOp(op);
                    }
                }
                this.popIndent();
                this.write(`}>`);

                const falseBlock = this.cfg![block.terminator.ifFalse]!;

                if (trueBlock.successors[0] !== falseBlock.id) {
                    this.write(`ELSE:<{`);
                    this.pushIndent();

                    if (!this.emittedBlocks.has(falseBlock.id)) {
                        for (const op of falseBlock.bytecode) {
                            this.emitOp(op);
                        }
                    }

                    this.popIndent();
                    this.write(`}>`);
                }

                this.emitTerminator(trueBlock);
                break;
            }
            case "unconditional": {
                const nextBlock = this.cfg![block.terminator.target]!;
                if (!this.emittedBlocks.has(nextBlock.id)) {
                    for (const op of nextBlock.bytecode) {
                        this.emitOp(op);
                    }
                    this.emitTerminator(nextBlock);
                }
                break;
            }
            case "return":
                break;
        }
    }

    formatOp(op: Op): string {
        let args = "";
        const command = op.kind;

        switch (op.kind) {
            case "PUSHINT":
                args = op.value.toString();
                break;
            case "PUSH":
                args = op.value;
                break;
            case "CALL":
            case "INLINECALLDICT":
                args = op.function;
                break;
            case "BLKDROP":
                args = op.count.toString();
                break;
            case "BLKDROP2":
                args = `${op.count} ${op.index}`;
                break;
            default:
                // no arguments
                break;
        }

        let result = args ? `${args} ${command}` : command;

        const comment = this.comments.get(op.id);
        if (comment) {
            result += ` // ${comment}`;
        }

        return result;
    }

    private emitOp(op: Op) {
        this.write(this.formatOp(op));
    }

    setComment(opId: number, comment: string) {
        this.comments.set(opId, comment);
    }

    private getBlockLabel(blockId: BlockId): string {
        if (!this.blockLabels.has(blockId)) {
            this.blockLabels.set(blockId, `block_${this.nextLabelId++}`);
        }
        return this.blockLabels.get(blockId)!;
    }

    private write(line: string) {
        this.code.push("   ".repeat(this.indent) + line + "\n");
    }

    private pushIndent() {
        this.indent++;
    }

    private popIndent() {
        this.indent--;
    }

    private dumpToFile() {
        writeFileSync("out.fif", this.code.join(""));
    }
}
