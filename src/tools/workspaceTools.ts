import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

export type ToolName = "read_file" | "list_files" | "search_workspace" | "write_file";

export interface ToolActivity {
  tool: ToolName;
  path?: string;
  status: "started" | "completed" | "denied" | "failed";
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_RESULT_CHARS = 100_000;

export const TOOL_DEFINITIONS: Array<Record<string, unknown>> = [
  tool("read_file", "Read one UTF-8 text file from the current workspace.", {
    path: { type: "string", description: "Workspace-relative file path" },
  }, ["path"]),
  tool("list_files", "List files in the current workspace using an optional glob.", {
    pattern: { type: "string", description: "VS Code glob such as **/*.ts" },
  }, []),
  tool("search_workspace", "Search text files in the workspace for a literal query.", {
    query: { type: "string" },
    pattern: { type: "string", description: "Optional file glob" },
  }, ["query"]),
  tool("write_file", "Write a UTF-8 file after explicit user approval.", {
    path: { type: "string", description: "Workspace-relative file path" },
    content: { type: "string" },
  }, ["path", "content"]),
];

function tool(name: ToolName, description: string, properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false } };
}

export class WorkspaceTools {
  public constructor(
    private readonly root: string,
    private readonly activity: (event: ToolActivity) => void,
    private readonly approveWrite: (relativePath: string) => Promise<boolean>,
  ) {}

  public async execute(name: string, args: Record<string, unknown>): Promise<string> {
    if (!isToolName(name)) throw new Error("Unsupported tool requested.");
    const relativePath = typeof args.path === "string" ? args.path : undefined;
    this.activity({ tool: name, path: relativePath, status: "started" });
    try {
      let result: string;
      if (name === "read_file") result = await this.readFile(requireString(args, "path"));
      else if (name === "list_files") result = await this.listFiles(optionalString(args, "pattern") ?? "**/*");
      else if (name === "search_workspace") result = await this.search(requireString(args, "query"), optionalString(args, "pattern") ?? "**/*");
      else result = await this.writeFile(requireString(args, "path"), requireString(args, "content"));
      this.activity({ tool: name, path: relativePath, status: "completed" });
      return result;
    } catch (error) {
      this.activity({ tool: name, path: relativePath, status: error instanceof WriteDeniedError ? "denied" : "failed" });
      throw error;
    }
  }

  private async readFile(relativePath: string): Promise<string> {
    const target = await this.safeExistingPath(relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("File is not a supported text file or exceeds 1 MB.");
    return fs.readFile(target, "utf8");
  }

  private async listFiles(pattern: string): Promise<string> {
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, pattern), "**/{.git,node_modules,.venv,out}/**", 200);
    return uris.map((uri) => path.relative(this.root, uri.fsPath).replaceAll("\\", "/")).join("\n");
  }

  private async search(query: string, pattern: string): Promise<string> {
    if (!query || query.length > 500) throw new Error("Search query must contain 1-500 characters.");
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, pattern), "**/{.git,node_modules,.venv,out}/**", 200);
    const matches: string[] = [];
    for (const uri of uris) {
      const stat = await fs.stat(uri.fsPath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      let content: string;
      try { content = await fs.readFile(uri.fsPath, "utf8"); } catch { continue; }
      content.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(query) && matches.length < 200) {
          matches.push(`${path.relative(this.root, uri.fsPath).replaceAll("\\", "/")}:${index + 1}:${line}`);
        }
      });
      if (matches.join("\n").length >= MAX_RESULT_CHARS) break;
    }
    return matches.join("\n").slice(0, MAX_RESULT_CHARS);
  }

  private async writeFile(relativePath: string, content: string): Promise<string> {
    if (content.length > MAX_RESULT_CHARS) throw new Error("Write content exceeds 100,000 characters.");
    const target = await this.safeWritePath(relativePath);
    if (!(await this.approveWrite(relativePath))) throw new WriteDeniedError();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return `Wrote ${relativePath} (${content.length} characters).`;
  }

  private async safeExistingPath(relativePath: string): Promise<string> {
    const candidate = this.lexicallySafe(relativePath);
    const realRoot = await fs.realpath(this.root);
    const realTarget = await fs.realpath(candidate);
    if (!inside(realRoot, realTarget)) throw new Error("Path escapes the workspace.");
    return realTarget;
  }

  private async safeWritePath(relativePath: string): Promise<string> {
    const candidate = this.lexicallySafe(relativePath);
    let ancestor = path.dirname(candidate);
    while (true) {
      try {
        const realAncestor = await fs.realpath(ancestor);
        const realRoot = await fs.realpath(this.root);
        if (!inside(realRoot, realAncestor)) throw new Error("Path escapes the workspace.");
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error("No safe workspace ancestor found.");
        ancestor = parent;
      }
    }
  }

  private lexicallySafe(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) throw new Error("Tool paths must be workspace-relative.");
    const candidate = path.resolve(this.root, relativePath);
    if (!inside(path.resolve(this.root), candidate)) throw new Error("Path escapes the workspace.");
    return candidate;
  }
}

class WriteDeniedError extends Error {
  public constructor() { super("User denied the file write."); }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isToolName(value: string): value is ToolName {
  return ["read_file", "list_files", "search_workspace", "write_file"].includes(value);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`Tool argument ${key} must be a string.`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Tool argument ${key} must be a string.`);
  return value;
}
