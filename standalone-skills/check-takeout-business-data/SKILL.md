---
name: check-takeout-business-data
description: Validate standardized weekly takeout store data, calculate auditable operating metrics, and return data-quality issues plus period comparisons. Use when Codex or WorkBuddy receives an uploaded Excel, CSV, or JSON takeout operating dataset and must check fields, types, uniqueness, period alignment, zero-value semantics, or calculate revenue, order, AOV, traffic, customer, and review indicators before diagnosis.
---

# Check Takeout Business Data

Use deterministic checks before any diagnosis. Keep facts and calculations separate from inference.

## Workflow

1. Read `references/metric-definitions.md` before mapping source columns.
2. Normalize each Excel row to JSON without changing identifiers or zero-value meaning.
3. Run `node scripts/validate_and_calculate.mjs --input <rows.json> --output <result.json>`.
4. Stop diagnosis when `summary.blocking_issue_count > 0` for the affected scope.
5. Treat `rows[].calculated` and `rows[].comparison` as deterministic facts only.
6. Pass `issues`, source fields, and calculation status to the next skill. Never replace `null` or “not comparable” with `0%`.

## Input Contract

Accept a JSON array or `{ "rows": [...], "expected_platforms": [...] }`. Require one row per brand, store, platform, and period. Preserve Excel row numbers in `source_row` when available. Use `expected_platforms` when the business expects complete platform coverage.

Required identity and period fields:

- `brand_id`, `brand_name`, `store_id`, `store_name`, `platform`, `period_id`
- `period_start`, `period_end`
- `data_availability`, `zero_value_meaning`

Core calculation fields:

- `order_total_amount`, `customer_paid_amount`, `estimated_order_income`
- `valid_orders`, `merchant_subsidy`, `exposure_users`
- `new_customers`, `returning_customers`
- `total_reviews`, `neutral_negative_reviews`

## Output Rules

- Return field-level issues with stable codes and source keys.
- Return `null` when the denominator is zero, missing, or the period is not comparable.
- Only calculate week-over-week change when both periods are normal and the base is greater than zero.
- Require the current and previous periods to have equal inclusive day counts before calculating change.
- Only evaluate continuous decline when three consecutive, equally sized, normal periods decrease in sequence and meet the configured threshold.
- Never infer a cause, recommend an action, or change a rule threshold.
- Never merge platforms into one conclusion when their period coverage differs.
- Treat `美团` and `美团外卖` as the same platform; treat `饿了么` and `淘宝闪购（饿了么）` as the same platform; use `京东外卖` as the third canonical platform.
- Never combine stores that share a `store_id` but belong to different brands.

## Resources

- Read `references/metric-definitions.md` for formulas, zero semantics, and issue codes.
- Run `scripts/test_validate_and_calculate.mjs` after modifying calculation logic.
