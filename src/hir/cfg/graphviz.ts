import * as H from "../hir";
import { Cfg, BlockId } from "./block";
import { print } from "../hir-printer";
import { execSync } from "child_process";
import { applySvgStyles } from "./web";

function escapeLabel(text: string): string {
    return text.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function statementsToString(stmts: H.HirStmt[]): string {
    return stmts.map((stmt) => print(stmt)).join("\\n");
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

export function generateDot(
    cfg: Cfg,
    options: {
        showDominanceFrontier?: Map<BlockId, Set<BlockId>>;
        showDominanceTree?: Map<BlockId, Set<BlockId>>;
    } = {},
): string {
    let dot = "digraph CFG {\n";
    dot += '  node [shape=box, fontname="Courier"]\n';
    dot += '  edge [fontname="Courier"]\n\n';

    // Добавляем легенду
    dot += "  subgraph cluster_legend {\n";
    dot += '    label="Legend"\n';
    dot += "    style=filled\n";
    dot += "    color=lightgrey\n";
    dot += "    node [style=filled, fillcolor=white]\n";
    dot += "    edge [constraint=false]\n\n";

    if (
        options.showDominanceTree !== undefined ||
        options.showDominanceFrontier !== undefined
    ) {
        dot += '    legend_start [label="Legend"]\n';
        dot += '    legend_end [label=""]\n';

        if (options.showDominanceTree) {
            dot +=
                '    legend_start -> legend_end [color=blue, style=dashed, label="Dominance Tree"]\n';
        }

        if (options.showDominanceFrontier) {
            dot +=
                '    legend_start -> legend_end [color=red, style=dotted, label="Dominance Frontier"]\n';
        }
    }

    dot += "  }\n\n";

    dot += "  subgraph cluster_cfg {\n";
    dot += '    label="Control Flow Graph"\n';
    dot += "    color=black\n\n";

    for (const id of Object.keys(cfg).map(Number)) {
        const block = cfg[id]!;
        const style =
            (block.isEntry ?? block.isExit)
                ? "style=filled, fillcolor=lightgray"
                : "";

        dot += `    node_${id} [label="${blockLabel(cfg, id)}" ${style}]\n`;
    }

    for (const id of Object.keys(cfg).map(Number)) {
        const block = cfg[id]!;
        switch (block.terminator.kind) {
            case "conditional":
                dot += `    node_${id} -> node_${block.terminator.ifTrue} [label="true"]\n`;
                dot += `    node_${id} -> node_${block.terminator.ifFalse} [label="false"]\n`;
                break;
            case "unconditional":
                dot += `    node_${id} -> node_${block.terminator.target}\n`;
                break;
            case "return":
                break;
        }
    }
    dot += "  }\n\n";

    if (options.showDominanceTree) {
        dot += "  subgraph cluster_domtree {\n";
        dot += '    label="Dominance Tree"\n';
        dot += "    color=blue\n";
        dot += "    edge [color=blue, constraint=false]\n\n";

        for (const [dominator, dominated] of options.showDominanceTree) {
            for (const child of dominated) {
                dot += `    node_${dominator} -> node_${child} [style=dashed]\n`;
            }
        }
        dot += "  }\n\n";
    }

    if (options.showDominanceFrontier) {
        dot += "  subgraph cluster_domfrontier {\n";
        dot += '    label="Dominance Frontier"\n';
        dot += "    color=red\n";
        dot += "    edge [color=red, constraint=false]\n\n";

        for (const [block, frontier] of options.showDominanceFrontier) {
            for (const frontierBlock of frontier) {
                dot += `    node_${block} -> node_${frontierBlock} [style=dotted]\n`;
            }
        }
        dot += "  }\n";
    }

    dot += "}\n";
    return dot;
}

export function generateSvg(
    cfg: Cfg,
    outputPath: string,
    options: {
        showDominanceFrontier?: Map<BlockId, Set<BlockId>>;
        showDominanceTree?: Map<BlockId, Set<BlockId>>;
    } = {},
): void {
    const dot = generateDot(cfg, options);

    try {
        execSync(`echo '${dot}' | dot -Tsvg -o ${outputPath}`);
        applySvgStyles(outputPath);
    } catch (error) {
        console.error("Failed to generate SVG:", error);
        throw error;
    }
}
