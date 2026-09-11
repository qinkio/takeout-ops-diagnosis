import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAndCalculate } from "../../skills/takeout-business-review/scripts/validate_and_calculate.mjs";
import { executeRules } from "../../skills/takeout-business-review/scripts/execute_rules.mjs";
import { runTakeoutReview } from "../../skills/takeout-business-review/scripts/run_takeout_review.mjs";
import { proposeStrategies } from "../../workbuddy-team/skills/propose-takeout-strategies/scripts/propose_strategies.mjs";
import { auditTakeoutActions } from "../../workbuddy-team/skills/audit-takeout-actions/scripts/audit_actions.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const defaultPlatforms = ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"];

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== ""))];
}

function systemEvidenceFields(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.brand_id}|${row.store_id}`;
    if (!groups.has(key)) groups.set(key, { brand_id: row.brand_id, store_id: row.store_id, fields: new Set() });
    for (const [field, value] of Object.entries(row)) {
      if (value !== null && value !== undefined && value !== "") groups.get(key).fields.add(field);
    }
  }
  return [...groups.values()].map((item) => ({ ...item, fields: [...item.fields] }));
}

function modeDecision(input, validation, requestedMode = "auto") {
  const brands = unique(input.rows.map((row) => row.brand_id || row.brand_name));
  const stores = unique(input.rows.map((row) => `${row.brand_id || row.brand_name}|${row.store_id || row.store_name}`));
  const units = unique(input.rows.map((row) => `${row.brand_id || row.brand_name}|${row.store_id || row.store_name}|${row.platform}`));
  const reasons = [];
  if (stores.length >= 6) reasons.push(`门店数${stores.length}不少于6`);
  if (brands.length >= 2) reasons.push(`品牌数${brands.length}不少于2`);
  if (units.length > 15) reasons.push(`门店×平台单元${units.length}超过15`);
  if (validation.summary.blocking_issue_count > 0) reasons.push(`存在${validation.summary.blocking_issue_count}个数据阻断问题`);
  if (input.cross_store_comparison === true || input.cross_brand_comparison === true) reasons.push("用户要求跨店或跨品牌比较");

  const normalizedRequest = requestedMode === "single" ? "single_agent"
    : requestedMode === "multi" ? "multi_agent" : requestedMode;
  const forced = ["single_agent", "multi_agent"].includes(normalizedRequest);
  const mode = forced ? normalizedRequest : reasons.length ? "multi_agent" : "single_agent";
  return {
    requested_mode: requestedMode,
    selected_mode: mode,
    forced_by_user: forced,
    reasons: forced ? [`用户指定${mode === "multi_agent" ? "多 Agent 深度" : "轻量"}模式`] : reasons.length ? reasons : ["规模和复杂度未达到深度模式阈值"],
    metrics: {
      brand_count: brands.length,
      store_count: stores.length,
      store_platform_unit_count: units.length,
      blocking_issue_count: validation.summary.blocking_issue_count,
    },
  };
}

function handoff(id, runId, fromAgent, toAgent, taskScope, status, facts, evidenceRefs, constraints, nextInstruction, attempt = 0) {
  return {
    handoff_id: id,
    run_id: runId,
    from_agent: fromAgent,
    to_agent: toAgent,
    task_scope: taskScope,
    status,
    facts,
    evidence_refs: evidenceRefs,
    constraints,
    next_instruction: nextInstruction,
    attempt,
  };
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeDiagnosis(parts, issueCount) {
  const focusStores = parts.flatMap((part) => part.result.focus_stores);
  const ruleHits = parts.flatMap((part) => part.result.rule_hits);
  const brandMap = new Map();
  for (const store of focusStores) {
    if (!brandMap.has(store.brand_id)) {
      brandMap.set(store.brand_id, {
        brand_id: store.brand_id,
        brand_name: store.brand_name,
        store_count: 0,
        focus_store_count: 0,
        data_blocked_store_count: 0,
        p0_store_count: 0,
        platform_coverage_complete_count: 0,
        note: "品牌层仅做门店数量汇总，不生成品牌级原因结论",
      });
    }
    const brand = brandMap.get(store.brand_id);
    brand.store_count += 1;
    if (store.attention_status === "重点关注") brand.focus_store_count += 1;
    if (store.highest_priority === "数据阻断") brand.data_blocked_store_count += 1;
    if (store.highest_priority === "P0") brand.p0_store_count += 1;
    if (String(store.platform_coverage).startsWith("完整")) brand.platform_coverage_complete_count += 1;
  }
  return {
    summary: {
      brand_count: brandMap.size,
      store_count: focusStores.length,
      focus_store_count: focusStores.filter((store) => store.attention_status === "重点关注").length,
      rule_hit_count: ruleHits.length,
      p0_store_count: focusStores.filter((store) => store.highest_priority === "P0").length,
      data_blocked_store_count: focusStores.filter((store) => store.highest_priority === "数据阻断").length,
      input_issue_count: issueCount,
      diagnosis_work_unit_count: parts.length,
    },
    brand_rollup: [...brandMap.values()].sort((a, b) => String(a.brand_id).localeCompare(String(b.brand_id))),
    work_units: parts.map((part) => part.file),
    focus_stores: focusStores,
    rule_hits: ruleHits,
  };
}

async function diagnoseByStore(validation, expectedPlatforms, input, registry, outputDir) {
  const groups = new Map();
  for (const row of validation.rows) {
    const key = `${row.brand_id}|${row.store_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const unitDir = path.join(outputDir, "agent-02-diagnosis-units");
  await fs.mkdir(unitDir, { recursive: true });
  const parts = [];
  let index = 0;
  let hitIndex = 0;
  for (const [key, rows] of groups) {
    index += 1;
    const sourceRows = new Set(rows.map((row) => row.source_row));
    const issues = validation.issues.filter((issue) => issue.row_index === null || sourceRows.has(issue.row_index));
    const result = executeRules({
      rows,
      issues,
      expected_platforms: expectedPlatforms,
      tasks: (input.tasks || []).filter((task) => task.brand_id === rows[0].brand_id && task.store_id === rows[0].store_id),
      as_of_date: input.as_of_date,
    }, registry);
    result.rule_hits = result.rule_hits.map((hit) => ({
      ...hit,
      hit_id: `HIT-${String(++hitIndex).padStart(4, "0")}`,
    }));
    const file = `unit-${String(index).padStart(3, "0")}-${String(rows[0].brand_id)}-${String(rows[0].store_id)}.json`;
    await writeJson(path.join(unitDir, file), result);
    parts.push({ key, file: `agent-02-diagnosis-units/${file}`, rows, result });
  }
  return { diagnosis: mergeDiagnosis(parts, validation.issues.length), parts };
}

function reportMarkdown(runId, decision, validation, diagnosis, strategy, review) {
  const status = validation.summary.blocking_issue_count > 0 ? "数据阻断，未进入经营策略阶段"
    : review.summary.safety_rejected_count || review.summary.returned_count ? "存在退回或安全拒绝项，需要人工处理"
      : review.summary.pending_evidence_count ? `${review.summary.passed_pending_confirmation_count}项待人工确认，${review.summary.pending_evidence_count}项需先补证据`
        : `${review.summary.passed_pending_confirmation_count}项已审核，等待人工确认`;
  const hits = diagnosis?.rule_hits || [];
  const stores = (diagnosis?.focus_stores || []).filter((store) => store.attention_status === "重点关注")
    .map((store) => {
      const evidence = hits.filter((hit) => hit.brand_id === store.brand_id && hit.store_id === store.store_id)
        .map((hit) => `${hit.rule_name}（${hit.evidence_values}）`).join("；");
      return `- **${store.brand_name} / ${store.store_name}**：${store.highest_priority}，${store.primary_focus}；平台：${store.platforms}；证据：${evidence || "无可展示指标"}；来源行：${store.source_rows}`;
    })
    .join("\n") || "- 暂无可安全诊断的重点门店。";
  const proposals = (strategy?.proposals || []).map((proposal) =>
    `### ${proposal.priority} · ${proposal.brand_name} / ${proposal.store_name}\n\n- 事实：${proposal.fact}\n- 候选方案：${proposal.title}\n- 方案说明：${proposal.detail}\n- 当前状态：${proposal.proposal_status}\n- 待补证据：${proposal.missing_evidence || "无"}\n- 建议负责人：${proposal.owner_role}\n- 观察周期：${proposal.observation_period}\n- 验证指标：${proposal.validation_metric}\n- 来源：${proposal.source_pointer}；源行 ${proposal.source_rows}`)
    .join("\n\n") || "暂无候选策略。";
  const reviews = (review?.reviews || []).map((item) =>
    `- ${item.proposal_id}：**${item.result}**；${item.reasons.join("；")}`)
    .join("\n") || "- 未进入行动审核阶段。";
  const workUnitFiles = (diagnosis?.work_units || []).map((file) => `- ${file}`).join("\n") || "- 未生成逐门店诊断文件";
  return `# 连锁品牌深度诊断结果\n\n## 结论\n\n- 运行编号：${runId}\n- 模式：多 Agent 深度诊断\n- 选择原因：${decision.reasons.join("；")}\n- 当前状态：${status}\n- 数据阻断：${validation.summary.blocking_issue_count}\n- 重点门店：${diagnosis?.summary.focus_store_count || 0}\n- 候选策略：${strategy?.summary.proposal_count || 0}\n- 通过待人工确认：${review?.summary.passed_pending_confirmation_count || 0}\n- 待补证据：${review?.summary.pending_evidence_count || 0}\n- 退回策略 Agent：${review?.summary.returned_count || 0}\n- 安全拒绝：${review?.summary.safety_rejected_count || 0}\n\n## 重点门店与证据\n\n${stores}\n\n## 候选策略\n\n${proposals}\n\n## 行动审核\n\n${reviews}\n\n## 需要用户确认\n\n请先补齐标记为“待补证据”的材料；对“通过待人工确认”的任务确认是否适用、负责人和是否执行。系统不会替用户操作平台。\n\n## 已生成文件\n\n- mode-decision.json\n- agent-01-data-quality.json\n- agent-02-diagnosis.json\n${workUnitFiles}\n- agent-03-strategy.json\n- agent-04-action-review.json\n- collaboration-trace.json\n- final-result.json\n- final-report.md\n\n## 使用边界\n\n本结果不代表任何动作已经执行。涉及价格、活动、菜单、推广或顾客触达的动作，必须由有权限的人员确认并在平台内执行，执行后按约定指标验证。\n`;
}

export async function runMultiAgentReview(input, outputDir, requestedMode = "auto") {
  if (!input || !Array.isArray(input.rows)) throw new Error("输入必须包含 rows 数组");
  const expectedPlatforms = input.expected_platforms?.length ? input.expected_platforms : defaultPlatforms;
  const validation = validateAndCalculate({ rows: input.rows, expected_platforms: expectedPlatforms });
  const decision = modeDecision(input, validation, requestedMode);
  const runId = `TAKEOUT-${crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 12)}`;
  await fs.mkdir(outputDir, { recursive: true });
  await writeJson(path.join(outputDir, "mode-decision.json"), decision);

  if (decision.selected_mode === "single_agent") {
    const singleDir = path.join(outputDir, "single-agent-result");
    const result = await runTakeoutReview(input, singleDir);
    const trace = {
      run_id: runId,
      execution_model: "single_agent_with_deterministic_skills",
      selected_mode: "single_agent",
      agents: [{ agent_id: "takeout-operations-orchestrator", status: "completed", role: "轻量模式执行与汇总" }],
      handoffs: [],
      note: "本地运行器没有调用独立语言模型实例；WorkBuddy 专家团负责真实 Agent 调度。",
    };
    await writeJson(path.join(outputDir, "collaboration-trace.json"), trace);
    return { run_id: runId, mode: "single_agent", decision, result, output_dir: outputDir };
  }

  const scope = {
    brands: unique(input.rows.map((row) => String(row.brand_id || row.brand_name || ""))),
    stores: unique(input.rows.map((row) => String(row.store_id || row.store_name || ""))),
    platforms: unique(input.rows.map((row) => String(row.platform || ""))),
  };
  const agents = [
    { agent_id: "takeout-operations-orchestrator", role: "总控与汇总", status: "running" },
    { agent_id: "takeout-data-quality-specialist", role: "数据质量", status: "completed" },
    { agent_id: "takeout-store-diagnosis-specialist", role: "门店诊断", status: "pending" },
    { agent_id: "takeout-strategy-specialist", role: "策略方案", status: "pending" },
    { agent_id: "takeout-action-review-specialist", role: "行动审核", status: "pending" },
  ];
  const handoffs = [handoff("H-001", runId, "takeout-operations-orchestrator", "takeout-data-quality-specialist", scope,
    "assigned", [{ row_count: input.rows.length }], ["normalized-input"], ["不得归因或生成策略"], "校验全量数据并返回可分析范围")];
  await writeJson(path.join(outputDir, "agent-01-data-quality.json"), validation);

  if (validation.summary.blocking_issue_count > 0) {
    agents[0].status = "blocked";
    agents[2].status = "skipped";
    agents[3].status = "skipped";
    agents[4].status = "skipped";
    handoffs.push(handoff("H-002", runId, "takeout-data-quality-specialist", "takeout-operations-orchestrator", scope,
      "blocked", validation.issues, ["agent-01-data-quality.json"], ["阻断解除前不得生成经营动作"], "向用户返回数据修复要求"));
    const trace = {
      run_id: runId,
      execution_model: "role_separated_deterministic_orchestration",
      selected_mode: "multi_agent",
      agents,
      handoffs,
      note: "本地运行器验证角色协议；独立语言模型成员由 WorkBuddy 专家团调度。",
    };
    await writeJson(path.join(outputDir, "collaboration-trace.json"), trace);
    await fs.writeFile(path.join(outputDir, "final-report.md"), reportMarkdown(runId, decision, validation, null, null, null), "utf8");
    return { run_id: runId, mode: "multi_agent", status: "blocked_by_data", decision, validation: validation.summary, output_dir: outputDir };
  }

  const registry = JSON.parse(await fs.readFile(path.join(repoRoot, "skills/takeout-business-review/references/rule-registry.json"), "utf8"));
  const { diagnosis, parts: diagnosisParts } = await diagnoseByStore(validation, expectedPlatforms, input, registry, outputDir);
  diagnosisParts.forEach((part, index) => {
    const first = part.rows[0];
    handoffs.push(handoff(`H-002-${String(index + 1).padStart(3, "0")}`, runId,
      "takeout-data-quality-specialist", "takeout-store-diagnosis-specialist", {
        brands: [String(first.brand_id || first.brand_name || "")],
        stores: [String(first.store_id || first.store_name || "")],
        platforms: unique(part.rows.map((row) => String(row.platform || ""))),
      }, "accepted", [{ row_count: part.rows.length, comparable_row_count: part.rows.filter((row) => row.comparison.status === "可比").length }],
      ["agent-01-data-quality.json", part.file], ["按品牌—门店隔离，门店内保留平台维度"], "定位该门店的问题层"));
  });
  agents[2].status = "completed";
  await writeJson(path.join(outputDir, "agent-02-diagnosis.json"), diagnosis);

  handoffs.push(handoff("H-003", runId, "takeout-store-diagnosis-specialist", "takeout-strategy-specialist", scope,
    "accepted", diagnosis.rule_hits, ["agent-02-diagnosis.json"], ["只根据已核验事实匹配动作库"], "生成候选策略"));
  const strategyInput = {
    focus_stores: diagnosis.focus_stores,
    rule_hits: diagnosis.rule_hits,
    evidence_inventory: input.evidence_inventory || [],
    action_decisions: input.action_decisions || [],
    new_strategy_ideas: input.new_strategy_ideas || [],
    system_evidence_fields: systemEvidenceFields(validation.rows),
  };
  let strategy = await proposeStrategies(strategyInput);
  agents[3].status = "completed";

  handoffs.push(handoff("H-004", runId, "takeout-strategy-specialist", "takeout-action-review-specialist", scope,
    "accepted", strategy.proposals, ["agent-03-strategy.json", "agent-02-diagnosis.json"], ["审核结果不可被总控覆盖"],
    "审核证据、安全、审批与任务完整性"));
  let review = auditTakeoutActions({ proposals: strategy.proposals, rule_hits: diagnosis.rule_hits, attempt: 0 });
  let retryPerformed = false;
  if (review.summary.requires_strategy_retry) {
    retryPerformed = true;
    await Promise.all([
      writeJson(path.join(outputDir, "agent-03-strategy-attempt-0.json"), strategy),
      writeJson(path.join(outputDir, "agent-04-action-review-attempt-0.json"), review),
    ]);
    handoffs.push(handoff("H-005", runId, "takeout-action-review-specialist", "takeout-operations-orchestrator", scope,
      "returned", review.reviews, ["agent-04-action-review-attempt-0.json"], ["总控不得覆盖退回结果"], "将字段级原因退回策略 Agent", 0));
    handoffs.push(handoff("H-006", runId, "takeout-operations-orchestrator", "takeout-strategy-specialist", scope,
      "retry_assigned", review.reviews.filter((item) => item.result === "退回策略Agent"), ["agent-04-action-review-attempt-0.json"],
      ["仅允许本次自动修正"], "根据退回原因重新生成候选策略", 1));
    strategy = await proposeStrategies({ ...strategyInput, review_feedback: review.reviews });
    handoffs.push(handoff("H-007", runId, "takeout-strategy-specialist", "takeout-action-review-specialist", scope,
      "retry_submitted", strategy.proposals, ["agent-03-strategy-attempt-1.json"], ["不得进行第二次自动修正"], "执行最终审核", 1));
    review = auditTakeoutActions({ proposals: strategy.proposals, rule_hits: diagnosis.rule_hits, attempt: 1 });
    await writeJson(path.join(outputDir, "agent-03-strategy-attempt-1.json"), strategy);
    handoffs.push(handoff("H-008", runId, "takeout-action-review-specialist", "takeout-operations-orchestrator", scope,
      review.summary.returned_count ? "returned_to_user" : review.summary.safety_rejected_count ? "rejected" : "accepted",
      review.reviews, ["agent-04-action-review.json"], ["不得再次自动重试"], "生成报告并将未通过项交给用户", 1));
    agents[3].status = "completed_after_retry";
  } else {
    handoffs.push(handoff("H-005", runId, "takeout-action-review-specialist", "takeout-operations-orchestrator", scope,
      review.summary.safety_rejected_count ? "rejected" : review.summary.pending_evidence_count ? "restricted" : "accepted",
      review.reviews, ["agent-04-action-review.json"], ["总控只能汇总，不得覆盖审核结果"],
      review.summary.safety_rejected_count ? "向用户展示安全拒绝原因" : "生成用户报告并等待补证或人工确认"));
  }
  agents[4].status = "completed";
  agents[0].status = review.summary.returned_count || review.summary.safety_rejected_count ? "needs_attention"
    : review.summary.pending_evidence_count ? "completed_with_pending_evidence" : "completed";
  await Promise.all([
    writeJson(path.join(outputDir, "agent-03-strategy.json"), strategy),
    writeJson(path.join(outputDir, "agent-04-action-review.json"), review),
  ]);
  const trace = {
    run_id: runId,
    execution_model: "role_separated_deterministic_orchestration",
    selected_mode: "multi_agent",
    agents,
    handoffs,
    retry_policy: { max_strategy_retries: 1, retry_performed: retryPerformed, still_returned: review.summary.returned_count > 0 },
    note: "本地运行器没有调用五个独立语言模型实例；WorkBuddy 专家团负责真实 Agent 调度。",
  };
  const finalResult = {
    run_id: runId,
    decision,
    validation: validation.summary,
    diagnosis: diagnosis.summary,
    strategy: strategy.summary,
    review: review.summary,
    tasks: review.tasks,
  };
  await Promise.all([
    writeJson(path.join(outputDir, "collaboration-trace.json"), trace),
    writeJson(path.join(outputDir, "final-result.json"), finalResult),
    fs.writeFile(path.join(outputDir, "final-report.md"), reportMarkdown(runId, decision, validation, diagnosis, strategy, review), "utf8"),
  ]);
  return { run_id: runId, mode: "multi_agent", status: agents[0].status, decision, review: review.summary, output_dir: outputDir };
}

async function main() {
  const inputPath = arg("--input");
  const outputDir = arg("--output-dir");
  const mode = arg("--mode") || "auto";
  if (!inputPath || !outputDir) throw new Error("Usage: node run_multi_agent_review.mjs --input input.json --output-dir results [--mode auto|single|multi]");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  console.log(JSON.stringify(await runMultiAgentReview(input, outputDir, mode)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
