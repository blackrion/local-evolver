const fs = require('fs');
const path = require('path');
const { PATHS, ensureDir, nowIso, todayStr } = require('./src/config');
const { extractSignals, determineIntent, suppressOverprocessed } = require('./src/signals');
const { selectGene, loadGenes } = require('./src/genes');
const { buildEvolutionPrompt, collectWorkspaceState } = require('./src/prompt');
const { readEvents, readState, solidify, parseEvolutionResult, shouldPause, getBannedGeneIds } = require('./src/solidify');

// --- 命令: run / review ---

function cmdRun(mode) {
  const isReview = mode === 'review';

  console.log(`[Evolver] ${isReview ? '审核模式' : '执行模式'} - ${nowIso()}`);

  // 检查是否应该暂停
  if (shouldPause()) {
    console.log('[Evolver] 连续失败次数过多，暂停进化。使用 `node index.js reset` 重置。');
    process.exit(0);
  }

  // 1. 提取信号
  console.log('[Evolver] 提取信号...');
  let signals = extractSignals();

  // 2. 历史去重
  const events = readEvents();
  signals = suppressOverprocessed(signals, events);

  const intent = determineIntent(signals);
  console.log(`[Evolver] 意图: ${intent} | 信号数: ${signals.length}`);

  if (intent === 'idle') {
    console.log('[Evolver] 系统稳定，无需进化。');
    // 记录 skipped 事件
    solidify({
      type: 'EvolutionResult',
      intent: 'idle',
      outcome: { status: 'skipped', reason: '无可操作信号' },
      blast_radius: { files: 0, lines: 0 },
    });
    return;
  }

  // 3. 选择基因
  const bannedIds = getBannedGeneIds();
  const selection = selectGene(signals, { bannedIds });
  console.log(`[Evolver] 基因: ${selection.selected ? selection.selected.id : '无匹配'}`);

  // 4. 收集 workspace 状态
  const workspaceState = collectWorkspaceState();

  // 5. 构建进化 prompt
  const prompt = buildEvolutionPrompt({
    signals,
    intent,
    selectedGene: selection.selected,
    alternatives: selection.alternatives,
    recentEvents: events.slice(-10),
    workspaceState,
  });

  // 6. 输出
  ensureDir(PATHS.evolution);

  if (isReview) {
    // 审核模式：写入 pending.md，等待人工确认
    const pendingContent = `# 待审核进化方案\n\n生成时间: ${nowIso()}\n意图: ${intent}\n基因: ${selection.selected ? selection.selected.id : '无'}\n\n---\n\n${prompt}\n`;
    fs.writeFileSync(PATHS.pending, pendingContent, 'utf8');
    console.log(`[Evolver] 进化方案已写入 ${PATHS.pending}`);
    console.log('[Evolver] 请审核后执行，或使用 `node index.js solidify` 固化结果。');
  } else {
    // 执行模式：直接输出 prompt（由 agent 在 session 中执行）
    console.log('\n' + '='.repeat(60));
    console.log(prompt);
    console.log('='.repeat(60) + '\n');
  }
}

// --- 命令: solidify ---

function cmdSolidify(args) {
  const dryRun = args.includes('--dry-run');

  // 从 stdin 或参数读取结果
  let input = '';

  // 尝试从 pending.md 读取（如果有 agent 输出附加在里面）
  const pending = fs.existsSync(PATHS.pending) ? fs.readFileSync(PATHS.pending, 'utf8') : '';

  // 尝试从命令行参数读取 JSON 文件路径
  const jsonFileArg = args.find(a => a.endsWith('.json'));
  if (jsonFileArg && fs.existsSync(jsonFileArg)) {
    input = fs.readFileSync(jsonFileArg, 'utf8');
  } else if (pending) {
    input = pending;
  }

  if (!input.trim()) {
    console.log('[Solidify] 没有找到进化结果。请提供 JSON 文件路径或确保 pending.md 包含结果。');
    console.log('用法: node index.js solidify [result.json] [--dry-run]');
    process.exit(1);
  }

  const result = parseEvolutionResult(input);
  if (!result) {
    console.log('[Solidify] 无法解析 EvolutionResult。请确保输出包含正确的 JSON 格式。');
    process.exit(1);
  }

  console.log(`[Solidify] ${dryRun ? '(DRY RUN) ' : ''}处理结果: ${result.intent} - ${result.summary_zh || ''}`);

  const res = solidify(result, { dryRun });

  if (res.skipped) {
    console.log('[Solidify] 跳过（无操作）');
  } else if (res.ok) {
    console.log('[Solidify] 成功固化');
    if (res.event) {
      console.log(`  事件: ${res.event.id}`);
      console.log(`  摘要: ${res.event.summary}`);
    }
    // 清理 pending.md
    if (!dryRun && fs.existsSync(PATHS.pending)) {
      fs.unlinkSync(PATHS.pending);
    }
  } else {
    console.log('[Solidify] 失败');
    if (res.errors) {
      for (const e of res.errors) console.log(`  错误: ${e}`);
    }
  }

  process.exit(res.ok ? 0 : 2);
}

// --- 命令: status ---

function cmdStatus() {
  const state = readState();
  const events = readEvents();
  const geneData = loadGenes();

  console.log('=== Local Evolver 状态 ===\n');
  console.log(`总运行次数: ${state.total_runs || 0}`);
  console.log(`成功: ${state.total_success || 0} | 失败: ${state.total_failed || 0} | 跳过: ${state.total_skipped || 0}`);
  console.log(`连续失败: ${state.consecutive_failures || 0} / ${3}（上限）`);
  console.log(`基因数量: ${geneData.genes.length}`);
  console.log(`事件数量: ${events.length}`);

  if (state.last_run) {
    console.log(`\n最近一次: [${state.last_run.intent}] ${state.last_run.summary || ''}`);
    console.log(`  结果: ${state.last_run.outcome?.status || '未知'}`);
    console.log(`  时间: ${state.last_run.timestamp || '未知'}`);
  }

  // 基因排行
  if (geneData.genes.length > 0) {
    console.log('\n--- 基因库 ---');
    const sorted = [...geneData.genes].sort((a, b) =>
      ((b.success_count || 0) - (b.fail_count || 0)) - ((a.success_count || 0) - (a.fail_count || 0))
    );
    for (const g of sorted) {
      const rate = (g.success_count || 0) + (g.fail_count || 0) > 0
        ? ((g.success_count || 0) / ((g.success_count || 0) + (g.fail_count || 0)) * 100).toFixed(0) + '%'
        : '未使用';
      console.log(`  ${g.id} [${g.category}] 成功率: ${rate} (${g.success_count || 0}/${(g.success_count || 0) + (g.fail_count || 0)})`);
    }
  }

  // 最近事件
  if (events.length > 0) {
    console.log('\n--- 最近 5 次进化 ---');
    const recent = events.slice(-5);
    for (const e of recent) {
      const status = e.outcome?.status || '?';
      const icon = status === 'success' ? '+' : status === 'skipped' ? '~' : '-';
      console.log(`  [${icon}] ${e.timestamp?.slice(0, 16) || '?'} [${e.intent}] ${e.gene_id || '无基因'} → ${status}`);
      if (e.summary) console.log(`      ${e.summary}`);
    }
  }

  // 暂停状态
  if (shouldPause()) {
    console.log('\n*** 进化已暂停（连续失败过多）。使用 `node index.js reset` 重置。 ***');
  }
}

// --- 命令: reset ---

function cmdReset() {
  const state = readState();
  state.consecutive_failures = 0;
  const { saveState } = require('./src/solidify');
  saveState(state);
  console.log('[Evolver] 连续失败计数已重置。');
}

// --- 命令: signals ---

function cmdSignals() {
  const signals = extractSignals();
  const intent = determineIntent(signals);

  console.log(`=== 信号分析 [${todayStr()}] ===\n`);
  console.log(`意图判定: ${intent}\n`);

  const categories = {};
  for (const s of signals) {
    const cat = s.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(s);
  }

  for (const [cat, sigs] of Object.entries(categories)) {
    console.log(`[${cat}]`);
    for (const s of sigs) {
      console.log(`  ${s.type}: ${s.detail || ''}`);
    }
    console.log('');
  }
}

// --- 主入口 ---

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'run':
      cmdRun('run');
      break;
    case 'review':
      cmdRun('review');
      break;
    case 'solidify':
      cmdSolidify(args.slice(1));
      break;
    case 'status':
      cmdStatus();
      break;
    case 'signals':
      cmdSignals();
      break;
    case 'reset':
      cmdReset();
      break;
    default:
      console.log(`Local Evolver - 本地进化引擎

用法: node index.js <command>

命令:
  run       执行进化循环（输出 prompt 供 agent 执行）
  review    审核模式（生成方案写入 pending.md，不自动执行）
  solidify  固化进化结果（验证 + 持久化）
  status    查看进化状态和统计
  signals   仅分析信号（不执行进化）
  reset     重置连续失败计数

选项:
  solidify [file.json]   从 JSON 文件读取结果
  solidify --dry-run     试运行，不实际写入

示例:
  node index.js signals          # 看看当前有什么信号
  node index.js review           # 生成进化方案供审核
  node index.js run              # 直接执行进化循环
  node index.js solidify         # 固化 agent 产出的结果
  node index.js status           # 查看进化统计
`);
  }
}

// 导出供 OpenClaw skill 系统使用
module.exports = {
  run: () => cmdRun('run'),
  review: () => cmdRun('review'),
  solidify: cmdSolidify,
  status: cmdStatus,
  signals: cmdSignals,
  extractSignals,
  selectGene,
  buildEvolutionPrompt: require('./src/prompt').buildEvolutionPrompt,
};

if (require.main === module) {
  main();
}
