import { binary, Optimizer } from "./optimizer";

export const optimizer = new Optimizer();

// x + 0 = x
optimizer.addRule(
    binary(
        (n) =>
            n.op === "+" && n.right.kind === "number" && n.right.value === 0n,
        (n) => n.left,
    ),
);

// 0 + x = x
optimizer.addRule(
    binary(
        (n) => n.op === "+" && n.left.kind === "number" && n.left.value === 0n,
        (n) => n.right,
    ),
);

// x * 1 = x
optimizer.addRule(
    binary(
        (n) =>
            n.op === "*" && n.right.kind === "number" && n.right.value === 1n,
        (n) => n.left,
    ),
);

// 1 * x = x
optimizer.addRule(
    binary(
        (n) => n.op === "*" && n.left.kind === "number" && n.left.value === 1n,
        (n) => n.right,
    ),
);

// x * 0 = 0
optimizer.addRule(
    binary(
        (n) =>
            n.op === "*" &&
            ((n.right.kind === "number" && n.right.value === 0n) ||
                (n.left.kind === "number" && n.left.value === 0n)),
        (_) => ({ kind: "number", value: 0n }),
    ),
);

// x - x = 0
optimizer.addRule(
    binary(
        (n) =>
            n.op === "-" &&
            n.left.kind === "identifier" &&
            n.right.kind === "identifier" &&
            n.left.name === n.right.name,
        (_) => ({ kind: "number", value: 0n }),
    ),
);

// x - 0 = x
optimizer.addRule(
    binary(
        (n) =>
            n.op === "-" && n.right.kind === "number" && n.right.value === 0n,
        (n) => n.left,
    ),
);

// x / 1 = x
optimizer.addRule(
    binary(
        (n) =>
            n.op === "/" && n.right.kind === "number" && n.right.value === 1n,
        (n) => n.left,
    ),
);

// x == x = true
optimizer.addRule(
    binary(
        (n) =>
            (n.op === "==" || n.op === "<=") &&
            n.left.kind === "identifier" &&
            n.right.kind === "identifier" &&
            n.left.name === n.right.name,
        (_) => ({ kind: "number", value: 1n }),
    ),
);

// x != x = false
optimizer.addRule(
    binary(
        (n) =>
            (n.op === "!=" || n.op === "<" || n.op === ">") &&
            n.left.kind === "identifier" &&
            n.right.kind === "identifier" &&
            n.left.name === n.right.name,
        (_) => ({ kind: "number", value: 0n }),
    ),
);
