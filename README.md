# Local Evolver

纯本地 AI Agent 自进化引擎。无外部依赖，无网络连接，所有数据留在本地。

## 为什么造这个

市面上的 agent 进化方案（如 EvoMap/evolver）都要求连接外部 Hub，存在数据外泄、prompt 注入、算力寄生等风险。Local Evolver 只保留核心进化能力，砍掉所有网络层。

## 工作原理

```
日志/记忆 → 信号提取 → 基因匹配 → 进化方案 → 执行 → 固化
```

1. **信号提取** — 扫描日志和记忆文件，用中英双语模式匹配提取结构化信号（错误、机会、重复模式）
2. **基因匹配** — 信号与基因库的策略模板匹配，按相关度 + 历史成功率加权选择最佳基因
3. **进化方案** — 组装结构化 prompt，包含信号、策略步骤、安全约束
4. **执行** — Agent 按方案修改文件（仅限白名单路径）
5. **固化** — 验证安全性，更新基因库计数，记录事件日志，追加教训

## 快速开始

```bash
# 查看当前信号
node index.js signals

# 审核模式（生成方案，不自动执行）
node index.js review

# 执行模式
node index.js run

# 固化结果
node index.js solidify [result.json]

# 查看状态
node index.js status

# 重置连续失败计数
node index.js reset
```

## 安全机制

- **文件白名单** — 只允许修改 `memory/`、`evolution/`、`HEARTBEAT.md`、`TOOLS.md`
- **禁止修改** — SOUL.md、IDENTITY.md、USER.md、MEMORY.md、AGENTS.md
- **Blast radius 限制** — 每次最多 5 个文件、200 行
- **自动暂停** — 连续失败 3 次后停止进化，需手动 reset
- **信号去重** — 同一信号被处理 3+ 次后自动抑制，防止死循环
- **基因 ban** — 连续失败 2 次的基因被临时禁用

## 种子基因库

| ID | 类别 | 触发信号 |
|----|------|----------|
| `gene_memory_optimize` | optimize | 日志稀疏、教训为空 |
| `gene_error_repair` | repair | 错误日志、超时、连接失败 |
| `gene_workflow_automate` | innovate | 重复操作、用户功能请求 |
| `gene_capability_extend` | innovate | 能力缺口、用户需求 |
| `gene_perf_optimize` | optimize | 性能瓶颈、超时 |
| `gene_stagnation_break` | innovate | 进化停滞、系统稳定 |

基因库随使用自动进化：成功的基因权重增加，失败的降低，新模式产生新基因。

## 项目结构

```
local-evolver/
├── index.js          # CLI 入口
├── SKILL.md          # OpenClaw skill 描述
├── package.json
└── src/
    ├── config.js     # 路径、安全约束、策略参数
    ├── signals.js    # 信号提取
    ├── genes.js      # 基因库 CRUD + 选择器
    ├── prompt.js     # 进化 prompt 构建
    └── solidify.js   # 固化、验证、事件日志
```

运行时数据（由 agent workspace 管理）：

```
workspace/evolution/
├── genes.json        # 基因库
├── events.jsonl      # 进化事件日志（append-only）
├── state.json        # 运行状态
└── pending.md        # 待审核方案（review 模式）
```

## 设计为 OpenClaw Skill

本项目设计为 [OpenClaw](https://github.com/nicepkg/openclaw) 的 skill，放在 `skills/local-evolver/` 目录下即可被 agent 发现和使用。也可以独立运行。

## License

MIT
