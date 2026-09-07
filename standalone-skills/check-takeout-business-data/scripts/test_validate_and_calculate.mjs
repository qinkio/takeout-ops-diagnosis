import assert from "node:assert/strict";
import { validateAndCalculate } from "./validate_and_calculate.mjs";

const base = {
  brand_id: "B001", brand_name: "测试品牌", store_id: "S001", store_name: "测试门店", platform: "美团", period_id: "2026-W31",
  period_start: "2026-07-27", period_end: "2026-08-02", data_availability: "正常", zero_value_meaning: "不适用",
  order_total_amount: 4800, customer_paid_amount: 4000, estimated_order_income: 3600,
  valid_orders: 100, merchant_subsidy: 400, exposure_users: 7000,
  new_customers: 60, returning_customers: 40, total_reviews: 20, neutral_negative_reviews: 1,
};

const normal = validateAndCalculate([base]);
assert.equal(normal.summary.blocking_issue_count, 0);
assert.equal(normal.rows[0].calculated.avg_paid_aov, 40);
assert.equal(normal.rows[0].calculated.avg_daily_exposure, 1000);
assert.equal(normal.rows[0].calculated.neutral_negative_rate, 0.05);

const zero = validateAndCalculate([{ ...base, valid_orders: 0 }]);
assert(zero.issues.some((x) => x.code === "ZERO_MEANING_MISSING"));
assert.equal(zero.rows[0].calculated.avg_paid_aov, null);

const duplicate = validateAndCalculate([base, { ...base }]);
assert(duplicate.issues.some((x) => x.code === "DUPLICATE_GRAIN"));

const mismatch = validateAndCalculate([
  base,
  { ...base, platform: "饿了么", period_start: "2026-07-28", period_end: "2026-08-03" },
]);
assert(mismatch.issues.some((x) => x.code === "PERIOD_MISMATCH"));

const coverage = validateAndCalculate({ rows: [base], expected_platforms: ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"] });
assert.equal(coverage.summary.platform_coverage_issue_count, 1);
assert(coverage.issues.find((x) => x.code === "PLATFORM_COVERAGE_MISSING").message.includes("京东外卖"));

const crossBrand = validateAndCalculate([base, { ...base, brand_id: "B002", brand_name: "另一品牌" }]);
assert(!crossBrand.issues.some((x) => x.code === "DUPLICATE_GRAIN"));

const trendRows = [
  { ...base, period_id: "2026-W31", estimated_order_income: 4000 },
  { ...base, period_id: "2026-W32", period_start: "2026-08-03", period_end: "2026-08-09", estimated_order_income: 3500 },
  { ...base, period_id: "2026-W33", period_start: "2026-08-10", period_end: "2026-08-16", estimated_order_income: 3000 },
];
const trend = validateAndCalculate(trendRows);
assert.equal(trend.rows.find((x) => x.period_id === "2026-W33").comparison.continuous_decline_trigger, true);

const unequalPeriods = validateAndCalculate([
  base,
  { ...base, period_id: "2026-W32", period_start: "2026-08-03", period_end: "2026-08-16", estimated_order_income: 3000 },
]);
assert.equal(unequalPeriods.rows[1].comparison.status, "不可比");
assert(unequalPeriods.issues.some((x) => x.code === "PERIOD_LENGTH_MISMATCH"));

const overlappingPeriods = validateAndCalculate([
  base,
  { ...base, period_id: "2026-W32", period_start: "2026-08-01", period_end: "2026-08-07", estimated_order_income: 3000 },
]);
assert.equal(overlappingPeriods.rows[1].comparison.status, "不可比");
assert(overlappingPeriods.issues.some((x) => x.code === "PERIOD_OVERLAP"));

const zigzag = validateAndCalculate([
  { ...base, period_id: "2026-W31", estimated_order_income: 4000 },
  { ...base, period_id: "2026-W32", period_start: "2026-08-03", period_end: "2026-08-09", estimated_order_income: 4500 },
  { ...base, period_id: "2026-W33", period_start: "2026-08-10", period_end: "2026-08-16", estimated_order_income: 3000 },
]);
assert.equal(zigzag.rows[2].comparison.continuous_decline_trigger, false);

console.log("12 deterministic checks passed");
