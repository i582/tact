import * as H from "../hir";
import { print } from "../hir-printer";
import { colorize } from "./colors";
import { Op } from "../bytecode/bytecode";

export type BlockId = number;

export const ENTRY_BLOCK_ID = 0;
export const EXIT_BLOCK_ID = 999;

export type Cfg = Record<BlockId, BasicBlock>;

export interface BasicBlock {
    id: BlockId;
    stmts: H.HirStmt[];
    predecessors: BlockId[];
    successors: BlockId[];
    terminator: Terminator;
    isEntry?: boolean;
    isExit?: boolean;

    comments: Map<BlockId, string>;
    bytecode: Op[];
}

export type Terminator =
    | {
          kind: "conditional";
          condition: H.HirExpr;
          ifTrue: BlockId;
          ifFalse: BlockId;
      }
    | { kind: "unconditional"; target: BlockId }
    | { kind: "return" };

export function createBlock(
    id: BlockId,
    isEntry = false,
    isExit = false,
): BasicBlock {
    return {
        id,
        stmts: [],
        predecessors: [],
        successors: [],
        terminator: { kind: "return" },
        isEntry,
        isExit,
        comments: new Map(),
        bytecode: [],
    };
}

export function addSuccessor(blocks: Cfg, fromId: BlockId, toId: BlockId) {
    const from = blocks[fromId]!;
    const to = blocks[toId]!;

    from.successors.push(toId);
    to.predecessors.push(fromId);
}

export function setTerminator(
    blocks: Cfg,
    blockId: BlockId,
    terminator: Terminator,
) {
    const block = blocks[blockId]!;
    block.terminator = terminator;
    block.successors = [];

    switch (terminator.kind) {
        case "conditional":
            addSuccessor(blocks, blockId, terminator.ifTrue);
            addSuccessor(blocks, blockId, terminator.ifFalse);
            break;
        case "unconditional":
            addSuccessor(blocks, blockId, terminator.target);
            break;
        case "return":
            break;
    }
}

export function blockToString(blocks: Cfg, block: BasicBlock): string {
    let result = "";

    if (block.isEntry) {
        result += colorize("Entry ", "green");
    } else if (block.isExit) {
        result += colorize("Exit ", "green");
    }
    result += colorize(`Block ${block.id}`, "bright") + ":\n";

    for (const stmt of block.stmts) {
        result += `  ${colorize(print(stmt), "gray")}\n`;
    }

    switch (block.terminator.kind) {
        case "conditional":
            result +=
                colorize("  if ", "yellow") +
                `(${print(block.terminator.condition)}) ` +
                colorize("->", "cyan") +
                colorize(` Block ${block.terminator.ifTrue}`, "bright") +
                "\n";
            result +=
                colorize("  else ", "yellow") +
                colorize("->", "cyan") +
                colorize(` Block ${block.terminator.ifFalse}`, "bright") +
                "\n";
            break;
        case "unconditional":
            result += colorize("  ->", "cyan");
            if (blocks[block.terminator.target]!.isExit) {
                result +=
                    " " +
                    colorize("Exit", "bright") +
                    colorize(` Block ${block.terminator.target}`, "bright") +
                    "\n";
            } else {
                result +=
                    colorize(` Block ${block.terminator.target}`, "bright") +
                    "\n";
            }
            break;
        case "return":
            if (block.isExit) {
                const lastStmt = block.stmts.at(block.stmts.length - 1);
                if (lastStmt && lastStmt.kind === "return" && lastStmt.expr) {
                    result +=
                        colorize("  return ", "yellow") +
                        `${print(lastStmt.expr)}\n`;
                } else {
                    result += colorize("  return", "yellow") + "\n";
                }
            }
            break;
    }

    return result;
}

export function cfgToString(blocks: Cfg): string {
    let result = "";
    const ids = Object.keys(blocks)
        .map(Number)
        .sort((a, b) => {
            if (a === ENTRY_BLOCK_ID) return -1;
            if (b === ENTRY_BLOCK_ID) return 1;
            if (a === EXIT_BLOCK_ID) return 1;
            if (b === EXIT_BLOCK_ID) return -1;
            return a - b;
        });

    for (const id of ids) {
        result += blockToString(blocks, blocks[id]!);
        result += "\n";
    }

    return result;
}
