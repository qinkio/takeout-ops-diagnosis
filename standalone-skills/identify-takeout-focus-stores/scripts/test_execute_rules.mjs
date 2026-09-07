import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { executeRules } from "./execute_rules.mjs";

const registry = JSON.parse(await fs.readFile(new URL("../references/rule-registry.json", import.meta.url), "utf8"));
const periods = ["2026-08-03", "2026-08-10", "2026-08-17"];

function rowsFor({ brand = "B01", store = "S01", platform, incomes }) {
  return incomes.map((income, index) => ({
    brand_id: brand, brand_name: `品牌${brand}`, store_id: store, store_name: `门店${store}`,
    platform, canonical_platform: platform, period_id: `2026-W${32 + index}`, period_start: periods[index], period_end: periods[index],
    data_availability: "正常", zero_value_meaning: "不适用", estimated_order_income: income,
    valid_orders: 100, order_total_amount: 4500, customer_paid_amount: 4000, exposure_users: 5000,
    store_entry_rate: 0.12, order_conversion_rate: 0.08, new_customers: 55, returning_customers: 45,
    store_rating: 4.8, total_reviews: 30, merchant_fault_cancellations: 0,
    calculated: { avg_income_aov: income / 100 }, source_row: index + 5,
  }));
}

const rows = [
  ...rowsFor({ platform: "美团外卖", incomes: [3600, 3200, 2800] }),
  ...rowsFor({ platform: "淘宝闪购（饿了么）", incomes: [2200, 2400, 2700] }),
  ...rowsFor({ platform: "京东外卖", incomes: [1800, 1700, 1600] }),
  ...rowsFor({ brand: "B02", store: "S01", platform: "美团外卖", incomes: [2000, 2010, 2020] }),
  ...rowsFor({ brand: "B02", store: "S01", platform: "淘宝闪购（饿了么）", incomes: [1500, 1505, 1510] }),
  ...rowsFor({ brand: "B02", store: "S01", platform: "京东外卖", incomes: [900, 905, 910] }),
];

const result = executeRules({ rows, tasks: [], issues: [], as_of_date: "2026-08-30", expected_platforms: ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"] }, registry);
assert.equal(result.summary.brand_count, 2);
assert.equal(result.summary.store_count, 2);
assert(result.rule_hits.some((x) => x.brand_id === "B01" && x.rule_id === "PLATFORM-001"));
assert(!result.rule_hits.some((x) => x.brand_id === "B02" && x.rule_id === "PLATFORM-001"));
assert.equal(result.focus_stores.find((x) => x.brand_id === "B01").platform_count, 3);
assert.equal(result.brand_rollup.find((x) => x.brand_id === "B01").store_count, 1);

const partialCoverage = executeRules({
  rows: [
    ...rowsFor({ platform: "美团外卖", incomes: [3600, 3200, 2800] }),
    ...rowsFor({ platform: "京东外卖", incomes: [1800, 2000, 2200] }),
  ], tasks: [], issues: [], as_of_date: "2026-08-30",
  expected_platforms: ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"],
}, registry);
assert(partialCoverage.rule_hits.some((x) => x.rule_id === "DQ-003"));
assert(!partialCoverage.rule_hits.some((x) => x.rule_id === "PLATFORM-001"));

const sharedStoreRows = [
  ...rowsFor({ brand: "B01", store: "SAME", platform: "美团外卖", incomes: [2000, 2000, 2000] }),
  ...rowsFor({ brand: "B02", store: "SAME", platform: "美团外卖", incomes: [2000, 2000, 2000] }),
];
const taskIsolation = executeRules({
  rows: sharedStoreRows,
  tasks: [{ brand_id: "B01", store_id: "SAME", task_id: "OLD-01", due_date: "2026-08-01", status: "进行中", validation_result: "" }],
  issues: [], as_of_date: "2026-08-30", expected_platforms: ["美团外卖"],
}, registry);
const taskHits = taskIsolation.rule_hits.filter((x) => x.rule_id === "TASK-001");
assert.deepEqual(taskHits.map((x) => x.brand_id), ["B01"]);
assert.equal(taskHits[0].source_task_ids, "OLD-01");

const unequalPeriodRows = rowsFor({ brand: "B03", store: "UNEQUAL", platform: "美团外卖", incomes: [4000, 3500, 3000] });
unequalPeriodRows[1].period_end = "2026-08-16";
const unequalPeriods = executeRules({ rows: unequalPeriodRows, tasks: [], issues: [], as_of_date: "2026-08-30", expected_platforms: ["美团外卖"] }, registry);
assert(unequalPeriods.rule_hits.some((x) => x.rule_id === "DQ-003" && x.priority === "数据阻断"));
assert(!unequalPeriods.rule_hits.some((x) => ["TREND-001", "FUNNEL-001", "CUSTOMER-001", "SERVICE-001", "PERF-001"].includes(x.rule_id)));

const overlappingRows = rowsFor({ brand: "B03", store: "OVERLAP", platform: "美团外卖", incomes: [4000, 3500, 3000] });
overlappingRows[1].period_start = "2026-08-03";
overlappingRows[1].period_end = "2026-08-10";
const overlapResult = executeRules({ rows: overlappingRows, tasks: [], issues: [], as_of_date: "2026-08-30", expected_platforms: ["美团外卖"] }, registry);
assert(overlapResult.rule_hits.some((x) => x.rule_id === "DQ-003" && x.fact.includes("重叠")));
assert(!overlapResult.rule_hits.some((x) => x.rule_id === "TREND-001"));

const mixedFunnelRows = [
  ...rowsFor({ brand: "B04", store: "MIXED", platform: "美团外卖", incomes: [3000, 2800, 2600] }).map((row, index) => ({ ...row, exposure_users: [5000, 3500, 2400][index] })),
  ...rowsFor({ brand: "B04", store: "MIXED", platform: "京东外卖", incomes: [1800, 1700, 1600] }).map((row, index) => ({ ...row, order_conversion_rate: [0.1, 0.07, 0.04][index] })),
];
const mixedFunnel = executeRules({ rows: mixedFunnelRows, tasks: [], issues: [], as_of_date: "2026-08-30", expected_platforms: ["美团外卖", "京东外卖"] }, registry);
const funnelHits = mixedFunnel.rule_hits.filter((x) => x.rule_id === "FUNNEL-001");
assert.deepEqual(new Set(funnelHits.map((x) => x.focus_layer)), new Set(["曝光层", "下单转化层"]));
assert(funnelHits.every((x) => !x.platform_scope.includes(";")));

console.log("19 multi-brand, three-platform, and boundary rule checks passed");
