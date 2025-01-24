import {BasicBlock, BlockId, Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID} from "../block";

export class CfgSimplifier {
    constructor(private cfg: Cfg) {
    }

    optimize(): void {
        let changed: boolean;
        do {
            changed = false;
            changed = this.simplifyConditionals() || changed;
            changed = this.removeEmptyBlocks() || changed;
            changed = this.mergeBlocks() || changed;
        } while (changed);
    }

    private removeEmptyBlocks(): boolean {
        let changed = false;

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;

            const block = this.cfg[blockId]!;
            if (block.stmts.length === 0 && block.terminator.kind === "unconditional") {
                const targetId = block.terminator.target;
                if (targetId === ENTRY_BLOCK_ID || targetId === EXIT_BLOCK_ID) continue;

                for (const predId of block.predecessors) {
                    const pred = this.cfg[predId]!;
                    this.redirectJumps(pred, blockId, targetId);

                    const predSuccIdx = pred.successors.indexOf(blockId);
                    if (predSuccIdx !== -1) {
                        pred.successors[predSuccIdx] = targetId;
                    }
                }

                const target = this.cfg[targetId]!;
                const predIdx = target.predecessors.indexOf(blockId);
                if (predIdx !== -1) {
                    target.predecessors.splice(predIdx, 1);
                }
                target.predecessors.push(...block.predecessors);

                delete this.cfg[blockId];
                changed = true;
            }
        }

        return changed;
    }

    private mergeBlocks(): boolean {
        let changed = false;

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;

            const block = this.cfg[blockId];
            if (!block) continue;

            if (block.terminator.kind === "unconditional") {
                const targetId = block.terminator.target;
                if (targetId === ENTRY_BLOCK_ID || targetId === EXIT_BLOCK_ID) continue;

                const target = this.cfg[targetId]!;

                if (target.predecessors.length === 1 && block.successors.length === 1) {
                    block.stmts.push(...target.stmts);
                    block.terminator = target.terminator;
                    block.successors = target.successors;

                    for (const succId of target.successors) {
                        const succ = this.cfg[succId]!;
                        const predIdx = succ.predecessors.indexOf(targetId);
                        if (predIdx !== -1) {
                            succ.predecessors[predIdx] = blockId;
                        }
                    }

                    delete this.cfg[targetId];
                    changed = true;
                }
            }
        }

        return changed;
    }

    private redirectJumps(block: BasicBlock, oldTarget: BlockId, newTarget: BlockId): void {
        if (block.terminator.kind === "unconditional" && block.terminator.target === oldTarget) {
            block.terminator.target = newTarget;
        } else if (block.terminator.kind === "conditional") {
            if (block.terminator.ifTrue === oldTarget) {
                block.terminator.ifTrue = newTarget;
            }
            if (block.terminator.ifFalse === oldTarget) {
                block.terminator.ifFalse = newTarget;
            }
        }
    }

    private simplifyConditionals(): boolean {
        let changed = false;

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;

            const block = this.cfg[blockId] ?? null;
            if (!block) continue

            const terminator = block.terminator;
            if (terminator.kind === "conditional") {
                const thenBlock = this.cfg[terminator.ifTrue]!;
                const elseBlock = this.cfg[terminator.ifFalse]!;

                if (thenBlock.stmts.length === 0 && elseBlock.stmts.length === 0 &&
                    thenBlock.terminator.kind === "unconditional" &&
                    elseBlock.terminator.kind === "unconditional" &&
                    thenBlock.terminator.target === elseBlock.terminator.target) {

                    const targetId = thenBlock.terminator.target;
                    const target = this.cfg[targetId]!;

                    block.terminator = {
                        kind: "unconditional",
                        target: targetId
                    };
                    block.successors = [targetId];

                    const thenIdx = target.predecessors.indexOf(terminator.ifTrue);
                    const elseIdx = target.predecessors.indexOf(terminator.ifFalse);
                    if (thenIdx !== -1) target.predecessors.splice(thenIdx, 1);
                    if (elseIdx !== -1) target.predecessors.splice(elseIdx, 1);
                    target.predecessors = target.predecessors.filter(it => it !== thenBlock.id && it !== elseBlock.id);
                    target.predecessors.push(blockId);

                    delete this.cfg[terminator.ifTrue];
                    delete this.cfg[terminator.ifFalse];

                    changed = true;
                }
            }
        }

        return changed;
    }
} 
