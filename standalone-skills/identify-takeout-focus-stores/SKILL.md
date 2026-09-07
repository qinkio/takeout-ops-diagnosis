---
name: identify-takeout-focus-stores
description: Execute configured takeout operating rules across brands, stores, platforms, and periods; return focus stores, rule-hit evidence, priorities, confidence, and brand-level counts without inventing causes. Use after takeout data has passed deterministic validation and the user needs multi-store or multi-platform anomaly detection, weekly review prioritization, rule testing, or traceable store drill-down.
---

# Identify Takeout Focus Stores

Execute rules only after `check-takeout-business-data` has produced validated rows and issues.

## Workflow

1. Read `references/rule-registry.json` and do not create unregistered rules.
2. Accept `{ rows, issues, tasks, as_of_date, expected_platforms }` from the validation step. Require `brand_id + store_id` on every prior task.
3. Run `node scripts/execute_rules.mjs --input <validated.json> --output <rule-result.json>`.
4. Present `focus_stores` before `rule_hits`; keep evidence fields and source rows visible.
5. Use `brand_rollup` only to count stores by attention state. Never elevate one store’s evidence into a brand-wide cause.

## Scope Rules

- Partition rows by `brand_id + store_id + canonical_platform` before comparing periods.
- Compare platforms only within the same brand, store, and aligned periods.
- Treat unequal adjacent period lengths as data blocking and suppress operating-rule hits until the period basis is repaired.
- Support `美团外卖`, `淘宝闪购（饿了么）`, and `京东外卖`.
- Allow one to three platforms per store. Missing coverage blocks only cross-platform conclusions.
- Keep platform-specific directions and problem layers when two or three platforms diverge; do not collapse different funnel or customer layers into one store-wide action.
- Do not emit `PLATFORM-001` when an expected platform is missing or platform periods are misaligned.
- Match prior tasks by exact `brand_id + store_id`; never attach a task with an unknown brand to multiple brands.

## Output Boundaries

- Separate deterministic facts from interpretations.
- Return “证据不足” rather than guessing a cause.
- Preserve configured thresholds and source pointers.
- Preserve source task IDs when emitting `TASK-001` so the next skill can create parent-child lineage.
- Mark historical thresholds as configuration, not industry standards.
- Do not recommend actions, send messages, create tasks, or write to a platform.
- Require human review for every focus-store conclusion except stable descriptive decomposition.

## Resources

- Read `references/rule-registry.json` for enabled rules, priority, thresholds, and source notes.
- Read `references/standard-test-overrides.json` when reconciling the demonstration workbook's golden cases; compare the full rule set, highest priority, and primary focus.
- Run `scripts/test_execute_rules.mjs` after changing rule logic.
