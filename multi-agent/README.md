# 多 Agent 模式

这一模式在现有“单 Agent + Skills”之外增加一个总控 Agent 与四个职责独立的专业 Agent。它解决的是连锁品牌数据量较大时的上下文隔离、责任分工、证据追溯和独立审核，不以增加 Agent 数量作为目的。

## 自动路由

默认情况下，1–5家门店且为单品牌、分析范围简单时使用轻量模式。满足以下任一条件时使用多 Agent 深度诊断：门店不少于6家、品牌不少于2个、“门店 × 平台”单元超过15个、存在严重数据阻断，或用户要求跨店/跨品牌比较。

用户可以用 `--mode single` 或 `--mode multi` 覆盖自动判断。

## 本地运行

```bash
node multi-agent/scripts/run_multi_agent_review.mjs \
  --input examples/synthetic-input.json \
  --output-dir outputs/multi-agent-demo \
  --mode auto
```

本地运行器调用确定性校验、诊断、策略映射和审核模块，输出：

- `mode-decision.json`
- `agent-01-data-quality.json`
- `agent-02-diagnosis.json`
- `agent-03-strategy.json`
- `agent-04-action-review.json`
- `collaboration-trace.json`
- `final-result.json`
- `final-report.md`

本地运行器用于演示和测试角色交接，不调用五个独立语言模型实例。WorkBuddy 安装包中的 `expertType: "team"` 配置负责真实的主理人与成员 Agent 调度。

## 审核门禁

审核结果只有四种：通过待人工确认、待补证据、退回策略 Agent、安全拒绝。审核 Agent 的退回和否决不能被总控覆盖；被退回的策略最多自动修正一次。
