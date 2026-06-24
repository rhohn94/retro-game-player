// SHARED BARREL (append-only). Re-exports every domain's typed IPC wrappers and
// DTOs so the rest of the app imports from one place: `import { ping } from
// "@/ipc/commands"`. Master contract architecture-design.md §1.1.
//
// APPEND POINT — each domain work item (W4–W17) adds EXACTLY ONE line below in
// the form `export * from "./<domain>";`. Do NOT edit another item's line; the
// integration master merges this file by concatenation. Keep alphabetical
// within the block for predictable diffs.

export * from "./error";
export * from "./fleet"; // W11
export * from "./health";
export * from "./cores"; // W5/W16
export * from "./library"; // W6/W13
export * from "./launch"; // W7
export * from "./metadata"; // W8
export * from "./search"; // W9/W17
export * from "./vibrancy"; // W10
export * from "./fleet"; // W11
export * from "./familiar"; // W12
// export * from "./settings";    // W4/W15
export * from "./controllers"; // W14
