import * as H from "../hir";
import {BlockId, Cfg, ENTRY_BLOCK_ID, EXIT_BLOCK_ID} from "./block";

type DominanceFrontier = Map<BlockId, Set<BlockId>>;
type DominanceTree = Map<BlockId, Set<BlockId>>;
type VariableStacks = Map<string, string[]>;

export class SsaConverter {
    private idoms: Map<BlockId, BlockId> = new Map();
    private dominanceFrontier: DominanceFrontier = new Map();
    private dominanceTree: DominanceTree = new Map();
    private variableStacks: VariableStacks = new Map();
    private variableCounters: Map<string, number> = new Map();

    constructor(private cfg: Cfg) {
        this.computeDominators();
        this.computeDominanceFrontier();
        this.buildDominanceTree();
    }

    convert(): void {
        const variables = this.collectVariables();

        for (const variable of variables) {
            this.variableStacks.set(variable, [variable]);
            this.variableCounters.set(variable, 0);

            const definitions = this.findDefinitions(variable);
            this.insertPhiFunctions(variable, definitions);
        }

        this.rename(ENTRY_BLOCK_ID, new Set());
    }

    private collectVariables(): Set<string> {
        const variables: Set<string> = new Set();

        const processExpr = (expr: H.HirExpr): void => {
            if (expr.kind === "identifier") {
                variables.add(expr.name);
            } else if (expr.kind === "binary") {
                processExpr(expr.left);
                processExpr(expr.right);
            } else if (expr.kind === "call") {
                expr.args.forEach(processExpr);
            }
        };

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            const block = this.cfg[blockId]!;

            for (const stmt of block.stmts) {
                if (stmt.kind === "variable") {
                    variables.add(stmt.name.name);
                    processExpr(stmt.value);
                } else if (stmt.kind === "assign" && stmt.left.kind === "identifier") {
                    variables.add(stmt.left.name);
                    processExpr(stmt.right);
                } else if (stmt.kind === "return" && stmt.expr) {
                    processExpr(stmt.expr);
                } else if (stmt.kind === "if") {
                    processExpr(stmt.condition);
                }
            }

            if (block.terminator.kind === "conditional") {
                processExpr(block.terminator.condition);
            }
        }

        return variables;
    }

    private findDefinitions(variable: string): Set<BlockId> {
        const workList: Set<BlockId> = new Set();
        const everOnWorkList: Set<BlockId> = new Set();
        const alreadyHasPhiFunc: Set<BlockId> = new Set();

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            const block = this.cfg[blockId]!;

            for (const stmt of block.stmts) {
                if ((stmt.kind === "variable" && stmt.name.name === variable) ||
                    (stmt.kind === "assign" && stmt.left.kind === "identifier" && stmt.left.name === variable)) {
                    workList.add(blockId);
                    everOnWorkList.add(blockId);
                    break;
                }
            }
        }

        this.processWorkList(variable, workList, everOnWorkList, alreadyHasPhiFunc);
        return everOnWorkList;
    }

    private processWorkList(
        variable: string,
        workList: Set<BlockId>,
        everOnWorkList: Set<BlockId>,
        alreadyHasPhiFunc: Set<BlockId>
    ): void {
        while (workList.size > 0) {
            const blockId = workList.values().next().value!;
            workList.delete(blockId);

            const frontier = this.dominanceFrontier.get(blockId)!;
            for (const dfBlockId of frontier) {
                if (!alreadyHasPhiFunc.has(dfBlockId)) {
                    const block = this.cfg[dfBlockId]!;
                    const hasPhiForVar = block.stmts.some(stmt =>
                        stmt.kind === "variable" &&
                        stmt.name.name.startsWith(`${variable}_phi`));

                    if (!hasPhiForVar) {
                        this.insertPhiFunction(dfBlockId, variable);
                        alreadyHasPhiFunc.add(dfBlockId);

                        if (!everOnWorkList.has(dfBlockId)) {
                            workList.add(dfBlockId);
                            everOnWorkList.add(dfBlockId);
                        }
                    }
                }
            }
        }
    }

    private insertPhiFunction(blockId: BlockId, variable: string): void {
        const block = this.cfg[blockId]!;
        
        const phiStmt: H.HirStmt = {
            kind: "variable",
            name: {
                kind: "identifier",
                name: `${variable}_phi`
            },
            value: {
                kind: "phi",
                args: block.predecessors.map(predId => ({
                    kind: "identifier",
                    name: `${variable}__block_${predId}`
                }))
            }
        };
        
        block.stmts.unshift(phiStmt);
    }

    private renameVariable(baseName: string): string {
        if (!this.variableStacks.has(baseName)) {
            this.variableStacks.set(baseName, [baseName]);
            this.variableCounters.set(baseName, 0);
        }
        const newName = this.generateNewName(baseName);
        this.variableStacks.get(baseName)!.push(newName);
        return newName;
    }

    private rename(blockId: BlockId, visited: Set<BlockId>): void {
        if (visited.has(blockId)) return;
        visited.add(blockId);

        const block = this.cfg[blockId]!;
        const savedStacks = new Map(Array.from(this.variableStacks.entries())
            .map(([k, v]) => [k, [...v]]));

        for (const stmt of block.stmts) {
            if (stmt.kind === "variable" && stmt.value.kind === "phi") {
                const baseName = stmt.name.name.split("_")[0]!;
                stmt.name.name = this.renameVariable(baseName);
            }
        }

        for (const stmt of block.stmts) {
            this.replaceUses(stmt);

            if (stmt.kind === "variable" && !stmt.name.name.endsWith("_phi") && !stmt.name.name.startsWith("_")) {
                const baseName = stmt.name.name.split("_")[0]!;
                stmt.name.name = this.renameVariable(baseName);
            } else if (stmt.kind === "assign" && stmt.left.kind === "identifier") {
                const baseName = stmt.left.name;
                const newName = this.renameVariable(baseName);

                block.stmts[block.stmts.indexOf(stmt)] = {
                    kind: "variable",
                    name: {
                        kind: "identifier",
                        name: newName
                    },
                    value: stmt.right
                };
            }
        }

        for (const succId of block.successors) {
            const succ = this.cfg[succId]!;
            const predIndex = succ.predecessors.indexOf(blockId);
            if (predIndex === -1) continue;

            for (const stmt of succ.stmts) {
                if (stmt.kind === "variable" && stmt.value.kind === "phi") {
                    const arg = stmt.value.args[predIndex]!;
                    if (arg.name.includes("__block_")) {
                        const baseName = arg.name.split("__block_")[0]!;
                        if (this.variableStacks.has(baseName)) {
                            arg.name = this.variableStacks.get(baseName)!.at(-1)!;
                        }
                    }
                }
            }
        }

        const children = this.dominanceTree.get(blockId) ?? new Set();
        for (const childId of children) {
            this.rename(childId, visited);
        }

        this.variableStacks = new Map(savedStacks);
    }

    private computeDominators(): void {
        const blocks = new Set(Object.keys(this.cfg).map(Number));
        blocks.delete(ENTRY_BLOCK_ID);
        blocks.delete(EXIT_BLOCK_ID);

        this.idoms.set(ENTRY_BLOCK_ID, ENTRY_BLOCK_ID);

        let changed = true;
        while (changed) {
            changed = false;

            for (const blockId of blocks) {
                const block = this.cfg[blockId]!;
                const processedPreds = block.predecessors
                    .filter(p => this.idoms.has(p));

                if (processedPreds.length === 0) continue;

                let newIdom = processedPreds[0]!;

                for (let i = 1; i < processedPreds.length; i++) {
                    newIdom = this.intersectDominators(newIdom, processedPreds[i]!);
                }

                if (!this.idoms.has(blockId) || this.idoms.get(blockId) !== newIdom) {
                    this.idoms.set(blockId, newIdom);
                    changed = true;
                }
            }
        }
    }

    private intersectDominators(b1: BlockId, b2: BlockId): BlockId {
        let finger1: BlockId = b1;
        let finger2: BlockId = b2;

        while (finger1 !== finger2) {
            while (finger1 > finger2 && this.idoms.has(finger1)) {
                finger1 = this.idoms.get(finger1)!;
            }
            while (finger2 > finger1 && this.idoms.has(finger2)) {
                finger2 = this.idoms.get(finger2)!;
            }
        }

        return finger1;
    }

    private computeDominanceFrontier(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            this.dominanceFrontier.set(blockId, new Set());
        }

        for (const blockId of Object.keys(this.cfg).map(Number)) {
            if (blockId === ENTRY_BLOCK_ID || blockId === EXIT_BLOCK_ID) continue;
            const block = this.cfg[blockId]!;

            if (block.predecessors.length >= 2) {
                for (const predId of block.predecessors) {
                    let runner = predId;
                    const idom = this.idoms.get(blockId);
                    while (runner !== idom) {
                        this.dominanceFrontier.get(runner)!.add(blockId);
                        runner = this.idoms.get(runner)!;
                    }
                }
            }
        }
    }

    private buildDominanceTree(): void {
        for (const blockId of Object.keys(this.cfg).map(Number)) {
            this.dominanceTree.set(blockId, new Set());
        }

        for (const [blockId, idom] of this.idoms) {
            if (blockId !== idom) {
                this.dominanceTree.get(idom)!.add(blockId);
            }
        }
    }

    private generateNewName(baseName: string): string {
        const counter = this.variableCounters.get(baseName) ?? 0;
        const newName = `${baseName}_${counter + 1}`;
        this.variableCounters.set(baseName, counter + 1);
        return newName;
    }

    private replaceUses(stmt: H.HirStmt): void {
        const replaceInExpr = (expr: H.HirExpr): void => {
            if (expr.kind === "identifier") {
                const baseName = expr.name.split("_")[0]!;
                if (this.variableStacks.has(baseName)) {
                    if (!expr.name.includes("__block_")) {
                        const versions = this.variableStacks.get(baseName)!;
                        if (versions.length > 0) {
                            expr.name = versions[versions.length - 1]!;
                        }
                    }
                }
            } else if (expr.kind === "binary") {
                replaceInExpr(expr.left);
                replaceInExpr(expr.right);
            } else if (expr.kind === "call") {
                expr.args.forEach(replaceInExpr);
            } else if (expr.kind === "phi") {
                // skip phi nodes
            }
        };

        if (stmt.kind === "variable") {
            replaceInExpr(stmt.value);
        } else if (stmt.kind === "assign") {
            replaceInExpr(stmt.right);
        } else if (stmt.kind === "return" && stmt.expr) {
            replaceInExpr(stmt.expr);
        } else if (stmt.kind === "if") {
            replaceInExpr(stmt.condition);
        }
    }

    private insertPhiFunctions(variable: string, definitions: Set<BlockId>): void {
        const workList: Set<BlockId> = new Set();
        const everOnWorkList: Set<BlockId> = new Set();
        const alreadyHasPhiFunc: Set<BlockId> = new Set();

        for (const blockId of definitions) {
            workList.add(blockId);
            everOnWorkList.add(blockId);
        }

        this.processWorkList(variable, workList, everOnWorkList, alreadyHasPhiFunc);
    }

    getDominanceFrontier(): Map<BlockId, Set<BlockId>> {
        return this.dominanceFrontier;
    }

    getDominanceTree(): Map<BlockId, Set<BlockId>> {
        return this.dominanceTree;
    }
} 
