import assert from "node:assert/strict";
import { createActionLoop } from "./create_action_loop.mjs";

const stores = [
  ["S1","数据阻断","DQ-002","数据质量"], ["S2","P0","TREND-001","连续下滑"],
  ["S3","P1","FUNNEL-001","曝光层"], ["S4","P1","FUNNEL-001","下单转化层"],
  ["S5","P2","CUSTOMER-001","新客侧"], ["S6","P1","SERVICE-001","评分与服务"],
  ["S7","P1","PLATFORM-001","跨平台"], ["S8","P1","TASK-001","任务闭环"],
];
const focus_stores = stores.map(([id,p,rule,focus]) => ({brand_id:"B1",brand_name:"品牌",store_id:id,store_name:id,test_case_id:id,platforms:"美团外卖;淘宝闪购（饿了么）;京东外卖",attention_status:"重点关注",highest_priority:p,hit_rule_ids:rule,primary_focus:focus}));
const rule_hits = stores.map(([id,p,rule,focus],i) => ({hit_id:`H${i+1}`,brand_id:"B1",store_id:id,scope_type:rule==="TASK-001"?"门店":"平台",platform_scope:rule==="TASK-001"?"":"美团外卖;淘宝闪购（饿了么）;京东外卖",source_task_ids:rule==="TASK-001"?"OLD-01":"",rule_id:rule,focus_layer:focus,priority:p,fact:"事实",source_pointer:"测试来源",source_rows:String(i+5)}));
rule_hits.push({hit_id:"HX",brand_id:"B1",store_id:"S1",rule_id:"SERVICE-001",focus_layer:"评分与服务",priority:"P1",source_rows:"99"});
const result = await createActionLoop({focus_stores,rule_hits});
assert.equal(result.summary.focus_store_count, 8);
assert.equal(result.summary.covered_store_count, 8);
assert.equal(result.tasks.filter(t => t.store_id === "S1").length, 1, "data block must suppress operating tasks");
assert.equal(result.tasks.find(t => t.store_id === "S2").candidate_action_id, "ACT-PERF-01");
assert.equal(result.tasks.find(t => t.store_id === "S3").candidate_action_id, "ACT-FLOW-02");
assert.equal(result.tasks.find(t => t.store_id === "S4").candidate_action_id, "ACT-ORDER-01");
assert.equal(result.tasks.find(t => t.store_id === "S5").candidate_action_id, "ACT-NEW-01");
assert.equal(result.tasks.find(t => t.store_id === "S6").candidate_action_id, "ACT-SVC-01");
assert.equal(result.tasks.find(t => t.store_id === "S7").candidate_action_id, "ACT-PLATFORM-01");
assert.equal(result.tasks.find(t => t.store_id === "S8").candidate_action_id, "ACT-TASK-01");
assert.ok(result.tasks.every(t => t.manual_review_required));
assert.equal(new Set(result.tasks.map(t => t.task_id)).size, result.tasks.length);
assert.ok(result.tasks.every(t => t.source_rows && t.source_pointer));
assert.ok(result.tasks.every(t => !/(刷单|虚假交易|好评返券|电话追评)/.test(`${t.task_title}${t.task_detail}`)));
assert.equal(result.tasks.find(t => t.store_id === "S8").parent_task_ids, "OLD-01");
assert.equal(result.tasks.find(t => t.store_id === "S8").scope_type, "门店");
assert.equal(result.tasks.find(t => t.store_id === "S3").evidence_status, "不完整");
assert(result.tasks.find(t => t.store_id === "S3").missing_evidence.includes("营业状态"));

const evidenceResult = await createActionLoop({
  focus_stores: focus_stores.filter((x) => x.store_id === "S3"),
  rule_hits: rule_hits.filter((x) => x.store_id === "S3"),
  evidence_inventory: ["营业状态", "活动台账", "推广配置", "平台资源记录"].map((evidence_name) => ({ brand_id:"B1", store_id:"S3", evidence_name, status:"已提供" })),
});
assert.equal(evidenceResult.tasks[0].evidence_status, "完整");
assert.equal(evidenceResult.tasks[0].task_state, "待人工确认");

const notApplicable = await createActionLoop({
  focus_stores: focus_stores.filter((x) => x.store_id === "S3"),
  rule_hits: rule_hits.filter((x) => x.store_id === "S3"),
  action_decisions: [{ brand_id:"B1", store_id:"S3", candidate_action_id:"ACT-FLOW-02", decision:"不适用", reason:"周期内没有推广或资源位计划" }],
});
assert.equal(notApplicable.tasks.length, 0);
assert.equal(notApplicable.skipped[0].candidate_action_id, "ACT-FLOW-02");
assert(notApplicable.skipped[0].reason.includes("周期内没有推广"));
assert.equal(result.tasks.find((t) => t.store_id === "S3").applicability_status, "待人工确认");
assert.equal(result.tasks.find((t) => t.store_id === "S2").applicability_status, "规则已确认");

console.log("24 action-loop safety, evidence, applicability, lineage, and mapping checks passed");
