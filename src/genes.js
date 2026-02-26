const fs = require('fs');
const { PATHS, STRATEGY, readJsonSafe, writeJsonAtomic, ensureDir, nowIso } = require('./config');

// --- 初始基因库 ---

const SEED_GENES = [
  {
    id: 'gene_memory_optimize',
    category: 'optimize',
    signals_match: ['sparse_logs', 'empty_lessons', 'no_recent_logs'],
    description: '优化记忆系统：压缩旧日志、整理教训、更新索引',
    strategy: [
      '检查最近 7 天日志，提炼关键结论到 lessons.md',
      '压缩超过 14 天的日志为一行摘要',
      '确保 MEMORY.md 索引准确且 < 40 行',
      '清理 memory/ 下的空文件',
    ],
    constraints: { max_files: 5, allowed_paths: ['memory/', 'MEMORY.md'] },
    validation: ['检查 MEMORY.md 行数 <= 40', '检查 lessons.md 非空'],
    created_at: null,
    success_count: 0,
    fail_count: 0,
  },
  {
    id: 'gene_error_repair',
    category: 'repair',
    signals_match: ['log_error', 'error_signature', 'recurring_error', 'timeout_error', 'connection_error'],
    description: '修复运行时错误：分析错误签名，定位根因，应用最小修复',
    strategy: [
      '从信号中提取错误签名和上下文',
      '定位错误发生的模块和文件',
      '分析根因（配置错误？代码缺陷？外部依赖？）',
      '应用最小化修复，不改动无关代码',
      '记录修复方案到 lessons.md',
    ],
    constraints: { max_files: 3, allowed_paths: ['memory/', 'evolution/'] },
    validation: ['确认错误不再出现', '检查修复没有引入新问题'],
    created_at: null,
    success_count: 0,
    fail_count: 0,
  },
  {
    id: 'gene_workflow_automate',
    category: 'innovate',
    signals_match: ['automation_opportunity', 'recurring_issue', 'user_feature_request'],
    description: '自动化重复工作流：识别手动重复操作，创建自动化方案',
    strategy: [
      '从信号中识别重复操作模式',
      '评估自动化的可行性和收益',
      '设计最小可行的自动化方案',
      '实现并测试',
      '记录到 HEARTBEAT.md 或 cron jobs',
    ],
    constraints: { max_files: 4, allowed_paths: ['memory/', 'evolution/', 'HEARTBEAT.md'] },
    validation: ['自动化脚本可执行', '不影响现有功能'],
    created_at: null,
    success_count: 0,
    fail_count: 0,
  },
  {
    id: 'gene_capability_extend',
    category: 'innovate',
    signals_match: ['capability_gap', 'user_feature_request', 'user_improvement'],
    description: '扩展能力：根据用户需求或能力缺口，增加新功能',
    strategy: [
      '分析用户需求或能力缺口的具体内容',
      '检查现有 skills 是否已有类似功能',
      '设计最小实现方案',
      '实现并验证',
      '更新 TOOLS.md 记录新能力',
    ],
    constraints: { max_files: 5, allowed_paths: ['memory/', 'evolution/', 'TOOLS.md'] },
    validation: ['新功能可正常调用', '不破坏现有功能'],
    created_at: null,
    success_count: 0,
    fail_count: 0,
  },
  {
    id: 'gene_perf_optimize',
    category: 'optimize',
    signals_match: ['perf_bottleneck', 'timeout_error', 'memory_error'],
    description: '性能优化：识别瓶颈，减少延迟和资源消耗',
    strategy: [
      '从信号中定位性能瓶颈',
      '分析是 token 消耗、网络延迟还是内存问题',
      '设计针对性优化方案',
      '实施并测量效果',
      '记录优化结果到 lessons.md',
    ],
    constraints: { max_files: 3, allowed_paths: ['memory/', 'evolution/'] },
    validation: ['性能指标有改善', '不引入功能回退'],
    created_at: null,
    success_count: 0,
    fail_count: 0,
  },
  {
    id: 'gene_stagnation_break',
    category: 'innovate',
    signals_match: ['evolution_stagnation', 'stable'],
    description: '打破停滞：系统稳定但缺乏进步时，主动探索改进方向',
    strategy: [
      '审视当前 workspace 的整体状态',
      '检查 HEARTBEAT.md 是否有可优化的任务',
      '检查 lessons.md 是否有未解决的历史问题',
      '提出一个小而具体的改进建议',
      '记录探索结果',
    ],
    constraints: { max_files: 3, allowed_paths: ['memory/', 'evolution/'] },
    validation: ['产出了具体的改进建议或行动'],
    created_at: null,
    success_count: 0,
    fail_count: 0,
  },
];

/**
 * 加载基因库，不存在则用种子初始化
 */
function loadGenes() {
  ensureDir(PATHS.evolution);
  const data = readJsonSafe(PATHS.genes, null);
  if (data && Array.isArray(data.genes)) return data;
  // 初始化
  const initial = { version: 1, genes: SEED_GENES, updated_at: nowIso() };
  writeJsonAtomic(PATHS.genes, initial);
  return initial;
}

/**
 * 保存基因库
 */
function saveGenes(data) {
  data.updated_at = nowIso();
  writeJsonAtomic(PATHS.genes, data);
}

/**
 * 新增或更新基因
 */
function upsertGene(gene) {
  const data = loadGenes();
  const idx = data.genes.findIndex(g => g.id === gene.id);
  if (idx >= 0) {
    data.genes[idx] = { ...data.genes[idx], ...gene, updated_at: nowIso() };
  } else {
    gene.created_at = gene.created_at || nowIso();
    gene.success_count = gene.success_count || 0;
    gene.fail_count = gene.fail_count || 0;
    data.genes.push(gene);
  }
  saveGenes(data);
  return gene;
}

/**
 * 更新基因的成功/失败计数
 */
function recordGeneOutcome(geneId, success) {
  const data = loadGenes();
  const gene = data.genes.find(g => g.id === geneId);
  if (!gene) return;
  if (success) {
    gene.success_count = (gene.success_count || 0) + 1;
  } else {
    gene.fail_count = (gene.fail_count || 0) + 1;
  }
  gene.last_used_at = nowIso();
  saveGenes(data);
}

/**
 * 获取基因的成功率
 */
function geneSuccessRate(gene) {
  const total = (gene.success_count || 0) + (gene.fail_count || 0);
  if (total === 0) return 0.5; // 未使用过，给中性分
  return (gene.success_count || 0) / total;
}

// --- 基因选择 ---

/**
 * 计算基因与信号的匹配分数
 */
function scoreGene(gene, signals) {
  if (!gene || !Array.isArray(gene.signals_match)) return 0;
  const signalTypes = signals.map(s => typeof s === 'string' ? s : s.type);
  let score = 0;
  for (const pattern of gene.signals_match) {
    const p = pattern.toLowerCase();
    for (const st of signalTypes) {
      if (st.toLowerCase().includes(p) || p.includes(st.toLowerCase())) {
        score += 1;
      }
    }
  }
  // 成功率加权：成功率高的基因得分更高
  const rate = geneSuccessRate(gene);
  score *= (0.5 + rate * 0.5);
  return score;
}

/**
 * 选择最佳匹配基因
 */
function selectGene(signals, opts) {
  const data = loadGenes();
  const bannedIds = (opts && opts.bannedIds) || new Set();

  const scored = data.genes
    .filter(g => !bannedIds.has(g.id))
    .map(g => ({ gene: g, score: scoreGene(g, signals) }))
    .filter(x => x.score >= STRATEGY.minGeneScore)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { selected: null, alternatives: [] };

  return {
    selected: scored[0].gene,
    alternatives: scored.slice(1, 4).map(x => x.gene),
    score: scored[0].score,
  };
}

module.exports = {
  loadGenes,
  saveGenes,
  upsertGene,
  recordGeneOutcome,
  geneSuccessRate,
  scoreGene,
  selectGene,
  SEED_GENES,
};
