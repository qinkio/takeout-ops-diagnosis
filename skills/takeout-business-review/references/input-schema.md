# 输入数据规范

## 文件粒度

每行必须唯一对应一个“品牌 + 门店 + 平台 + 周期”。同一品牌可以有多个门店，每个门店可以有美团外卖、淘宝闪购（饿了么）和京东外卖三个平台，每个平台可以有多个连续周期。

## 必填字段

| 规范字段 | 含义 | 允许别名 |
|---|---|---|
| brand_id | 品牌唯一ID | 品牌ID、品牌编码 |
| brand_name | 品牌名称 | 品牌 |
| store_id | 门店唯一ID | 门店ID、门店编码 |
| store_name | 门店名称 | 门店 |
| platform | 平台 | 渠道、外卖平台 |
| period_id | 周期ID | 周期、数据周期 |
| period_start | 周期开始日 | 开始日期、起始日期 |
| period_end | 周期结束日 | 结束日期、截止日期 |
| data_availability | 数据可用状态 | 数据状态 |
| zero_value_meaning | 0值含义 | 零值含义、0值说明 |

平台规范值仅限：`美团外卖`、`淘宝闪购（饿了么）`、`京东外卖`。允许把“美团”“饿了么”“淘宝闪购”“京东”映射为对应规范值。

`data_availability` 推荐填写“正常”；其他状态会进入数据阻断。`zero_value_meaning` 可填写“实际0”“新店”“缺失导出”“未知”或“不适用”。

## 核心数值字段

优先读取：`order_total_amount`、`customer_paid_amount`、`estimated_order_income`、`valid_orders`、`merchant_subsidy`、`exposure_users`、`new_customers`、`returning_customers`、`total_reviews`、`neutral_negative_reviews`。

诊断增强字段包括：`store_entry_rate`、`order_conversion_rate`、`store_rating`、`merchant_fault_cancellations`。缺少增强字段时，只运行证据足够的规则。

## 顶层JSON示例

```json
{
  "expected_platforms": ["美团外卖", "淘宝闪购（饿了么）", "京东外卖"],
  "as_of_date": "2026-09-02",
  "rows": [],
  "tasks": [],
  "evidence_inventory": [],
  "action_decisions": []
}
```

每一行增加 `source_row`，指向上传表格中的原始行号。不得因为清洗或排序丢失源行。
