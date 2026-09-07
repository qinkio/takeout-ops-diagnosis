import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTakeoutReview } from "../skills/takeout-business-review/scripts/run_takeout_review.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = JSON.parse(await fs.readFile(path.join(root, ".codebuddy-plugin/plugin.json"), "utf8"));
assert.equal(plugin.name, "takeout-business-review-expert");
assert.equal(plugin.version, "1.0.3");
assert.equal(plugin.plugin, plugin.name);
assert.equal(plugin.agentName, "takeout-business-review-expert");
assert.equal(plugin.avatar, "avatars/expert.png");
assert.ok((await fs.stat(path.join(root, plugin.avatar))).size <= 500000);
for (const relative of [...plugin.agents, ...plugin.skills, plugin.avatar]) await fs.access(path.join(root, relative));

const fixture = JSON.parse(await fs.readFile(path.join(root, "examples/synthetic-input.json"), "utf8"));
assert.equal(fixture.rows.length, 27);
assert.equal(new Set(fixture.rows.map((row) => row.brand_id)).size, 2);
assert.equal(new Set(fixture.rows.map((row) => row.store_id)).size, 3);
assert.equal(new Set(fixture.rows.map((row) => row.platform)).size, 3);

const output = await fs.mkdtemp(path.join(os.tmpdir(), "takeout-review-public-"));
const result = await runTakeoutReview(fixture, output);
assert.equal(result.status, "ready");
assert.equal(result.validation.row_count, 27);
assert.equal(result.diagnosis.brand_count, 2);
assert.equal(result.diagnosis.store_count, 3);
assert.ok(result.diagnosis.focus_store_count >= 1);
assert.ok(result.action_loop.task_candidate_count >= 1);

for (const file of ["summary.md", "data-issues.csv", "focus-stores.csv", "rule-hits.csv", "task-candidates.csv", "validation.json", "diagnosis.json", "action-loop.json"]) {
  await fs.access(path.join(output, file));
}

const actionLoop = JSON.parse(await fs.readFile(path.join(output, "action-loop.json"), "utf8"));
const actionText = actionLoop.tasks.map((task) => `${task.task_title} ${task.task_detail}`).join("\n");
for (const prohibited of ["刷单", "虚假交易", "好评返券", "好评卡", "电话追评"]) assert.ok(!actionText.includes(prohibited));

console.log(`public smoke test passed: ${fixture.rows.length} rows, ${result.diagnosis.focus_store_count} focus stores, ${result.action_loop.task_candidate_count} candidate tasks`);
