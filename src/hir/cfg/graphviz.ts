import * as H from "../hir";
import {Cfg, BlockId} from "./block";
import {print} from "../hir-printer";
import {execSync} from "child_process";
import {applySvgStyles} from './web';

function escapeLabel(text: string): string {
    return text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function statementsToString(stmts: H.HirStmt[]): string {
    return stmts.map(stmt => print(stmt)).join('\\n');
}

function blockLabel(blocks: Cfg, id: BlockId): string {
    const block = blocks[id]!;
    let label = `Block ${id}`;

    if (block.isEntry) {
        label = "Entry " + label;
    } else if (block.isExit) {
        label = "Exit " + label;
    }

    if (block.stmts.length > 0) {
        label += `\\n${statementsToString(block.stmts)}`;
    }

    if (block.terminator.kind === "conditional") {
        label += `\\n${print(block.terminator.condition)}`;
    }

    return escapeLabel(label);
}

export function generateDot(blocks: Cfg): string {
    let dot = 'digraph CFG {\n';
    dot += '  node [shape=box, fontname="Courier"]\n';
    dot += '  edge [fontname="Courier"]\n\n';

    for (const id of Object.keys(blocks).map(Number)) {
        const block = blocks[id]!;
        const style = block.isEntry ?? block.isExit ?
            'style=filled, fillcolor=lightgray' : '';

        dot += `  node_${id} [label="${blockLabel(blocks, id)}" ${style}]\n`;
    }

    dot += '\n';

    for (const id of Object.keys(blocks).map(Number)) {
        const block = blocks[id]!;

        switch (block.terminator.kind) {
            case "conditional":
                dot += `  node_${id} -> node_${block.terminator.ifTrue} [label="true"]\n`;
                dot += `  node_${id} -> node_${block.terminator.ifFalse} [label="false"]\n`;
                break;
            case "unconditional":
                dot += `  node_${id} -> node_${block.terminator.target}\n`;
                break;
            case "return": {
                break;
            }
        }
    }

    dot += '}\n';
    return dot;
}

export function generateSvg(cfg: Cfg, outputPath: string): void {
    const dot = generateDot(cfg);

    try {
        execSync(`echo '${dot}' | dot -Tsvg -o ${outputPath}`);
        applySvgStyles(outputPath);
    } catch (error) {
        console.error('Failed to generate SVG:', error);
        throw error;
    }
} 
