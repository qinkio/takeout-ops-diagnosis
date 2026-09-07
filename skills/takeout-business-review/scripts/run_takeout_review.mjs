import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAndCalculate } from "./validate_and_calculate.mjs";
import { executeRules } from "./execute_rules.mjs";
import { createActionLoop } from "./create_action_loop.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceDir = path.join(here, "..", "references");
const DEFAULT_PLATFORMS = ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"];

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  if (!rows.length) return "\uFEFF";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${headers.map(csvEscape).join(",")}\n${rows.map((row) => headers.map((key) => csvEscape(row[key])).join(",")).join("\n")}\n`;
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summaryMarkdown(validation, diagnosis, actionLoop) {
  const blocking = validation.summary.blocking_issue_count;
  const warning = validation.summary.warning_count;
  const taskEvidence = actionLoop.tasks.filter((task) => task.evidence_status !== "完整").length;
  const status = blocking ? "存在数据阻断，经营诊断仅保留安全范围" : "数据已完成校验，可查看经营诊断";
  return `# 外卖经营复盘摘要

## 结论

- 分析状态：${status}
- 数据行数：${validation.summary.row_count}
- 阻断问题：${blocking}
- 警告问题：${warning}
- 品牌数量：${diagnosis.summary.brand_count}
- 门店数量：${diagnosis.summary.store_count}
- 重点门店：${diagnosis.summary.focus_store_count}
- P0门店：${diagnosis.summary.p0_store_count}
- 规则命中：${diagnosis.summary.rule_hit_count}
- 候选任务：${actionLoop.summary.task_candidate_count}
- 待补证据任务：${taskEvidence}
- 待确认适用性：${actionLoop.summary.pending_applicability_count}

## 使用边界

候选任务不等于自动执行。请先核对适用性和证据，再填写负责人并人工确认；没有完成证据和验证结果时，不得标记为已闭环。
`;
}

export async function runTakeoutReview(input, outputDir) {
  if (!input || !Array.isArray(input.rows)) throw new Error("输入必须是对象并包含 rows 数组");
  const expectedPlatforms = Array.isArray(input.expected_platforms) && input.expected_platforms.length ? input.expected_platforms : DEFAULT_PLATFORMS;
  const validation = validateAndCalculate({ rows: input.rows, expected_platforms: expectedPlatforms });
  const registry = JSON.parse(await fs.readFile(path.join(referenceDir, "rule-registry.json"), "utf8"));
  const diagnosis = executeRules({
    rows: validation.rows,
    issues: validation.issues,
    expected_platforms: expectedPlatforms,
    tasks: input.tasks || [],
    as_of_date: input.as_of_date,
  }, registry);
  const actionLoop = await createActionLoop({
    focus_stores: diagnosis.focus_stores,
    rule_hits: diagnosis.rule_hits,
    evidence_inventory: input.evidence_inventory || [],
    action_decisions: input.action_decisions || [],
  });

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(outputDir, "validation.json"), validation),
    writeJson(path.join(outputDir, "diagnosis.json"), diagnosis),
    writeJson(path.join(outputDir, "action-loop.json"), actionLoop),
    fs.writeFile(path.join(outputDir, "data-issues.csv"), csv(validation.issues), "utf8"),
    fs.writeFile(path.join(outputDir, "focus-stores.csv"), csv(diagnosis.focus_stores), "utf8"),
    fs.writeFile(path.join(outputDir, "rule-hits.csv"), csv(diagnosis.rule_hits), "utf8"),
    fs.writeFile(path.join(outputDir, "task-candidates.csv"), csv(actionLoop.tasks), "utf8"),
    fs.writeFile(path.join(outputDir, "summary.md"), summaryMarkdown(validation, diagnosis, actionLoop), "utf8"),
  ]);

  return {
    status: validation.summary.blocking_issue_count ? "blocked" : "ready",
    validation: validation.summary,
    diagnosis: diagnosis.summary,
    action_loop: actionLoop.summary,
    output_dir: outputDir,
  };
}

async function main() {
  const inputPath = arg("--input");
  const outputDir = arg("--output-dir");
  if (!inputPath || !outputDir) throw new Error("Usage: node run_takeout_review.mjs --input normalized-input.json --output-dir result-directory");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  console.log(JSON.stringify(await runTakeoutReview(input, outputDir)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
