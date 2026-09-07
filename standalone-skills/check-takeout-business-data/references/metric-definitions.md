# Metric definitions

## Row grain

One row represents one `brand_id + store_id + canonical_platform + period_id`. Duplicate keys are blocking. Period dates are inclusive. Brand aggregation must never replace store-level checks.

Canonical platforms:

- `美团外卖`: aliases `美团`, `美团外卖`
- `淘宝闪购（饿了么）`: aliases `饿了么`, `淘宝闪购`, `淘宝闪购（饿了么）`
- `京东外卖`: aliases `京东`, `京东外卖`

When `expected_platforms` is provided, evaluate coverage for every brand, store, and period. Missing coverage blocks only cross-platform conclusions; platform-level calculations may continue.

## Data states

- `正常`: calculations may proceed when fields are complete.
- `新店`: keep facts but do not calculate a comparison without a valid base.
- `缺失导出`: block calculations that require the missing export.
- `未知`: block diagnosis until clarified.

If a core metric is `0`, `zero_value_meaning` must explicitly state one of: `实际0`, `新店`, `缺失导出`, `未知`. A blank value or `不适用` is not enough. `未知`, `缺失导出`, and `新店` are explicit states but still block period comparison until a valid base exists.

## Calculations

Return `null` when a denominator is zero or missing.

- merchant subsidy rate = `merchant_subsidy / order_total_amount`
- original AOV = `order_total_amount / valid_orders`
- paid AOV = `customer_paid_amount / valid_orders`
- income AOV = `estimated_order_income / valid_orders`
- daily exposure = `exposure_users / inclusive period days`
- new customer share = `new_customers / (new_customers + returning_customers)`
- returning customer share = `returning_customers / (new_customers + returning_customers)`
- neutral/negative review rate = `neutral_negative_reviews / total_reviews`

## Comparisons

Compare consecutive rows within the same `brand_id + store_id + canonical_platform`, sorted by `period_start`.

- change = `(current - previous) / previous`
- require both rows to have `data_availability = 正常`
- require a positive base value
- otherwise return status `不可比` and preserve the reason

Continuous decline uses three comparable periods. The MVP historical rule triggers when period 3 income is at least 20% below period 1 and period 1 income is greater than 2500. This is a configured historical rule, not an industry standard.

## Issue levels

- `blocking`: diagnosis must stop for the affected row or comparison.
- `warning`: calculation may continue but a human must review the caveat.
- `info`: traceability note.

Stable codes: `REQUIRED_FIELD_MISSING`, `DUPLICATE_GRAIN`, `DATA_UNAVAILABLE`, `ZERO_MEANING_MISSING`, `ZERO_MEANING_UNRESOLVED`, `INVALID_NUMBER`, `INVALID_PERIOD`, `PERIOD_MISMATCH`, `PLATFORM_COVERAGE_MISSING`, `BASE_NOT_COMPARABLE`.
