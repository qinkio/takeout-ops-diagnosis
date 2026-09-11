---
name: audit-takeout-actions
description: Independently audit takeout strategy proposals for evidence lineage, scope consistency, safety boundaries, approval state and task completeness. Use for 外卖行动审核、策略合规检查、证据校验、人工审批门禁 or as the final reviewer in a takeout multi-agent workflow.
---

# 行动合规审核

独立审核候选策略，不生成新策略，不覆盖诊断事实，也不代表用户批准执行。

## 执行

1. 接收 `proposals` 与对应 `rule_hits`，并读取 `references/review-policy.md`。
2. 执行 `scripts/audit_actions.mjs`。
3. 检查来源命中、品牌门店范围、证据完整性、人工审批标记、验证设计和禁止动作。
4. 只返回 `通过待人工确认`、`待补证据`、`退回策略Agent` 或 `安全拒绝`。
5. `退回策略Agent` 必须包含字段级原因；自动修正次数不得超过一次。

```bash
node skills/audit-takeout-actions/scripts/audit_actions.mjs input.json output.json
```

审核 Agent 拥有退回与安全否决权。没有用户确认和执行证据时，禁止出现“执行中”“已执行”或“已闭环”。
