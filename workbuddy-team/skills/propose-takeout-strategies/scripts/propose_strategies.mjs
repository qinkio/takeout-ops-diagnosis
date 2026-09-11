import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, "..", "references", "action-mapping-registry.json");
const conditionsPath = path.join(here, "..", "references", "action-conditions.json");
const prohibited = ["刷单", "虚假交易", "好评返券", "好评卡", "电话追评"];

const splitList = (value) => String(value ?? "").split(";").map((item) => item.trim()).filter(Boolean);

const systemEvidenceNames = {
  "曝光变化": "exposure_users",
  "进店转化变化": "store_entry_rate",
  "下单转化变化": "order_conversion_rate",
};

function evidenceFor(mapping, hit, inventory, storeHits, systemEvidenceFields) {
  const required = splitList(mapping.required_evidence);
  if (mapping.system_evidence_sufficient === true) return { available: required, missing: [] };
  const scoped = inventory.filter((item) => item.brand_id === hit.brand_id && item.store_id === hit.store_id
    && ["已提供", "有效"].includes(item.status));
  const systemFields = new Set(systemEvidenceFields
    .filter((item) => item.brand_id === hit.brand_id && item.store_id === hit.store_id)
    .flatMap((item) => item.fields || []));
  const available = required.filter((name) => scoped.some((item) => item.evidence_name === name)
    || (name === "订单侧诊断结论" && storeHits.some((item) => item.focus_layer === "订单侧"))
    || systemFields.has(systemEvidenceNames[name]));
  return { available, missing: required.filter((name) => !available.includes(name)) };
}

function uniquePointers(...values) {
  return [...new Set(values.flatMap(splitList))].join(";");
}

function applyReviewFeedback(proposal, feedback, hit, mapping) {
  if (!feedback) return proposal;
  const requestedFields = (feedback.reasons || []).map((reason) => String(reason).split(":")[0].trim()).filter(Boolean);
  const repairs = {
    source_hit_id: () => hit.hit_id,
    brand_id: () => hit.brand_id,
    store_id: () => hit.store_id,
    source_rows: () => hit.source_rows,
    source_pointer: () => uniquePointers(hit.source_pointer, mapping.source_pointer),
    validation_metric: () => mapping.validation_metric || splitList(hit.evidence_fields).join(";"),
    observation_period: () => mapping.observation_period || "待人工确认后设定",
    human_review_required: () => true,
  };
  const repairedFields = [];
  const unresolvedFields = [];
  for (const field of requestedFields) {
    const repaired = repairs[field]?.();
    if (repaired !== undefined && repaired !== null && repaired !== "") {
      proposal[field] = repaired;
      repairedFields.push(field);
    } else {
      unresolvedFields.push(field);
    }
  }
  proposal.revision = {
    attempt: 1,
    review_id: feedback.review_id,
    return_reasons: feedback.reasons || [],
    repaired_fields: repairedFields,
    unresolved_fields: unresolvedFields,
    method: "依据审核字段级反馈，从已核验诊断与动作库恢复缺失字段",
  };
  return proposal;
}

export async function proposeStrategies(input, registryOverride, conditionsOverride) {
  const registry = registryOverride || JSON.parse(await fs.readFile(registryPath, "utf8"));
  const conditions = conditionsOverride || JSON.parse(await fs.readFile(conditionsPath, "utf8"));
  const focusStores = (input.focus_stores || []).filter((store) => store.attention_status === "重点关注");
  const hits = input.rule_hits || [];
  const evidenceInventory = input.evidence_inventory || [];
  const systemEvidenceFields = input.system_evidence_fields || [];
  const decisions = input.action_decisions || [];
  const feedbackByProposal = new Map((input.review_feedback || [])
    .filter((item) => item.result === "退回策略Agent")
    .map((item) => [item.proposal_id, item]));
  const mappings = new Map(registry.map((item) => [`${item.rule_id}|${item.focus_match}`, item]));
  const conditionMap = new Map(conditions.map((item) => [item.candidate_action_id, item]));
  const proposals = [];
  const skipped = [];

  for (const store of focusStores) {
    const allStoreHits = hits.filter((hit) => hit.brand_id === store.brand_id && hit.store_id === store.store_id);
    let storeHits = allStoreHits;
    storeHits = store.highest_priority === "数据阻断"
      ? storeHits.filter((hit) => hit.rule_id.startsWith("DQ-"))
      : storeHits.filter((hit) => hit.rule_id !== "PERF-001");
    const seenActions = new Set();

    for (const hit of storeHits) {
      const mapping = mappings.get(`${hit.rule_id}|${hit.focus_layer}`) || mappings.get(`${hit.rule_id}|*`);
      if (!mapping) {
        skipped.push({ brand_id: store.brand_id, store_id: store.store_id, rule_id: hit.rule_id, reason: "未配置已审核动作映射" });
        continue;
      }
      if (seenActions.has(mapping.candidate_action_id)) continue;
      seenActions.add(mapping.candidate_action_id);
      const decision = decisions.find((item) => item.brand_id === store.brand_id && item.store_id === store.store_id
        && item.candidate_action_id === mapping.candidate_action_id);
      if (decision?.decision === "不适用") {
        skipped.push({ brand_id: store.brand_id, store_id: store.store_id, rule_id: hit.rule_id,
          candidate_action_id: mapping.candidate_action_id, reason: `人工确认不适用：${decision.reason || "未填写原因"}` });
        continue;
      }

      const condition = conditionMap.get(mapping.candidate_action_id) || {};
      const evidence = evidenceFor(mapping, hit, evidenceInventory, allStoreHits, systemEvidenceFields);
      const proposalStatus = mapping.initial_state === "待补数据" ? "待修复数据" : evidence.missing.length ? "待补证据" : "待审核";
      const proposal = {
        proposal_id: `PROPOSAL-${String(proposals.length + 1).padStart(3, "0")}`,
        brand_id: store.brand_id,
        brand_name: store.brand_name,
        store_id: store.store_id,
        store_name: store.store_name,
        scope_type: hit.scope_type || "平台",
        platform_scope: hit.platform_scope || store.platforms,
        source_hit_id: hit.hit_id,
        rule_id: hit.rule_id,
        problem_layer: hit.focus_layer,
        priority: hit.priority,
        fact: hit.fact,
        candidate_action_id: mapping.candidate_action_id,
        title: mapping.task_title,
        detail: mapping.task_detail,
        proposal_status: proposalStatus,
        applicable_when: condition.applicable_when || "",
        not_applicable_when: condition.not_applicable_when || "",
        dependencies: condition.dependencies || "",
        required_evidence: mapping.required_evidence,
        available_evidence: evidence.available.join(";"),
        missing_evidence: evidence.missing.join(";"),
        owner_role: mapping.owner_role,
        due_days: mapping.due_days,
        observation_period: mapping.observation_period,
        validation_metric: mapping.validation_metric,
        source_pointer: uniquePointers(hit.source_pointer, mapping.source_pointer),
        source_rows: hit.source_rows,
        confidence: mapping.confidence,
        safety_boundary: mapping.safety_boundary,
        human_review_required: true,
      };
      applyReviewFeedback(proposal, feedbackByProposal.get(proposal.proposal_id), hit, mapping);
      const text = `${proposal.title} ${proposal.detail}`;
      if (prohibited.some((term) => text.includes(term))) throw new Error(`PROHIBITED_ACTION_TEXT:${proposal.proposal_id}`);
      proposals.push(proposal);
    }
  }

  const unreviewedIdeas = (input.new_strategy_ideas || []).map((idea, index) => ({
    idea_id: `IDEA-${String(index + 1).padStart(3, "0")}`,
    ...idea,
    status: "待审核新策略",
    eligible_for_task: false,
  }));

  return {
    summary: {
      focus_store_count: focusStores.length,
      proposal_count: proposals.length,
      pending_evidence_count: proposals.filter((item) => item.proposal_status === "待补证据").length,
      data_repair_count: proposals.filter((item) => item.proposal_status === "待修复数据").length,
      skipped_count: skipped.length,
      unreviewed_idea_count: unreviewedIdeas.length,
    },
    proposals,
    skipped,
    unreviewed_ideas: unreviewedIdeas,
  };
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) throw new Error("Usage: node propose_strategies.mjs input.json output.json");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = await proposeStrategies(input);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result.summary));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
