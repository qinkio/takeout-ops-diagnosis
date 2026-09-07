import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PRIORITY_RANK = { "数据阻断": 5, P0: 4, P1: 3, P2: 2, "提示": 1 };
const ZERO_SENSITIVE = ["order_total_amount", "valid_orders", "estimated_order_income", "exposure_users"];

const blank = (value) => value === null || value === undefined || String(value).trim() === "";
const num = (value) => blank(value) ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const change = (current, previous) => {
  const c = num(current); const p = num(previous);
  return c === null || p === null || p <= 0 ? null : (c - p) / p;
};
const fmtPct = (value) => value === null ? "不可比" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

function canonicalPlatform(value) {
  const platform = String(value ?? "").trim();
  if (["美团", "美团外卖"].includes(platform)) return "美团外卖";
  if (["饿了么", "淘宝闪购", "淘宝闪购（饿了么）"].includes(platform)) return "淘宝闪购（饿了么）";
  if (["京东", "京东外卖"].includes(platform)) return "京东外卖";
  return platform;
}

function dateValue(value) {
  if (typeof value === "number" && value > 20000 && value < 100000) return new Date((value - 25569) * 86400000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inclusiveDays(start, end) {
  const s = dateValue(start); const e = dateValue(end);
  return !s || !e || e < s ? null : Math.floor((e - s) / 86400000) + 1;
}

function sourceRowsOf(rows) {
  return rows.map((row) => row.source_row).filter((value) => value !== null && value !== undefined).sort((a, b) => a - b).join(",");
}

function ruleMapOf(registry) {
  return new Map(registry.filter((rule) => rule.enabled !== false).map((rule) => [rule.rule_id, rule]));
}

function makeHit(ruleMap, params) {
  const rule = ruleMap.get(params.rule_id);
  if (!rule) return null;
  return {
    hit_id: null,
    brand_id: params.brand_id,
    brand_name: params.brand_name,
    store_id: params.store_id,
    store_name: params.store_name,
    test_case_id: params.test_case_id ?? null,
    scope_type: params.scope_type ?? "平台",
    platform_scope: params.platform_scope,
    rule_id: rule.rule_id,
    rule_name: rule.rule_name,
    priority: params.priority ?? rule.priority,
    focus_layer: params.focus_layer,
    fact: params.fact,
    evidence_fields: params.evidence_fields,
    evidence_values: params.evidence_values,
    confidence: params.confidence ?? "高",
    manual_review_required: rule.manual_review_required,
    source_pointer: rule.source_pointer,
    source_rows: params.source_rows,
    source_task_ids: params.source_task_ids ?? "",
    source_task_statuses: params.source_task_statuses ?? "",
  };
}

function platformSummary(rows) {
  const sorted = [...rows].sort((a, b) => (dateValue(a.period_start)?.getTime() ?? 0) - (dateValue(b.period_start)?.getTime() ?? 0));
  const first = sorted[0];
  const latest = sorted.at(-1);
  const firstAov = num(first.calculated?.avg_income_aov ?? first.avg_income_aov);
  const latestAov = num(latest.calculated?.avg_income_aov ?? latest.avg_income_aov);
  return {
    platform: canonicalPlatform(latest.canonical_platform ?? latest.platform), rows: sorted, first, latest,
    income_change: change(latest.estimated_order_income, first.estimated_order_income),
    orders_change: change(latest.valid_orders, first.valid_orders),
    aov_change: change(latestAov, firstAov),
    exposure_change: change(latest.exposure_users, first.exposure_users),
    entry_change: change(latest.store_entry_rate, first.store_entry_rate),
    conversion_change: change(latest.order_conversion_rate, first.order_conversion_rate),
    new_customer_change: change(latest.new_customers, first.new_customers),
    returning_customer_change: change(latest.returning_customers, first.returning_customers),
    rating_change: change(latest.store_rating, first.store_rating),
  };
}

export function executeRules(input, registry) {
  const rows = input?.rows ?? [];
  const tasks = input?.tasks ?? [];
  const issues = input?.issues ?? [];
  const expectedPlatforms = (input?.expected_platforms ?? []).map(canonicalPlatform);
  const asOf = dateValue(input?.as_of_date ?? new Date().toISOString().slice(0, 10));
  const ruleMap = ruleMapOf(registry);
  const storeGroups = new Map();

  for (const source of rows) {
    const row = { ...source, canonical_platform: canonicalPlatform(source.canonical_platform ?? source.platform) };
    const key = `${row.brand_id ?? ""}|${row.store_id ?? ""}`;
    if (!storeGroups.has(key)) storeGroups.set(key, []);
    storeGroups.get(key).push(row);
  }

  const ruleHits = [];
  const focusStores = [];

  for (const storeRows of storeGroups.values()) {
    const sample = storeRows[0];
    const platformGroups = new Map();
    for (const row of storeRows) {
      if (!platformGroups.has(row.canonical_platform)) platformGroups.set(row.canonical_platform, []);
      platformGroups.get(row.canonical_platform).push(row);
    }
    const summaries = [...platformGroups.values()].map(platformSummary);
    const platforms = summaries.map((x) => x.platform).sort();
    const scope = platforms.join(";");
    const sourceRows = sourceRowsOf(storeRows);
    const testCaseId = [...new Set(storeRows.map((x) => x.test_case_id).filter(Boolean))].join(";") || null;
    const hits = [];
    const add = (hit) => { if (hit) hits.push(hit); };
    const base = { brand_id: sample.brand_id, brand_name: sample.brand_name, store_id: sample.store_id, store_name: sample.store_name, test_case_id: testCaseId, source_rows: sourceRows };

    const unavailable = storeRows.filter((row) => row.data_availability !== "正常");
    if (unavailable.length) add(makeHit(ruleMap, { ...base, platform_scope: [...new Set(unavailable.map((x) => x.canonical_platform))].join(";"), rule_id: "DQ-001", focus_layer: "数据质量", fact: "存在数据可用状态非正常的平台或周期", evidence_fields: "data_availability", evidence_values: [...new Set(unavailable.map((x) => x.data_availability))].join(";") }));

    const zeroUnresolved = storeRows.filter((row) => ZERO_SENSITIVE.some((field) => num(row[field]) === 0) && ["", "不适用", "未知", "缺失导出", "新店"].includes(String(row.zero_value_meaning ?? "").trim()));
    if (zeroUnresolved.length) add(makeHit(ruleMap, { ...base, platform_scope: [...new Set(zeroUnresolved.map((x) => x.canonical_platform))].join(";"), rule_id: "DQ-002", focus_layer: "数据质量", fact: "核心指标为0且含义未解决，禁止计算该基期环比", evidence_fields: "zero_value_meaning;核心0值指标", evidence_values: [...new Set(zeroUnresolved.map((x) => x.zero_value_meaning ?? "空"))].join(";") }));

    const periodMap = new Map();
    for (const row of storeRows) {
      if (!periodMap.has(row.period_id)) periodMap.set(row.period_id, { signatures: new Set(), platforms: new Set() });
      periodMap.get(row.period_id).signatures.add(`${row.period_start}|${row.period_end}`);
      periodMap.get(row.period_id).platforms.add(row.canonical_platform);
    }
    const crossPlatformPeriodMismatch = [...periodMap.values()].some((x) => x.signatures.size > 1);
    const periodLengthMismatch = summaries.some((summary) => new Set(summary.rows.map((row) => inclusiveDays(row.period_start, row.period_end)).filter((days) => days !== null)).size > 1);
    const periodOverlap = summaries.some((summary) => summary.rows.some((row, index) => index > 0 && dateValue(row.period_start) <= dateValue(summary.rows[index - 1].period_end)));
    const periodMismatch = crossPlatformPeriodMismatch || periodLengthMismatch || periodOverlap;
    const coverageMissing = expectedPlatforms.length > 0 && [...periodMap.values()].some((x) => expectedPlatforms.some((platform) => !x.platforms.has(platform)));
    if (periodMismatch || coverageMissing) add(makeHit(ruleMap, { ...base, platform_scope: scope, rule_id: "DQ-003", priority: periodMismatch ? "数据阻断" : "P2", focus_layer: "数据质量", fact: periodOverlap ? "同一门店的相邻经营周期日期重叠" : periodLengthMismatch ? "同一门店的相邻经营周期长度不一致" : crossPlatformPeriodMismatch ? "同门店各平台周期起止日期不一致" : "平台覆盖不完整，只阻断跨平台结论", evidence_fields: "platform;period_id;period_start;period_end", evidence_values: periodOverlap ? "相邻周期日期重叠" : periodLengthMismatch ? "相邻周期包含天数不同" : `${platforms.length}/${expectedPlatforms.length || platforms.length}个平台` }));
    const dataBlocked = unavailable.length > 0 || zeroUnresolved.length > 0 || periodMismatch;

    const splitDeadband = ruleMap.get("PLATFORM-001")?.thresholds?.direction_deadband ?? 0.05;
    const directions = summaries.filter((x) => x.income_change !== null && Math.abs(x.income_change) >= splitDeadband).map((x) => Math.sign(x.income_change));
    const platformSplit = !dataBlocked && !coverageMissing && new Set(directions).size > 1;
    if (platformSplit) add(makeHit(ruleMap, { ...base, platform_scope: scope, rule_id: "PLATFORM-001", focus_layer: "跨平台", fact: "同一门店的平台收入变化方向存在分化，应分平台查看", evidence_fields: "estimated_order_income", evidence_values: summaries.map((x) => `${x.platform}:${fmtPct(x.income_change)}`).join(";") }));

    const trendConfig = ruleMap.get("TREND-001")?.thresholds ?? { decline: -0.2, first_income_floor: 2500 };
    const trendPlatforms = dataBlocked || platformSplit ? [] : summaries.filter((summary) => {
      if (summary.rows.length < 3) return false;
      const window = summary.rows.slice(-3);
      const values = window.map((row) => num(row.estimated_order_income));
      const lengths = window.map((row) => {
        const start = dateValue(row.period_start); const end = dateValue(row.period_end);
        return start && end && end >= start ? Math.floor((end - start) / 86400000) + 1 : null;
      });
      return window.every((row) => row.data_availability === "正常") && values.every((x) => x !== null)
        && lengths.every((days) => days !== null && days === lengths[0])
        && values[0] > trendConfig.first_income_floor && values[0] > values[1] && values[1] > values[2]
        && change(values[2], values[0]) <= trendConfig.decline;
    });
    if (trendPlatforms.length) add(makeHit(ruleMap, { ...base, platform_scope: trendPlatforms.map((x) => x.platform).join(";"), rule_id: "TREND-001", focus_layer: "连续下滑", fact: "连续三个有效周期下滑，并命中历史重点关注阈值", evidence_fields: "estimated_order_income", evidence_values: trendPlatforms.map((x) => `${x.platform}:${x.rows.slice(-3).map((r) => num(r.estimated_order_income)?.toFixed(0)).join("→")}`).join(";") }));

    const serviceConfig = ruleMap.get("SERVICE-001")?.thresholds ?? { rating_floor: 4.6, small_review_sample: 10 };
    const servicePlatforms = dataBlocked ? [] : summaries.filter((x) => num(x.latest.store_rating) !== null && (num(x.latest.store_rating) < serviceConfig.rating_floor || (x.rating_change !== null && x.rating_change <= -0.05) || num(x.latest.merchant_fault_cancellations) > num(x.first.merchant_fault_cancellations)));
    if (servicePlatforms.length) {
      const smallSample = servicePlatforms.some((x) => num(x.latest.total_reviews) < serviceConfig.small_review_sample);
      add(makeHit(ruleMap, { ...base, platform_scope: servicePlatforms.map((x) => x.platform).join(";"), rule_id: "SERVICE-001", focus_layer: "评分与服务", confidence: smallSample ? "低" : "中", fact: smallSample ? "评分指标异常，但评价样本较小，不做强原因结论" : "评分或服务指标异常，需要结合评价内容复核", evidence_fields: "store_rating;total_reviews;merchant_fault_cancellations", evidence_values: servicePlatforms.map((x) => `${x.platform}:评分${x.first.store_rating}→${x.latest.store_rating},评价${x.latest.total_reviews}`).join(";") }));
    }

    const customerCandidates = dataBlocked ? [] : summaries.map((x) => ({ ...x, min_change: Math.min(x.new_customer_change ?? 0, x.returning_customer_change ?? 0) })).filter((x) => x.min_change <= -0.2);
    if (customerCandidates.length && !servicePlatforms.length) {
      const grouped = new Map();
      for (const candidate of customerCandidates) {
        const focus = (candidate.new_customer_change ?? 0) <= (candidate.returning_customer_change ?? 0) ? "新客侧" : "老客侧";
        if (!grouped.has(focus)) grouped.set(focus, []);
        grouped.get(focus).push(candidate);
      }
      for (const [focus, candidates] of grouped) add(makeHit(ruleMap, { ...base, source_rows: sourceRowsOf(candidates.flatMap((x) => x.rows)), platform_scope: candidates.map((x) => x.platform).join(";"), rule_id: "CUSTOMER-001", focus_layer: focus, confidence: "中", fact: `${focus}指标出现有效下降，建议进一步核查构成与触达记录`, evidence_fields: focus === "新客侧" ? "new_customers" : "returning_customers", evidence_values: candidates.map((x) => `${x.platform}:${focus === "新客侧" ? fmtPct(x.new_customer_change) : fmtPct(x.returning_customer_change)}`).join(";") }));
    }

    const funnelCandidates = dataBlocked ? [] : summaries.filter((x) => [x.exposure_change, x.entry_change, x.conversion_change].some((value) => value !== null && value <= -0.2));
    if (funnelCandidates.length && !servicePlatforms.length && !customerCandidates.length) {
      const evidence = funnelCandidates.map((x) => {
        const candidates = [["曝光", x.exposure_change], ["进店", x.entry_change], ["下单转化", x.conversion_change]].filter(([, value]) => value !== null).sort((a, b) => a[1] - b[1]);
        return { platform: x.platform, layer: candidates[0][0], value: candidates[0][1] };
      });
      const grouped = new Map();
      for (const item of evidence) {
        const focus = `${item.layer}层`;
        if (!grouped.has(focus)) grouped.set(focus, []);
        grouped.get(focus).push(item);
      }
      for (const [focus, items] of grouped) {
        const candidates = funnelCandidates.filter((candidate) => items.some((item) => item.platform === candidate.platform));
        add(makeHit(ruleMap, { ...base, source_rows: sourceRowsOf(candidates.flatMap((x) => x.rows)), platform_scope: items.map((x) => x.platform).join(";"), rule_id: "FUNNEL-001", focus_layer: focus, confidence: "中", fact: `订单链路变化主要集中在${focus}，这是变化定位而不是原因结论`, evidence_fields: "exposure_users;store_entry_rate;order_conversion_rate", evidence_values: items.map((x) => `${x.platform}:${x.layer}${fmtPct(x.value)}`).join(";") }));
      }
    }

    const taskProblems = tasks.filter((task) => task.brand_id === sample.brand_id && task.store_id === sample.store_id).filter((task) => {
      const due = dateValue(task.due_date);
      return (due && asOf && due < asOf && !["已完成", "已取消"].includes(task.status)) || (task.status === "已完成" && blank(task.validation_result));
    });
    if (taskProblems.length) add(makeHit(ruleMap, { ...base, scope_type: "门店", platform_scope: "", rule_id: "TASK-001", focus_layer: "任务闭环", fact: "上期任务存在逾期未完成或已完成但缺少验证结果", evidence_fields: "task_id;due_date;status;validation_result", evidence_values: taskProblems.map((x) => `${x.task_id}:${x.status}`).join(";"), source_task_ids: taskProblems.map((x) => x.task_id).join(";"), source_task_statuses: taskProblems.map((x) => `${x.task_id}:${x.status}`).join(";") }));

    const hasSpecific = hits.some((hit) => ["FUNNEL-001", "CUSTOMER-001", "SERVICE-001"].includes(hit.rule_id));
    const perfCandidates = dataBlocked ? [] : summaries.filter((x) => x.income_change !== null);
    if (perfCandidates.length && (!hasSpecific || platformSplit || trendPlatforms.length)) {
      const strongest = [...perfCandidates].sort((a, b) => Math.abs(b.income_change) - Math.abs(a.income_change))[0];
      const perfDeadband = ruleMap.get("PERF-001")?.thresholds?.material_change_deadband ?? 0.1;
      const stable = Math.abs(strongest.income_change) < perfDeadband;
      const orderMaterial = strongest.orders_change !== null && Math.abs(strongest.orders_change) >= perfDeadband;
      const aovMaterial = strongest.aov_change !== null && Math.abs(strongest.aov_change) >= perfDeadband;
      const side = orderMaterial && aovMaterial ? "订单与收入客单共同" : orderMaterial ? "订单侧" : aovMaterial ? "收入客单侧" : "无明显结构性";
      add(makeHit(ruleMap, { ...base, platform_scope: perfCandidates.map((x) => x.platform).join(";"), rule_id: "PERF-001", priority: stable ? "提示" : "P1", focus_layer: stable ? "无重点风险" : side, confidence: "高", fact: stable ? `收入在${(perfDeadband * 100).toFixed(0)}%配置死区内波动，未强制生成风险结论` : `收入变化主要发生在${side}`, evidence_fields: "estimated_order_income;valid_orders;avg_income_aov", evidence_values: perfCandidates.map((x) => `${x.platform}:收入${fmtPct(x.income_change)},订单${fmtPct(x.orders_change)},收入客单${fmtPct(x.aov_change)}`).join(";") }));
    }

    const deduped = [...new Map(hits.map((hit) => [`${hit.rule_id}|${hit.focus_layer}|${hit.platform_scope}`, hit])).values()];
    for (const hit of deduped) { hit.hit_id = `HIT-${String(ruleHits.length + 1).padStart(4, "0")}`; ruleHits.push(hit); }
    const top = [...deduped].sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))[0];
    const highest = top?.priority ?? "提示";
    focusStores.push({
      brand_id: sample.brand_id, brand_name: sample.brand_name, store_id: sample.store_id, store_name: sample.store_name, test_case_id: testCaseId,
      platform_count: platforms.length, platforms: scope, platform_coverage: expectedPlatforms.length ? `${coverageMissing ? "不完整" : "完整"} ${platforms.length}/${expectedPlatforms.length}` : `${platforms.length}`,
      attention_status: (PRIORITY_RANK[highest] ?? 0) >= 2 ? "重点关注" : "无需重点关注", highest_priority: highest,
      primary_rule_id: top?.rule_id ?? null, primary_focus: top?.focus_layer ?? "无重点风险", hit_rule_ids: [...new Set(deduped.map((x) => x.rule_id))].join(";"),
      data_status: deduped.some((x) => x.priority === "数据阻断") ? "不可完整分析" : "可分析", manual_review_required: deduped.some((x) => x.manual_review_required), source_rows: sourceRows,
    });
  }

  focusStores.sort((a, b) => (PRIORITY_RANK[b.highest_priority] ?? 0) - (PRIORITY_RANK[a.highest_priority] ?? 0) || a.brand_id.localeCompare(b.brand_id) || a.store_id.localeCompare(b.store_id));
  const brandMap = new Map();
  for (const store of focusStores) {
    if (!brandMap.has(store.brand_id)) brandMap.set(store.brand_id, { brand_id: store.brand_id, brand_name: store.brand_name, store_count: 0, focus_store_count: 0, data_blocked_store_count: 0, p0_store_count: 0, platform_coverage_complete_count: 0, note: "品牌层仅做门店数量汇总，不生成品牌级原因结论" });
    const brand = brandMap.get(store.brand_id);
    brand.store_count += 1;
    if (store.attention_status === "重点关注") brand.focus_store_count += 1;
    if (store.highest_priority === "数据阻断") brand.data_blocked_store_count += 1;
    if (store.highest_priority === "P0") brand.p0_store_count += 1;
    if (!expectedPlatforms.length || String(store.platform_coverage).startsWith("完整")) brand.platform_coverage_complete_count += 1;
  }

  return {
    summary: { brand_count: brandMap.size, store_count: focusStores.length, focus_store_count: focusStores.filter((x) => x.attention_status === "重点关注").length, rule_hit_count: ruleHits.length, p0_store_count: focusStores.filter((x) => x.highest_priority === "P0").length, data_blocked_store_count: focusStores.filter((x) => x.highest_priority === "数据阻断").length, input_issue_count: issues.length },
    brand_rollup: [...brandMap.values()].sort((a, b) => a.brand_id.localeCompare(b.brand_id)),
    focus_stores: focusStores,
    rule_hits: ruleHits,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input"); const outputIndex = args.indexOf("--output"); const registryIndex = args.indexOf("--registry");
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : null; const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const registryPath = registryIndex >= 0 ? args[registryIndex + 1] : new URL("../references/rule-registry.json", import.meta.url);
  if (!inputPath || !outputPath) throw new Error("Usage: node execute_rules.mjs --input validated.json --output result.json [--registry rules.json]");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  const result = executeRules(input, registry);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result.summary));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
