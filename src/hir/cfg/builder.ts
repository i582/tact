import * as H from "../hir";
import {
    BlockId,
    Cfg,
    createBlock,
    setTerminator,
    ENTRY_BLOCK_ID,
    EXIT_BLOCK_ID,
} from "./block";

export class CfgBuilder {
    private blocks: Cfg = {};
    private currentBlockId: BlockId;
    private nextId = 1;

    constructor() {
        this.blocks[ENTRY_BLOCK_ID] = createBlock(ENTRY_BLOCK_ID, true, false);
        this.blocks[EXIT_BLOCK_ID] = createBlock(EXIT_BLOCK_ID, false, true);

        this.currentBlockId = ENTRY_BLOCK_ID;
    }

    private createNewBlock(): BlockId {
        const id = this.nextId++;
        this.blocks[id] = createBlock(id);
        return id;
    }

    addStatement(stmt: H.HirStmt) {
        if (stmt.kind === "return") {
            this.blocks[this.currentBlockId]!.stmts.push(stmt);
            setTerminator(this.blocks, this.currentBlockId, {
                kind: "unconditional",
                target: EXIT_BLOCK_ID,
            });
            return;
        }

        if (stmt.kind === "if") {
            const thenBlockId = this.createNewBlock();
            const elseBlockId = stmt.else ? this.createNewBlock() : undefined;
            const afterBlockId = this.createNewBlock();

            setTerminator(this.blocks, this.currentBlockId, {
                kind: "conditional",
                condition: stmt.condition,
                ifTrue: thenBlockId,
                ifFalse: elseBlockId ?? afterBlockId,
            });

            this.currentBlockId = thenBlockId;
            for (const s of stmt.then.stmts) {
                this.addStatement(s);
            }
            setTerminator(this.blocks, this.currentBlockId, {
                kind: "unconditional",
                target: afterBlockId,
            });

            if (elseBlockId !== undefined) {
                this.currentBlockId = elseBlockId;
                for (const s of stmt.else!.stmts) {
                    this.addStatement(s);
                }
                setTerminator(this.blocks, this.currentBlockId, {
                    kind: "unconditional",
                    target: afterBlockId,
                });
            }

            this.currentBlockId = afterBlockId;
        } else {
            this.blocks[this.currentBlockId]!.stmts.push(stmt);
        }
    }

    build(func: H.HirFunc): Cfg {
        const firstBlock = this.createNewBlock();
        setTerminator(this.blocks, ENTRY_BLOCK_ID, {
            kind: "unconditional",
            target: firstBlock,
        });
        this.currentBlockId = firstBlock;

        for (const stmt of func.body.stmts) {
            this.addStatement(stmt);
        }

        if (this.blocks[this.currentBlockId]!.terminator.kind === "return") {
            setTerminator(this.blocks, this.currentBlockId, {
                kind: "unconditional",
                target: EXIT_BLOCK_ID,
            });
        }

        return this.blocks;
    }
}

export function buildCfg(func: H.HirFunc): Cfg {
    return new CfgBuilder().build(func);
}
