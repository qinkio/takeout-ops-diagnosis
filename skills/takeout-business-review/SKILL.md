---
name: takeout-business-review
display_name: 外卖经营诊断与建议
display_name_en: Takeout Operations Diagnosis
description: Validate and analyze uploaded takeout operating data across multiple brands, stores, platforms and periods, then generate traceable focus-store diagnostics and human-reviewed action tasks. Trigger for 外卖经营复盘、多门店分析、三平台分析、重点门店、经营异常、周复盘 or takeout operations review.
description_zh: 校验多品牌多门店三平台外卖数据，生成可追溯的重点门店诊断和待确认任务。
description_en: Validate multi-brand, multi-store and multi-platform takeout data and generate traceable diagnostics and human-reviewed tasks.
version: 1.0.3
author: Argine
---

# 外卖经营诊断与建议

将用户上传的 Excel、CSV 或 JSON 转成确定性校验、规则诊断和人工确认任务。保持上传分析模式，不要求任何外卖平台接口或授权。

公开版规则来自脱敏后的个人项目方法论。阈值是可配置的演示默认值，不代表任何外卖平台的官方标准；使用前应结合品牌目标、门店阶段和数据口径调整。详见 `@references/public-methodology.md`。

## 执行顺序

1. 读取 `@references/input-schema.md`，映射字段并生成规范化 JSON。
2. 执行 `scripts/run_takeout_review.mjs`，不得绕过数据校验直接运行诊断。
3. 数据阻断时只输出数据问题和数据修复任务。
4. 数据可分析时，按品牌、门店、平台分别保留规则事实、证据字段、源行和置信度。
5. 候选动作必须通过适用性、证据和人工确认后才能进入执行。
6. 按 `@references/output-contract.md` 交付 Markdown、CSV 和 JSON 结果。

## 命令

```bash
node skills/takeout-business-review/scripts/run_takeout_review.mjs \
  --input <normalized-input.json> \
  --output-dir <new-output-directory>
```

输入文件必须是对象，至少包含 `rows` 数组。可选包含：

- `expected_platforms`
- `tasks`
- `evidence_inventory`
- `action_decisions`
- `as_of_date`

## 结果使用

- 先读 `summary.md` 获取用户摘要。
- 用 `data-issues.csv` 告知用户哪些数据需要修复。
- 用 `focus-stores.csv` 和 `rule-hits.csv` 解释为什么关注某家门店。
- 用 `task-candidates.csv` 展示待补证据和待人工确认任务。
- 如需回填 Excel，复制 `templates/takeout-business-review-workbook-sample.xlsx` 后另存新文件；禁止覆盖模板或用户上传文件。

## 安全规则

读取 `@references/safety-boundaries.md` 并严格执行。特别注意：候选动作不等于执行结果；平台缺失不等于门店异常；没有证据不得归因；没有人工确认不得执行。
