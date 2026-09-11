import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const teamSource = path.resolve(here, "..");
const repoRoot = path.resolve(teamSource, "..");

async function copy(source, destination) {
  await fs.cp(source, destination, { recursive: true });
}

export async function buildRelease(outputPath = path.join(repoRoot, "releases", "takeout-operations-agent-team-v1.0.0.zip")) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "takeout-agent-team-"));
  const packageRoot = path.join(tempRoot, "takeout-operations-agent-team");
  try {
    await fs.mkdir(path.join(packageRoot, "skills"), { recursive: true });
    await Promise.all([
      copy(path.join(teamSource, ".codebuddy-plugin"), path.join(packageRoot, ".codebuddy-plugin")),
      copy(path.join(teamSource, "agents"), path.join(packageRoot, "agents")),
      copy(path.join(teamSource, "avatars"), path.join(packageRoot, "avatars")),
      copy(path.join(teamSource, "contracts"), path.join(packageRoot, "contracts")),
      copy(path.join(teamSource, "setting.json"), path.join(packageRoot, "setting.json")),
      copy(path.join(repoRoot, "skills", "takeout-business-review"), path.join(packageRoot, "skills", "takeout-business-review")),
      copy(path.join(repoRoot, "standalone-skills", "check-takeout-business-data"), path.join(packageRoot, "skills", "check-takeout-business-data")),
      copy(path.join(repoRoot, "standalone-skills", "identify-takeout-focus-stores"), path.join(packageRoot, "skills", "identify-takeout-focus-stores")),
      copy(path.join(teamSource, "skills", "propose-takeout-strategies"), path.join(packageRoot, "skills", "propose-takeout-strategies")),
      copy(path.join(teamSource, "skills", "audit-takeout-actions"), path.join(packageRoot, "skills", "audit-takeout-actions")),
    ]);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.rm(outputPath, { force: true });
    await execFileAsync("zip", ["-r", "-q", outputPath, path.basename(packageRoot)], { cwd: tempRoot });
    return outputPath;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  buildRelease(outputPath).then((result) => console.log(result)).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
