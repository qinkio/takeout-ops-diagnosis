---
name: propose-takeout-strategies
description: Generate evidence-bounded takeout operations strategy proposals from validated focus-store diagnoses and an approved action catalog. Use for 外卖策略建议、门店解决方案、候选动作、策略适用条件 or when a multi-agent diagnosis needs proposals before an independent action review.
---

# 经营策略候选生成

只把已核验诊断转成候选策略，不负责最终审批、执行或闭环认定。

## 执行

1. 接收 `focus_stores`、`rule_hits`、`evidence_inventory` 和可选的 `action_decisions`。
2. 执行 `scripts/propose_strategies.mjs`，不得绕过规则到动作映射。
3. 每条方案保留品牌、门店、平台范围、来源规则、来源行、适用条件、证据和验证指标。
4. 动作库外的新想法放入 `unreviewed_ideas`，不得进入 `proposals`。
5. 将结果交给 `$audit-takeout-actions`，不得自行标记通过或执行。

```bash
node skills/propose-takeout-strategies/scripts/propose_strategies.mjs input.json output.json
```

读取 `references/proposal-contract.md`。禁止修改诊断事实，禁止将假设写成事实，禁止推荐刷单、虚假交易、好评返券、好评卡、电话追评或未经授权的平台操作。
