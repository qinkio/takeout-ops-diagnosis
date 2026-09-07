import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED = [
  "brand_id", "brand_name", "store_id", "store_name", "platform", "period_id", "period_start", "period_end",
  "data_availability", "zero_value_meaning",
];
const CORE_NUMBERS = [
  "order_total_amount", "customer_paid_amount", "estimated_order_income",
  "valid_orders", "merchant_subsidy", "exposure_users",
  "new_customers", "returning_customers", "total_reviews", "neutral_negative_reviews",
];
const ZERO_SENSITIVE = ["order_total_amount", "valid_orders", "estimated_order_income", "exposure_users"];
const ZERO_MEANINGS = new Set(["实际0", "新店", "缺失导出", "未知"]);

function blank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function numberOrNull(value) {
  if (blank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value) {
  if (blank(value)) return null;
  if (typeof value === "number" && value > 20000 && value < 100000) {
    const excelDate = new Date((value - 25569) * 86400000);
    return Number.isNaN(excelDate.getTime()) ? null : excelDate;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ratio(numerator, denominator) {
  const n = numberOrNull(numerator);
  const d = numberOrNull(denominator);
  return n === null || d === null || d <= 0 ? null : n / d;
}

function change(current, previous) {
  const c = numberOrNull(current);
  const p = numberOrNull(previous);
  return c === null || p === null || p <= 0 ? null : (c - p) / p;
}

function inclusiveDays(start, end) {
  const s = dateOrNull(start);
  const e = dateOrNull(end);
  if (!s || !e || e < s) return null;
  return Math.floor((e - s) / 86400000) + 1;
}

function issue(code, level, rowIndex, message, fields = []) {
  return { code, level, row_index: rowIndex, message, fields };
}

function canonicalPlatform(value) {
  const platform = String(value ?? "").trim();
  if (["美团", "美团外卖"].includes(platform)) return "美团外卖";
  if (["饿了么", "淘宝闪购", "淘宝闪购（饿了么）"].includes(platform)) return "淘宝闪购（饿了么）";
  if (["京东", "京东外卖"].includes(platform)) return "京东外卖";
  return platform;
}

export function validateAndCalculate(inputRows) {
  const rows = Array.isArray(inputRows) ? inputRows : inputRows?.rows;
  const expectedPlatforms = (Array.isArray(inputRows) ? [] : inputRows?.expected_platforms ?? []).map(canonicalPlatform);
  if (!Array.isArray(rows)) throw new Error("Input must be an array or an object with rows[].");

  const issues = [];
  const seen = new Map();
  const outputRows = rows.map((source, index) => {
    const rowIndex = source.source_row ?? index + 2;
    for (const field of REQUIRED) {
      if (blank(source[field])) issues.push(issue("REQUIRED_FIELD_MISSING", "blocking", rowIndex, `必填字段 ${field} 缺失`, [field]));
    }
    for (const field of CORE_NUMBERS) {
      if (!blank(source[field]) && numberOrNull(source[field]) === null) issues.push(issue("INVALID_NUMBER", "blocking", rowIndex, `${field} 不是有效数字`, [field]));
    }

    const platform = canonicalPlatform(source.platform);
    const key = `${source.brand_id ?? ""}|${source.store_id ?? ""}|${platform}|${source.period_id ?? ""}`;
    if (seen.has(key)) {
      issues.push(issue("DUPLICATE_GRAIN", "blocking", rowIndex, `与第 ${seen.get(key)} 行的品牌、门店、平台、周期重复`, ["brand_id", "store_id", "platform", "period_id"]));
    } else {
      seen.set(key, rowIndex);
    }

    const days = inclusiveDays(source.period_start, source.period_end);
    if (days === null) issues.push(issue("INVALID_PERIOD", "blocking", rowIndex, "周期日期无效或结束日早于开始日", ["period_start", "period_end"]));
    if (source.data_availability !== "正常") issues.push(issue("DATA_UNAVAILABLE", "blocking", rowIndex, `数据可用状态为 ${source.data_availability || "空"}`, ["data_availability"]));
    const hasCoreZero = ZERO_SENSITIVE.some((field) => numberOrNull(source[field]) === 0);
    if (hasCoreZero && !ZERO_MEANINGS.has(String(source.zero_value_meaning ?? "").trim())) {
      issues.push(issue("ZERO_MEANING_MISSING", "blocking", rowIndex, "核心指标存在0值，但未说明0值含义", ["zero_value_meaning"]));
    }
    if (hasCoreZero && ["未知", "缺失导出", "新店"].includes(String(source.zero_value_meaning ?? "").trim())) {
      issues.push(issue("ZERO_MEANING_UNRESOLVED", "blocking", rowIndex, `0值含义为${source.zero_value_meaning}，暂不允许周期比较`, ["zero_value_meaning"]));
    }

    const customerTotal = (numberOrNull(source.new_customers) ?? 0) + (numberOrNull(source.returning_customers) ?? 0);
    const calculated = {
      merchant_subsidy_rate: ratio(source.merchant_subsidy, source.order_total_amount),
      avg_original_aov: ratio(source.order_total_amount, source.valid_orders),
      avg_paid_aov: ratio(source.customer_paid_amount, source.valid_orders),
      avg_income_aov: ratio(source.estimated_order_income, source.valid_orders),
      avg_daily_exposure: days ? ratio(source.exposure_users, days) : null,
      new_customer_share: ratio(source.new_customers, customerTotal),
      returning_customer_share: ratio(source.returning_customers, customerTotal),
      neutral_negative_rate: ratio(source.neutral_negative_reviews, source.total_reviews),
    };

    return {
      ...source,
      canonical_platform: platform,
      row_key: key,
      calculated,
      comparison: { status: "未评估", reason: "无上期或尚未排序" },
      trace: { source_fields: [...REQUIRED, ...CORE_NUMBERS], calculation_version: "validation-v2" },
    };
  });

  const groups = new Map();
  for (const row of outputRows) {
    const groupKey = `${row.brand_id ?? ""}|${row.store_id ?? ""}|${row.canonical_platform ?? ""}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => (dateOrNull(a.period_start)?.getTime() ?? 0) - (dateOrNull(b.period_start)?.getTime() ?? 0));
    for (let i = 1; i < group.length; i += 1) {
      const previous = group[i - 1];
      const current = group[i];
      if (previous.data_availability !== "正常" || current.data_availability !== "正常") {
        current.comparison = { status: "不可比", reason: "当期或上期数据状态非正常" };
        continue;
      }
      const previousEnd = dateOrNull(previous.period_end);
      const currentStart = dateOrNull(current.period_start);
      if (previousEnd && currentStart && currentStart <= previousEnd) {
        current.comparison = { status: "不可比", reason: "当前周期与上一周期日期重叠" };
        issues.push(issue("PERIOD_OVERLAP", "blocking", current.source_row ?? null, "当前周期与上一周期日期重叠，禁止计算环比", ["period_start", "period_end"]));
        continue;
      }
      const previousDays = inclusiveDays(previous.period_start, previous.period_end);
      const currentDays = inclusiveDays(current.period_start, current.period_end);
      if (previousDays === null || currentDays === null || previousDays !== currentDays) {
        current.comparison = { status: "不可比", reason: "当期与上期周期长度不一致" };
        issues.push(issue("PERIOD_LENGTH_MISMATCH", "blocking", current.source_row ?? null, `当期${currentDays ?? "未知"}天、上期${previousDays ?? "未知"}天，禁止直接计算环比`, ["period_start", "period_end"]));
        continue;
      }
      const income = change(current.estimated_order_income, previous.estimated_order_income);
      const orders = change(current.valid_orders, previous.valid_orders);
      const aov = change(current.calculated.avg_income_aov, previous.calculated.avg_income_aov);
      if (income === null || orders === null || aov === null) {
        current.comparison = { status: "不可比", reason: "基期为0或关键值缺失" };
        issues.push(issue("BASE_NOT_COMPARABLE", "warning", current.source_row ?? null, "基期为0或关键值缺失，不返回环比", ["estimated_order_income", "valid_orders"]));
      } else {
        current.comparison = { status: "可比", previous_period_id: previous.period_id, income_change: income, valid_orders_change: orders, paid_aov_change: aov };
      }
    }
    if (group.length >= 3) {
      for (let i = 2; i < group.length; i += 1) {
        const window = group.slice(i - 2, i + 1);
        const values = window.map((row) => numberOrNull(row.estimated_order_income));
        const lengths = window.map((row) => inclusiveDays(row.period_start, row.period_end));
        const third = window[2];
        third.comparison.continuous_decline_trigger = window.every((row) => row.data_availability === "正常")
          && values.every((value) => value !== null)
          && lengths.every((days) => days !== null && days === lengths[0])
          && values[0] > 2500
          && values[0] > values[1]
          && values[1] > values[2]
          && values[2] <= values[0] * 0.8;
      }
    }
  }

  const periods = new Map();
  for (const row of outputRows) {
    const key = `${row.brand_id ?? ""}|${row.store_id ?? ""}|${row.period_id ?? ""}`;
    const sig = `${row.period_start ?? ""}|${row.period_end ?? ""}`;
    if (!periods.has(key)) periods.set(key, new Set());
    periods.get(key).add(sig);
  }
  for (const [key, signatures] of periods) {
    if (signatures.size > 1) issues.push(issue("PERIOD_MISMATCH", "blocking", null, `门店周期 ${key} 在不同平台的日期范围不一致`, ["period_start", "period_end"]));
  }

  if (expectedPlatforms.length) {
    const coverage = new Map();
    for (const row of outputRows) {
      const key = `${row.brand_id ?? ""}|${row.store_id ?? ""}|${row.period_id ?? ""}`;
      if (!coverage.has(key)) coverage.set(key, new Set());
      coverage.get(key).add(row.canonical_platform);
    }
    for (const [key, present] of coverage) {
      const missing = expectedPlatforms.filter((platform) => !present.has(platform));
      if (missing.length) issues.push(issue("PLATFORM_COVERAGE_MISSING", "warning", null, `${key} 缺少平台：${missing.join("、")}；仅阻断跨平台结论`, ["brand_id", "store_id", "platform", "period_id"]));
    }
  }

  return {
    summary: {
      row_count: outputRows.length,
      issue_count: issues.length,
      blocking_issue_count: issues.filter((x) => x.level === "blocking").length,
      warning_count: issues.filter((x) => x.level === "warning").length,
      comparable_row_count: outputRows.filter((x) => x.comparison.status === "可比").length,
      platform_coverage_issue_count: issues.filter((x) => x.code === "PLATFORM_COVERAGE_MISSING").length,
    },
    issues,
    rows: outputRows,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : null;
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (!inputPath || !outputPath) throw new Error("Usage: node validate_and_calculate.mjs --input rows.json --output result.json");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = validateAndCalculate(input);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result.summary));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
