---
name: local-evolver
description: 本地进化引擎。分析运行日志提取信号，匹配基因库选择策略，生成进化方案。使用场景：当用户提到"进化"、"evolve"、"自我改进"、"优化 agent"，或在心跳任务中触发进化检查时使用。
tags: [meta, evolution, self-improvement, core]
---

# Local Evolver - 本地进化引擎

纯本地、无外部依赖的 AI Agent 自进化系统。

## 工作原理

```
日志/记忆 → 信号提取 → 基因匹配 → 进化方案 → 执行 → 固化
```

1. **信号提取**: 扫描 `memory/YYYY-MM-DD.md` 和 `lessons.md`，提取错误、机会、重复模式等信号
2. **基因匹配**: 用信号匹配 `evolution/genes.json` 中的策略模板，选出最佳基因
3. **进化方案**: 组装结构化 prompt，包含信号、基因策略、安全约束
4. **执行**: 按方案修改文件（仅限允许路径）
5. **固化**: 验证结果，更新基因库，记录事件日志

## 使用方式

### 方式一：CLI 命令

```bash
# 查看当前信号
node skills/local-evolver/index.js signals

# 审核模式（生成方案到 pending.md，不自动执行）
node skills/local-evolver/index.js review

# 执行模式（输出 prompt）
node skills/local-evolver/index.js run

# 固化结果
node skills/local-evolver/index.js solidify [result.json]

# 查看状态
node skills/local-evolver/index.js status
```

### 方式二：Agent 内调用（推荐）

当你（Pisces）需要执行进化时：

1. 运行 `node skills/local-evolver/index.js signals` 查看信号
2. 运行 `node skills/local-evolver/index.js review` 生成方案
3. 读取 `workspace/evolution/pending.md` 审核方案
4. 按方案执行修改
5. 输出 EvolutionResult JSON
6. 运行 `node skills/local-evolver/index.js solidify` 固化

### 方式三：心跳触发

在 HEARTBEAT.md 的周期任务中，每周执行一次进化检查：

1. 运行 signals 命令检查是否有可操作信号
2. 如果有，运行 review 生成方案
3. 评估方案是否值得执行
4. 执行并固化

## 安全约束

- **禁止修改**: SOUL.md, IDENTITY.md, USER.md, MEMORY.md, AGENTS.md
- **允许修改**: memory/, evolution/, HEARTBEAT.md, TOOLS.md
- **影响范围**: 每次最多 5 个文件、200 行
- **自动暂停**: 连续失败 3 次后暂停，需手动 reset
- **无外部连接**: 不连接任何外部服务，所有数据本地处理

## EvolutionResult 格式

进化执行完成后，输出以下 JSON：

```json
{
  "type": "EvolutionResult",
  "intent": "repair|optimize|innovate",
  "gene_id": "使用的基因 ID",
  "summary_zh": "一句话中文总结",
  "files_changed": ["修改的文件列表"],
  "blast_radius": { "files": 1, "lines": 20 },
  "outcome": { "status": "success|failed|skipped", "reason": "原因" },
  "new_gene": null,
  "lesson": "这次学到了什么"
}
```

## 基因库

初始包含 6 个种子基因：

| ID | 类别 | 触发信号 |
|----|------|----------|
| gene_memory_optimize | optimize | 日志稀疏、教训为空 |
| gene_error_repair | repair | 错误日志、超时、连接失败 |
| gene_workflow_automate | innovate | 重复操作、用户功能请求 |
| gene_capability_extend | innovate | 能力缺口、用户需求 |
| gene_perf_optimize | optimize | 性能瓶颈、超时 |
| gene_stagnation_break | innovate | 进化停滞、系统稳定 |

基因库会随使用自动进化：成功的基因权重增加，失败的降低，新发现的模式会产生新基因。

## 文件结构

```
workspace/evolution/
├── genes.json       # 基因库
├── events.jsonl     # 进化事件日志（append-only）
├── state.json       # 运行状态（计数、连续失败等）
└── pending.md       # 待审核的进化方案（review 模式）
```
