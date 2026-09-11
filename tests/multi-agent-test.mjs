import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMultiAgentReview } from "../multi-agent/scripts/run_multi_agent_review.mjs";
import { auditTakeoutActions } from "../workbuddy-team/skills/audit-takeout-actions/scripts/audit_actions.mjs";
import { proposeStrategies } from "../workbuddy-team/skills/propose-takeout-strategies/scripts/propose_strategies.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = JSON.parse(await fs.readFile(path.join(repoRoot, "examples", "synthetic-input.json"), "utf8"));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "takeout-multi-agent-test-"));

function pngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

try {
  const multiDir = path.join(tempRoot, "multi");
  const multi = await runMultiAgentReview(demo, multiDir, "auto");
  assert.equal(multi.mode, "multi_agent");
  assert.ok(multi.decision.reasons.some((reason) => reason.includes("品牌数2")));
  const trace = JSON.parse(await fs.readFile(path.join(multiDir, "collaboration-trace.json"), "utf8"));
  assert.equal(trace.agents.length, 5);
  assert.ok(trace.handoffs.length >= 7);
  const handoffSchema = JSON.parse(await fs.readFile(path.join(repoRoot, "workbuddy-team", "contracts", "handoff-contract.schema.json"), "utf8"));
  assert.ok(trace.handoffs.every((item) => handoffSchema.properties.status.enum.includes(item.status)));
  assert.equal(trace.execution_model, "role_separated_deterministic_orchestration");
  assert.ok(trace.note.includes("没有调用五个独立语言模型实例"));
  const diagnosisHandoffs = trace.handoffs.filter((item) => item.handoff_id.startsWith("H-002-"));
  assert.equal(diagnosisHandoffs.length, 3);
  assert.ok(diagnosisHandoffs.every((item) => item.task_scope.stores.length === 1));
  const finalResult = JSON.parse(await fs.readFile(path.join(multiDir, "final-result.json"), "utf8"));
  assert.equal(finalResult.review.returned_count, 0);
  assert.equal(finalResult.review.safety_rejected_count, 0);
  assert.ok(finalResult.tasks.every((task) => task.manual_review_required === true));
  const finalReport = await fs.readFile(path.join(multiDir, "final-report.md"), "utf8");
  assert.ok(finalReport.includes("青禾轻食·云谷店"));
  assert.ok(finalReport.includes("待补证据"));
  assert.ok(finalReport.includes("验证指标"));
  assert.ok(finalReport.includes("4400→3784→3168"));
  assert.ok(finalReport.includes("agent-02-diagnosis-units/unit-001-B001-S001.json"));
  assert.ok(finalReport.includes("agent-02-diagnosis-units/unit-003-B002-S003.json"));
  assert.ok(!finalReport.includes("拆解连续下滑的订单与收入客单贡献"));
  const diagnosis = JSON.parse(await fs.readFile(path.join(multiDir, "agent-02-diagnosis.json"), "utf8"));
  const unitFiles = await fs.readdir(path.join(multiDir, "agent-02-diagnosis-units"));
  const unitHits = (await Promise.all(unitFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(multiDir, "agent-02-diagnosis-units", file), "utf8")))))
    .flatMap((unit) => unit.rule_hits.map((hit) => hit.hit_id));
  assert.equal(new Set(unitHits).size, unitHits.length);
  assert.deepEqual(unitHits.sort(), diagnosis.rule_hits.map((hit) => hit.hit_id).sort());
  const strategy = JSON.parse(await fs.readFile(path.join(multiDir, "agent-03-strategy.json"), "utf8"));
  const trendProposal = strategy.proposals.find((proposal) => proposal.rule_id === "TREND-001");
  assert.ok(trendProposal.available_evidence.includes("订单侧诊断结论"));
  assert.ok(trendProposal.available_evidence.includes("曝光变化"));
  assert.ok(!trendProposal.missing_evidence.includes("订单侧诊断结论"));

  const firstStore = demo.rows[0].store_id;
  const singleInput = { ...demo, rows: demo.rows.filter((row) => row.store_id === firstStore) };
  const single = await runMultiAgentReview(singleInput, path.join(tempRoot, "single"), "auto");
  assert.equal(single.mode, "single_agent");
  assert.equal(single.decision.metrics.store_count, 1);

  const invalidInput = structuredClone(singleInput);
  invalidInput.rows.push({ ...invalidInput.rows[0], source_row: 999 });
  const blockedDir = path.join(tempRoot, "blocked");
  const blocked = await runMultiAgentReview(invalidInput, blockedDir, "auto");
  assert.equal(blocked.status, "blocked_by_data");
  const blockedTrace = JSON.parse(await fs.readFile(path.join(blockedDir, "collaboration-trace.json"), "utf8"));
  assert.equal(blockedTrace.agents.find((agent) => agent.agent_id === "takeout-strategy-specialist").status, "skipped");

  const badProposal = {
    proposal_id: "PROPOSAL-X",
    brand_id: "B1",
    store_id: "S1",
    source_hit_id: "HIT-X",
    title: "自动改价并电话追评",
    detail: "无需审批",
    proposal_status: "待审核",
    human_review_required: true,
  };
  const rejected = auditTakeoutActions({ proposals: [badProposal], rule_hits: [], attempt: 0 });
  assert.equal(rejected.reviews[0].result, "安全拒绝");
  assert.equal(rejected.tasks.length, 0);

  const returned = auditTakeoutActions({ proposals: [{ ...badProposal, title: "检查菜单结构", detail: "仅提出候选动作" }], rule_hits: [], attempt: 0 });
  assert.equal(returned.reviews[0].result, "退回策略Agent");
  assert.equal(returned.summary.requires_strategy_retry, true);
  assert.throws(() => auditTakeoutActions({ proposals: [], rule_hits: [], attempt: 2 }), /最多一次/);

  const baseRegistry = JSON.parse(await fs.readFile(path.join(repoRoot, "workbuddy-team", "skills", "propose-takeout-strategies", "references", "action-mapping-registry.json"), "utf8"));
  const malformedRegistry = baseRegistry.map((item) => item.rule_id === "TREND-001" ? { ...item, validation_metric: "" } : item);
  const firstAttempt = await proposeStrategies({ focus_stores: diagnosis.focus_stores, rule_hits: diagnosis.rule_hits }, malformedRegistry);
  assert.equal(firstAttempt.proposals[0].validation_metric, "");
  const firstReview = auditTakeoutActions({ proposals: firstAttempt.proposals, rule_hits: diagnosis.rule_hits, attempt: 0 });
  assert.equal(firstReview.reviews[0].result, "退回策略Agent");
  const revised = await proposeStrategies({
    focus_stores: diagnosis.focus_stores,
    rule_hits: diagnosis.rule_hits,
    review_feedback: firstReview.reviews,
  }, malformedRegistry);
  assert.equal(revised.proposals[0].revision.review_id, "REVIEW-001");
  assert.ok(revised.proposals[0].revision.repaired_fields.includes("validation_metric"));
  assert.equal(revised.proposals[0].revision.unresolved_fields.length, 0);
  assert.ok(revised.proposals[0].validation_metric.includes("estimated_order_income"));
  const finalReview = auditTakeoutActions({ proposals: revised.proposals, rule_hits: diagnosis.rule_hits, attempt: 1 });
  assert.notEqual(finalReview.reviews[0].result, "退回策略Agent");

  const plugin = JSON.parse(await fs.readFile(path.join(repoRoot, "workbuddy-team", ".codebuddy-plugin", "plugin.json"), "utf8"));
  assert.equal(plugin.expertType, "team");
  assert.equal(plugin.teamInfo.memberAgents.length, 4);
  assert.equal(plugin.members.filter((member) => member.role === "lead").length, 1);
  assert.equal(plugin.members.filter((member) => member.role === "member").length, 4);
  for (const member of plugin.members) {
    const avatar = await fs.readFile(path.join(repoRoot, "workbuddy-team", member.avatar));
    assert.deepEqual(pngSize(avatar), { width: 512, height: 512 });
    assert.ok(avatar.length <= 500 * 1024, `${member.avatar} 必须不超过500KB`);
  }

  console.log("multi-agent checks passed: routing, 5 roles, blocking, audit, retry cap, avatars");
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
