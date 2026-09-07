# 外卖经营诊断与行动系统

把多品牌、多门店、多平台的外卖经营数据，转成可以核验的经营结论和解决建议。

用户上传美团外卖、淘宝闪购（饿了么）或京东外卖的 Excel、CSV、JSON 数据后，系统会先检查数据是否可靠，再找出需要优先关注的门店和问题环节，最后给出带适用条件、证据要求、负责人、观察周期和验证指标的解决建议。

项目提供两种互相独立的使用方式：

- **WorkBuddy“外卖经营诊断顾问”**：适合普通用户。上传文件后用自然语言完成完整诊断、建议与复盘。
- **三个独立 Skill**：适合在 Codex 或兼容 Skill 的环境中单独调用，也可以按顺序组合。

## 能得到什么

一次完整分析会输出：

1. **数据是否可用**：缺字段、重复行、周期重叠、平台缺失、0 值含义不明等问题。
2. **重点门店与优先级**：按品牌、门店、平台和周期识别需要先处理的对象。
3. **问题定位**：收入变化来自订单还是收入客单，异常集中在曝光、进店、下单、新客、老客或服务中的哪一层。
4. **解决建议方案**：说明建议做什么、为什么建议、什么情况下适用、需要补什么证据。
5. **执行与验证计划**：给出建议负责人、优先级、观察周期和验证指标。

例如，系统不会只说“某门店收入下降”，而会继续区分：

- 曝光下降：建议核查营业状态、活动台账、推广配置和平台资源记录。
- 进店转化下降：建议核查主图、店铺装修、价格和评分展示的变更证据。
- 下单转化下降：建议核查菜单结构、套餐、活动和配送门槛。
- 老客下降：建议核查复购、评价、客诉和餐品稳定性，触达方案必须先确认权限。

这些内容是待确认的解决方案，不会自动登录平台、修改活动或联系顾客。

## 方式一：使用 WorkBuddy 专家

### 安装

1. 下载 `releases/takeout-business-review-expert-v1.0.3.zip`。
2. 打开 WorkBuddy 的“专家·技能·连接器”，进入“我的专家”。
3. 选择“导入专家”，上传 ZIP 包。
4. 召唤“外卖经营诊断顾问”。

### 怎么问

上传文件后可以直接输入：

```text
分析我的外卖经营数据。先检查数据问题，再找出重点门店和问题环节，最后给出解决建议、负责人、观察周期和验证指标。
```

也可以分步骤提问：

```text
检查这份外卖数据能不能用于周复盘。
找出本周最需要关注的门店，并说明依据。
针对这些门店给出可执行的解决建议和验证方案。
```

### 建议上传的数据

每行对应“品牌 + 门店 + 平台 + 周期”。至少提供品牌、门店、平台、周期起止日期、预计收入和有效订单；有条件时再提供曝光、进店转化、下单转化、新老客、评分和评价数据。

同一品牌可以有多个门店，每个门店可以包含一个到三个平台。平台缺失时仍可分析已有平台，但不会强行给出跨平台结论。

## 方式二：使用独立 Skills

三个 Skill 位于 `standalone-skills/`，不存在对 WorkBuddy 专家定义或头像的依赖。

在 Codex 中使用时，下载需要的 Skill ZIP，解压后把同名文件夹放入 `~/.codex/skills/`，重新打开任务即可调用。也可以只安装其中一个，不要求同时安装三项。

| Skill | 安装包 |
|---|---|
| 数据质检与指标计算 | `releases/check-takeout-business-data-v1.0.0.zip` |
| 重点门店识别 | `releases/identify-takeout-focus-stores-v1.0.0.zip` |
| 解决建议与任务闭环 | `releases/create-takeout-action-loop-v1.0.0.zip` |

### 1. 数据质检与指标计算

目录：`standalone-skills/check-takeout-business-data`

```text
使用 $check-takeout-business-data 检查我上传的外卖经营数据，输出数据问题和可比较的经营指标。
```

适合只做字段、周期、0 值、平台覆盖和指标计算，不生成经营建议。

### 2. 重点门店识别

目录：`standalone-skills/identify-takeout-focus-stores`

```text
使用 $identify-takeout-focus-stores 分析已校验的数据，找出重点门店、问题环节和规则证据。
```

适合只做多品牌、多门店、多平台诊断，不生成动作方案。

### 3. 解决建议与任务闭环

目录：`standalone-skills/create-takeout-action-loop`

```text
使用 $create-takeout-action-loop 根据重点门店和规则命中，给出解决建议、适用条件、证据要求、负责人、观察周期和验证指标。
```

适合把已有诊断转成解决方案和待确认任务。它不会把建议描述成已经执行，也不会在证据不足时编造原因。

### 组合使用

需要完整复盘时，按以下顺序调用：

```text
$check-takeout-business-data
  -> $identify-takeout-focus-stores
  -> $create-takeout-action-loop
```

## 本地演示

```bash
node examples/generate-demo-input.mjs
node skills/takeout-business-review/scripts/run_takeout_review.mjs \
  --input examples/synthetic-input.json \
  --output-dir outputs/demo
```

演示数据包含 2 个虚构品牌、3 个虚构门店、3 个平台和 3 个连续周期，共 27 行。所有名称和数字均为合成数据。

## 验证

```bash
node tests/public-smoke-test.mjs
node standalone-skills/check-takeout-business-data/scripts/test_validate_and_calculate.mjs
node standalone-skills/identify-takeout-focus-stores/scripts/test_execute_rules.mjs
node standalone-skills/create-takeout-action-loop/scripts/test_create_action_loop.mjs
```

## 使用边界

- 不连接或操作外卖平台。
- 不自动修改价格、菜单、活动或推广。
- 不自动联系顾客。
- 不把不同品牌、门店、平台或不一致周期混成一个原因结论。
- 数据不完整时缩小分析范围或停止相关判断。
- 解决建议必须经过人工确认，执行后还要用约定指标验证。

规则中的20%、2500元、4.6分等阈值是可配置的演示默认值，不是任何平台的官方标准。详见 `docs/public-methodology.md`。

## 作者

Argine · `qinyuebei@foxmail.com`

## License

MIT
