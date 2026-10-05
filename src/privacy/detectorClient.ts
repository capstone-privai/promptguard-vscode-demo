import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";
import { Detector, Detection } from "./types";

export class CredSweeperDetector implements Detector {
  public readonly displayName = "CredSweeper";

  public constructor(
    private readonly extensionPath: string,
    private readonly configuredPython = "",
    private readonly timeoutMs = 15_000,
  ) {}

  public scan(text: string, source: string): Promise<Detection[]> {
    return new Promise((resolve, reject) => {
      const python = this.configuredPython || path.join(this.extensionPath, ".venv", "Scripts", "python.exe");
      const adapter = path.join(this.extensionPath, "python", "detector_adapter.py");
      const child = spawn(python, [adapter], { cwd: this.extensionPath, windowsHide: true });
      this.collect(child, text, source, resolve, reject);
    });
  }

  private collect(
    child: ChildProcessWithoutNullStreams,
    text: string,
    source: string,
    resolve: (detections: Detection[]) => void,
    reject: (error: Error) => void,
  ): void {
    let stdout = "";
    let stderrSeen = false;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Local secret detector timed out; request blocked."));
    }, this.timeoutMs);
    const finish = (error?: Error, detections?: Detection[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(detections ?? []);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", () => { stderrSeen = true; });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 5_000_000) {
        child.kill();
        finish(new Error("Local detector response exceeded the safety limit; request blocked."));
      }
    });
    child.on("error", () => finish(new Error("Local secret detector could not start; request blocked.")));
    child.on("close", (code) => {
      if (code !== 0 || stderrSeen) {
        finish(new Error("Local secret detector failed; request blocked."));
        return;
      }
      try {
        const payload = JSON.parse(stdout) as { detections?: Detection[] };
        if (!Array.isArray(payload.detections)) throw new Error("invalid response");
        finish(undefined, payload.detections);
      } catch {
        finish(new Error("Local detector returned an invalid response; request blocked."));
      }
    });
    child.stdin.end(JSON.stringify({ text, source }));
  }
}
