import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const prohibited = ["刷单", "虚假交易", "好评返券", "好评卡", "电话追评", "自动改价", "自动修改活动", "自动联系顾客"];
const forbiddenStates = new Set(["执行中", "已执行", "已闭环"]);

function reviewProposal(proposal, hitMap) {
  const text = `${proposal.title || ""} ${proposal.detail || ""}`;
  const safetyTerms = prohibited.filter((term) => text.includes(term));
  if (safetyTerms.length) {
    return { result: "安全拒绝", reasons: [`包含禁止或越权动作：${safetyTerms.join("、")}`], correction_required: false };
  }
  if (forbiddenStates.has(proposal.proposal_status) || proposal.human_review_required !== true) {
    return { result: "安全拒绝", reasons: ["候选策略绕过人工确认或被写成执行结果"], correction_required: false };
  }

  const hit = hitMap.get(proposal.source_hit_id);
  const reasons = [];
  if (!hit) reasons.push("source_hit_id: 找不到对应诊断命中");
  if (hit && hit.brand_id !== proposal.brand_id) reasons.push("brand_id: 与诊断命中不一致");
  if (hit && hit.store_id !== proposal.store_id) reasons.push("store_id: 与诊断命中不一致");
  if (!proposal.source_rows && proposal.source_rows !== 0) reasons.push("source_rows: 缺少来源行");
  if (!proposal.source_pointer) reasons.push("source_pointer: 缺少规则或方法来源");
  if (!proposal.validation_metric) reasons.push("validation_metric: 缺少验证指标");
  if (!proposal.observation_period) reasons.push("observation_period: 缺少观察周期");
  if (reasons.length) return { result: "退回策略Agent", reasons, correction_required: true };

  if (proposal.proposal_status === "待修复数据") {
    return { result: "待补证据", reasons: ["数据质量阻断尚未解除"], correction_required: false };
  }
  if (String(proposal.missing_evidence || "").trim()) {
    return { result: "待补证据", reasons: [`执行前缺少证据：${proposal.missing_evidence}`], correction_required: false };
  }
  return { result: "通过待人工确认", reasons: ["来源、范围、证据与验证字段已通过审核"], correction_required: false };
}

export function auditTakeoutActions(input) {
  const proposals = input.proposals || [];
  const hitMap = new Map((input.rule_hits || []).map((hit) => [hit.hit_id, hit]));
  const attempt = Number(input.attempt || 0);
  if (attempt < 0 || attempt > 1) throw new Error("attempt 必须是0或1；自动修正最多一次");

  const reviews = proposals.map((proposal, index) => {
    const decision = reviewProposal(proposal, hitMap);
    return {
      review_id: `REVIEW-${String(index + 1).padStart(3, "0")}`,
      proposal_id: proposal.proposal_id,
      brand_id: proposal.brand_id,
      store_id: proposal.store_id,
      source_hit_id: proposal.source_hit_id,
      attempt,
      ...decision,
    };
  });

  const tasks = proposals.flatMap((proposal, index) => {
    const review = reviews[index];
    if (["安全拒绝", "退回策略Agent"].includes(review.result)) return [];
    const taskState = review.result === "通过待人工确认" ? "待人工确认"
      : proposal.proposal_status === "待修复数据" ? "待补数据" : "待补证据";
    return [{
      task_id: `TASK-MA-${String(index + 1).padStart(3, "0")}`,
      proposal_id: proposal.proposal_id,
      brand_id: proposal.brand_id,
      brand_name: proposal.brand_name,
      store_id: proposal.store_id,
      store_name: proposal.store_name,
      platform_scope: proposal.platform_scope,
      priority: proposal.priority,
      task_title: proposal.title,
      task_detail: proposal.detail,
      task_state: taskState,
      review_result: review.result,
      review_reasons: review.reasons.join(";"),
      owner_role: proposal.owner_role,
      owner_name: "",
      approval_status: review.result === "通过待人工确认" ? "待人工确认" : "待补证据",
      due_days: proposal.due_days,
      observation_period: proposal.observation_period,
      validation_metric: proposal.validation_metric,
      required_evidence: proposal.required_evidence,
      missing_evidence: proposal.missing_evidence,
      source_pointer: proposal.source_pointer,
      source_rows: proposal.source_rows,
      completion_evidence: "",
      validation_result: "",
      manual_review_required: true,
    }];
  });

  const count = (result) => reviews.filter((item) => item.result === result).length;
  return {
    summary: {
      proposal_count: proposals.length,
      passed_pending_confirmation_count: count("通过待人工确认"),
      pending_evidence_count: count("待补证据"),
      returned_count: count("退回策略Agent"),
      safety_rejected_count: count("安全拒绝"),
      task_count: tasks.length,
      requires_strategy_retry: attempt === 0 && count("退回策略Agent") > 0,
    },
    reviews,
    tasks,
  };
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) throw new Error("Usage: node audit_actions.mjs input.json output.json");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = auditTakeoutActions(input);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result.summary));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
