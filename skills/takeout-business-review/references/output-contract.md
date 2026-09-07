# 输出约定

结果目录必须包含：

| 文件 | 用途 |
|---|---|
| summary.md | 面向普通用户的结论摘要 |
| data-issues.csv | 数据阻断和警告清单 |
| focus-stores.csv | 全部门店优先级与重点关注状态 |
| rule-hits.csv | 规则、事实、证据字段、平台范围和源行 |
| task-candidates.csv | 待确认动作、适用条件、缺失证据和验证指标 |
| validation.json | 完整校验结果 |
| diagnosis.json | 完整诊断结果 |
| action-loop.json | 完整候选任务结果 |

摘要不得只给建议，必须说明：

- 数据能否分析
- 阻断项与警告项数量
- 品牌、门店与重点门店数量
- 规则命中数和P0门店数
- 候选任务数、待补证据数和待确认适用性数

所有CSV必须使用UTF-8 BOM，便于中文Excel直接打开。
