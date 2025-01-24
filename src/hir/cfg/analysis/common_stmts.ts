import {Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID, BasicBlock} from "../block";
import {hash} from "../../hir-hash";

export class CommonStatementsExtraction {
    constructor(private cfg: Cfg) {
    }

    private optimizeBlock(block: BasicBlock): void {
        if (block.terminator.kind === "conditional") {
            const blocks = block.successors.map(id => this.cfg[id]!);

            const trueBranch = blocks[0]!
            const falseBranch = blocks[1]!

            let trueHash = 0
            let falseHash = 0

            let sameStatements = -1

            for (let i = 0; i < trueBranch.stmts.length; i++) {
                const trueBranchStmt = trueBranch.stmts.at(-i)!;
                const falseBranchStmt = falseBranch.stmts.at(-i);
                if (!falseBranchStmt) break

                trueHash += hash(trueBranchStmt);
                falseHash += hash(falseBranchStmt);

                if (trueHash !== falseHash) {
                    break
                }

                sameStatements = i
            }

            if (sameStatements !== -1) {
                const nextBlock = this.cfg[trueBranch.successors[0]!]!;
                nextBlock.stmts.push(...trueBranch.stmts.slice(sameStatements))

                if (sameStatements === 0) {
                    sameStatements++
                }

                trueBranch.stmts = trueBranch.stmts.slice(0, trueBranch.stmts.length - sameStatements)
                falseBranch.stmts = falseBranch.stmts.slice(0, falseBranch.stmts.length - sameStatements)
            }
        }

    }

    optimize(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            this.optimizeBlock(this.cfg[blockId]!);
        }
    }
} 
