const { PATHS, SAFETY, readFileSafe, nowIso, todayStr } = require('./config');

/**
 * 构建进化 prompt
 *
 * 这个 prompt 会被 Pisces agent 在 session 中执行。
 * 它不直接调用 LLM API，而是生成一份结构化的进化指令，
 * 由 agent 读取后自主执行。
 */
function buildEvolutionPrompt({ signals, intent, selectedGene, alternatives, recentEvents, workspaceState }) {
  const now = nowIso();
  const today = todayStr();

  // 信号摘要
  const signalSummary = signals.map(s => {
    const tag = s.category ? `[${s.category}]` : '';
    return `- ${tag} ${s.type}: ${s.detail || ''}`;
  }).join('\n');

  // 基因信息
  let geneBlock = '';
  if (selectedGene) {
    geneBlock = `
## 选中的基因

- ID: ${selectedGene.id}
- 类别: ${selectedGene.category}
- 描述: ${selectedGene.description}
- 历史: ${selectedGene.success_count || 0} 次成功 / ${selectedGene.fail_count || 0} 次失败

### 策略步骤
${selectedGene.strategy.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### 约束
- 最大文件数: ${selectedGene.constraints?.max_files || SAFETY.maxBlastRadius.files}
- 允许路径: ${(selectedGene.constraints?.allowed_paths || SAFETY.allowedPaths).join(', ')}
`;
  } else {
    geneBlock = `
## 无匹配基因

没有找到匹配当前信号的基因。你需要：
1. 分析信号，设计一个新的解决策略
2. 执行策略
3. 如果成功，将策略固化为新基因
`;
  }

  // 备选基因
  let altBlock = '';
  if (alternatives && alternatives.length > 0) {
    altBlock = `
### 备选基因
${alternatives.map(g => `- ${g.id} (${g.category}): ${g.description}`).join('\n')}
如果主基因策略不适用，可以参考备选。
`;
  }

  // 最近进化历史
  let historyBlock = '';
  if (recentEvents && recentEvents.length > 0) {
    const recent = recentEvents.slice(-5);
    historyBlock = `
## 最近进化历史（避免重复）

${recent.map((e, i) => `${i + 1}. [${e.intent}] ${e.gene_id || '无基因'} → ${e.outcome?.status || '未知'} (${e.timestamp?.slice(0, 10) || '?'})`).join('\n')}

重要：不要重复最近失败的策略。如果同一基因连续失败 2 次，换一个方向。
`;
  }

  // workspace 状态
  let stateBlock = '';
  if (workspaceState) {
    stateBlock = `
## 当前 Workspace 状态

- 日志文件数: ${workspaceState.logCount || 0}
- lessons.md 状态: ${workspaceState.lessonsStatus || '未知'}
- projects.md 状态: ${workspaceState.projectsStatus || '未知'}
- 基因库大小: ${workspaceState.geneCount || 0}
- 进化事件数: ${workspaceState.eventCount || 0}
`;
  }

  // 组装完整 prompt
  const prompt = `# 进化指令 [${today}]

你正在执行一次本地进化循环。请严格按照以下指令操作。

## 进化意图: ${intent.toUpperCase()}

## 检测到的信号

${signalSummary}

${geneBlock}
${altBlock}
${historyBlock}
${stateBlock}

## 安全约束（不可违反）

1. **禁止修改**: ${SAFETY.forbiddenFiles.join(', ')}
2. **允许修改**: 仅 workspace/ 下的 ${SAFETY.allowedPaths.join(', ')}
3. **影响范围**: 最多修改 ${SAFETY.maxBlastRadius.files} 个文件，${SAFETY.maxBlastRadius.lines} 行
4. **先读后改**: 修改任何文件前必须先读取当前内容
5. **可逆性**: 所有修改必须可回滚

## 输出要求

完成进化后，你必须输出一个 JSON 块（用 \`\`\`json 包裹），包含以下字段：

\`\`\`
{
  "type": "EvolutionResult",
  "intent": "repair|optimize|innovate",
  "gene_id": "使用的基因 ID（如果是新基因则用 gene_new_xxx）",
  "summary_zh": "一句话中文总结你做了什么",
  "files_changed": ["修改的文件路径列表"],
  "blast_radius": { "files": N, "lines": N },
  "outcome": { "status": "success|failed", "reason": "原因" },
  "new_gene": null 或 { "id": "...", "category": "...", "signals_match": [...], "description": "...", "strategy": [...] },
  "lesson": "这次进化学到了什么（写入 lessons.md）"
}
\`\`\`

## 开始

分析信号，执行策略，产出结果。如果判断当前没有值得做的进化（所有信号都是 info 级别），输出 outcome.status = "skipped"。
`;

  return prompt.trim();
}

/**
 * 收集当前 workspace 状态
 */
function collectWorkspaceState() {
  const { loadGenes } = require('./genes');
  const { readEvents } = require('./solidify');
  const fs = require('fs');
  const path = require('path');

  let logCount = 0;
  try {
    const files = fs.readdirSync(PATHS.memory);
    logCount = files.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length;
  } catch {}

  const lessons = readFileSafe(PATHS.lessonsMd, '');
  const projects = readFileSafe(PATHS.projectsMd, '');
  const geneData = loadGenes();
  const events = readEvents();

  return {
    logCount,
    lessonsStatus: lessons.includes('暂无') ? '空' : `${lessons.split('\n').length} 行`,
    projectsStatus: projects.includes('暂无') ? '空' : `${projects.split('\n').length} 行`,
    geneCount: geneData.genes.length,
    eventCount: events.length,
  };
}

module.exports = {
  buildEvolutionPrompt,
  collectWorkspaceState,
};
