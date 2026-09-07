import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, "..", "references", "action-mapping-registry.json");
const conditionsPath = path.join(here, "..", "references", "action-conditions.json");
const prohibited = ["刷单", "虚假交易", "好评返券", "好评卡", "电话追评"];

const splitList = (value) => String(value ?? "").split(";").map((item) => item.trim()).filter(Boolean);

function evidenceGate(mapping, hit, inventory) {
  const required = splitList(mapping.required_evidence);
  if (mapping.system_evidence_sufficient === true) return { available: required, missing: [] };
  const scoped = inventory.filter((item) => item.brand_id === hit.brand_id && item.store_id === hit.store_id
    && ["已提供", "有效"].includes(item.status));
  const available = required.filter((name) => scoped.some((item) => item.evidence_name === name));
  return { available, missing: required.filter((name) => !available.includes(name)) };
}

function uniquePointers(...values) {
  return [...new Set(values.flatMap(splitList))].join(";");
}

export async function createActionLoop(input, registryOverride, conditionsOverride) {
  const registry = registryOverride || JSON.parse(await fs.readFile(registryPath, "utf8"));
  const conditions = conditionsOverride || JSON.parse(await fs.readFile(conditionsPath, "utf8"));
  const focusStores = (input.focus_stores || []).filter(s => s.attention_status === "重点关注");
  const hits = input.rule_hits || [];
  const evidenceInventory = input.evidence_inventory || [];
  const actionDecisions = input.action_decisions || [];
  const mappings = new Map(registry.map(m => [`${m.rule_id}|${m.focus_match}`, m]));
  const conditionMap = new Map(conditions.map((item) => [item.candidate_action_id, item]));
  const tasks = [];
  const skipped = [];
  for (const store of focusStores) {
    let storeHits = hits.filter(h => h.brand_id === store.brand_id && h.store_id === store.store_id);
    if (store.highest_priority === "数据阻断") storeHits = storeHits.filter(h => h.rule_id.startsWith("DQ-"));
    else storeHits = storeHits.filter(h => h.rule_id !== "PERF-001");
    const seenActions = new Set();
    for (const hit of storeHits) {
      const mapping = mappings.get(`${hit.rule_id}|${hit.focus_layer}`) || mappings.get(`${hit.rule_id}|*`);
      if (!mapping) {
        skipped.push({ brand_id: store.brand_id, store_id: store.store_id, rule_id: hit.rule_id, reason: "未配置安全动作映射" });
        continue;
      }
      if (seenActions.has(mapping.candidate_action_id)) continue;
      seenActions.add(mapping.candidate_action_id);
      const condition = conditionMap.get(mapping.candidate_action_id) || {};
      const actionDecision = actionDecisions.find((item) => item.brand_id === store.brand_id && item.store_id === store.store_id && item.candidate_action_id === mapping.candidate_action_id);
      if (actionDecision?.decision === "不适用") {
        skipped.push({ brand_id: store.brand_id, store_id: store.store_id, rule_id: hit.rule_id, candidate_action_id: mapping.candidate_action_id, reason: `人工确认不适用：${actionDecision.reason || condition.not_applicable_when || "未填写原因"}` });
        continue;
      }
      const applicabilityStatus = condition.rule_evidence_sufficient ? "规则已确认" : actionDecision?.decision === "适用" ? "已确认适用" : "待人工确认";
      const evidence = evidenceGate(mapping, hit, evidenceInventory);
      const taskState = mapping.initial_state === "待补数据" ? "待补数据" : evidence.missing.length ? "待补证据" : "待人工确认";
      const approval = taskState === "待人工确认" ? "待人工确认" : "待补证据";
      const task = {
        task_id: `TASK-C${String(tasks.length + 1).padStart(3, "0")}`,
        brand_id: store.brand_id,
        brand_name: store.brand_name,
        store_id: store.store_id,
        store_name: store.store_name,
        test_case_id: store.test_case_id,
        scope_type: hit.scope_type || "平台",
        platform_scope: hit.platform_scope || (hit.scope_type === "门店" ? "" : store.platforms),
        source_hit_id: hit.hit_id,
        parent_task_ids: hit.source_task_ids || "",
        rule_id: hit.rule_id,
        related_rule_ids: store.hit_rule_ids,
        problem_layer: hit.focus_layer,
        priority: hit.priority,
        candidate_action_id: mapping.candidate_action_id,
        task_title: mapping.task_title,
        task_detail: mapping.task_detail,
        task_state: taskState,
        applicability_status: applicabilityStatus,
        applicable_when: condition.applicable_when || "",
        not_applicable_when: condition.not_applicable_when || "",
        dependencies: condition.dependencies || "",
        state_reason: taskState === "待补数据" ? "数据质量问题未解除" : taskState === "待补证据" ? `执行前缺少证据：${evidence.missing.join("、")}` : "规则与证据足以进入人工确认",
        required_evidence: mapping.required_evidence,
        available_evidence: evidence.available.join(";"),
        missing_evidence: evidence.missing.join(";"),
        evidence_status: taskState === "待补数据" ? "待修复数据" : evidence.missing.length ? "不完整" : "完整",
        owner_role: mapping.owner_role,
        owner_name: "",
        approval_status: approval,
        confirmed_date: null,
        due_days: mapping.due_days,
        observation_period: mapping.observation_period,
        validation_metric: mapping.validation_metric,
        completion_evidence: "",
        validation_date: null,
        validation_status: "",
        validation_result: "",
        manual_review_required: true,
        source_pointer: uniquePointers(hit.source_pointer, mapping.source_pointer),
        source_rows: hit.source_rows,
        safety_boundary: mapping.safety_boundary,
        confidence: mapping.confidence,
      };
      const combined = `${task.task_title} ${task.task_detail}`;
      if (prohibited.some(term => combined.includes(term))) throw new Error(`PROHIBITED_ACTION_TEXT:${task.task_id}`);
      tasks.push(task);
    }
  }
  const states = [...new Set(tasks.map(t => t.task_state))];
  return {
    summary: {
      focus_store_count: focusStores.length,
      task_candidate_count: tasks.length,
      covered_store_count: new Set(tasks.map(t => `${t.brand_id}|${t.store_id}`)).size,
      manual_review_count: tasks.filter(t => t.manual_review_required).length,
      p0_task_count: tasks.filter(t => t.priority === "P0").length,
      data_repair_task_count: tasks.filter(t => t.priority === "数据阻断").length,
      by_state: Object.fromEntries(states.map(s => [s, tasks.filter(t => t.task_state === s).length])),
      skipped_count: skipped.length,
      pending_applicability_count: tasks.filter((task) => task.applicability_status === "待人工确认").length,
    },
    tasks,
    skipped,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: node create_action_loop.mjs input.json [output.json]");
  const outputPath = process.argv[3];
  const result = await createActionLoop(JSON.parse(await fs.readFile(inputPath, "utf8")));
  if (outputPath) await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary));
}
