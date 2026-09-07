import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const platforms = ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"];
const periods = [
  { id: "2026-W30", start: "2026-07-20", end: "2026-07-26" },
  { id: "2026-W31", start: "2026-07-27", end: "2026-08-02" },
  { id: "2026-W32", start: "2026-08-03", end: "2026-08-09" },
];
const stores = [
  { brand_id: "B001", brand_name: "青禾轻食", store_id: "S001", store_name: "青禾轻食·湖畔店", pattern: "stable" },
  { brand_id: "B001", brand_name: "青禾轻食", store_id: "S002", store_name: "青禾轻食·云谷店", pattern: "decline" },
  { brand_id: "B002", brand_name: "山海小馆", store_id: "S003", store_name: "山海小馆·新城店", pattern: "exposure" },
];

const platformFactor = { "美团外卖": 1, "淘宝闪购（饿了么）": 0.82, "京东外卖": 0.72 };
const rows = [];
let sourceRow = 2;

for (const store of stores) {
  for (const platform of platforms) {
    for (let index = 0; index < periods.length; index += 1) {
      const p = periods[index];
      const pf = platformFactor[platform];
      const trend = store.pattern === "decline" ? [1, 0.86, 0.72][index] : [1, 1.03, 1.06][index];
      const exposureTrend = store.pattern === "exposure" ? [1, 0.8, 0.62][index] : trend;
      const baseIncome = store.store_id === "S002" ? 4400 : store.store_id === "S003" ? 3200 : 3600;
      const income = Math.round(baseIncome * pf * trend);
      const orders = Math.max(1, Math.round(income / 36));
      const exposure = Math.round(6200 * pf * exposureTrend);
      const newCustomers = Math.round(orders * 0.58);
      const returningCustomers = orders - newCustomers;
      const totalReviews = Math.max(12, Math.round(orders * 0.2));

      rows.push({
        ...store,
        pattern: undefined,
        platform,
        period_id: p.id,
        period_start: p.start,
        period_end: p.end,
        data_availability: "正常",
        zero_value_meaning: "不适用",
        order_total_amount: Number((income * 1.55).toFixed(2)),
        customer_paid_amount: Number((income * 1.22).toFixed(2)),
        estimated_order_income: income,
        valid_orders: orders,
        merchant_subsidy: Number((income * 0.33).toFixed(2)),
        exposure_users: exposure,
        store_entry_rate: store.pattern === "exposure" ? [0.14, 0.14, 0.139][index] : 0.14,
        order_conversion_rate: store.pattern === "decline" ? [0.086, 0.078, 0.069][index] : 0.086,
        new_customers: newCustomers,
        returning_customers: returningCustomers,
        store_rating: store.pattern === "decline" && index === 2 ? 4.55 : 4.78,
        merchant_fault_cancellations: store.pattern === "decline" && index === 2 ? 2 : 0,
        total_reviews: totalReviews,
        neutral_negative_reviews: store.pattern === "decline" && index === 2 ? 3 : 1,
        source_row: sourceRow,
      });
      sourceRow += 1;
    }
  }
}

const cleanRows = rows.map(({ pattern, ...row }) => row);
const data = {
  expected_platforms: platforms,
  as_of_date: "2026-08-10",
  rows: cleanRows,
  tasks: [],
  evidence_inventory: [],
  action_decisions: [],
  demo_notice: "全部品牌、门店、周期和指标均为合成演示数据",
};

await fs.writeFile(path.join(here, "synthetic-input.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`generated ${cleanRows.length} synthetic rows`);
