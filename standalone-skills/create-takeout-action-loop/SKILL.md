---
name: create-takeout-action-loop
description: Turn takeout focus-store rule hits into evidence-backed task candidates with approval states, owners, due-date inputs, observation periods, validation metrics, source traceability, and closure status. Use when Codex needs to create or update a human-reviewed operating task loop from multi-brand, multi-store, multi-platform takeout diagnostics, especially after identify-takeout-focus-stores. Do not use to log into delivery platforms, change campaigns, contact customers, or claim task completion without evidence.
---

# Create Takeout Action Loop

Convert deterministic rule hits into task candidates without treating historical operating experience as commands. Keep the workflow upload-only and human-controlled.

Treat every candidate as a solution proposal. Explain the problem it addresses, when it applies, what evidence is still needed, who should own it, how long to observe it, and which metric will verify whether it worked.

## Workflow

1. Require `focus_stores` and `rule_hits` from the focus-store identification step. Accept optional `evidence_inventory` records with `brand_id`, `store_id`, `evidence_name`, and `status`, plus optional `action_decisions` records for explicit `适用` or `不适用` decisions.
2. Preserve `brand_id + store_id + scope_type + platform_scope`; never merge different stores.
3. Read [references/action-mapping-registry.json](references/action-mapping-registry.json) only when mapping rules to actions.
4. Read [references/action-conditions.json](references/action-conditions.json) before checking action applicability and dependencies.
5. Run `scripts/create_action_loop.mjs input.json [output.json]` for deterministic generation.
6. Return one or more candidates per focus store only when a registered rule-action mapping exists.
7. Skip an action when an explicit decision marks it `不适用`; preserve the reason in `skipped`.
8. Put data-blocked stores into data repair only; suppress operating recommendations.
9. Evaluate the registered evidence list before moving a candidate from `待补证据` to `待人工确认`.
10. Keep `owner_name`, confirmation date, completion evidence, validation date, validation status, and validation result as human inputs.
11. Verify the output against [references/safety-boundaries.md](references/safety-boundaries.md).

## Output contract

- Separate task facts, evidence requirements, proposed action, human decision, execution evidence, and validation result.
- Use only these initial states: `待人工确认`, `待补证据`, `待补数据`.
- Use only these approval states: `待人工确认`, `待补证据`, `已确认`, `不执行`.
- Do not calculate a due date until approval is `已确认` and a confirmation date exists.
- Do not enter execution until approval is `已确认` and a confirmation date exists.
- Do not mark a task `已闭环` until completion evidence, validation date, validation status, and a validation result all exist.
- Preserve `rule_id`, `source_pointer`, and `source_rows` for every candidate.
- Preserve `applicability_status`, `applicable_when`, `not_applicable_when`, and `dependencies` for every candidate.
- Preserve `parent_task_ids` for candidates generated from `TASK-001`.
- Use `scope_type=门店` with a blank `platform_scope` for non-platform prior-task follow-up; never put labels such as “门店任务” into the platform field.
- Return skipped mappings and reasons rather than inventing actions.

## Decision rules

- Suppress `PERF-001` as a standalone task when a more specific rule already exists. Keep it in related-rule evidence.
- For `DQ-*`, generate only data repair candidates.
- For funnel, customer, service, platform, trend, and prior-task rules, select mappings by `rule_id + focus_layer`.
- Treat marketing, pricing, menu, images, promotion, and customer-contact ideas as drafts. Require the evidence specified by the registry and explicit human approval.
- Never use a platform login, platform API, or writeback. Platform exports and screenshots are optional evidence supplied by a user.

## Verification

Run `node scripts/test_create_action_loop.mjs`. Require stable task counts, unique task IDs, no operating task for data-blocked stores, no prohibited language, manual review for every candidate, and source traceability.
