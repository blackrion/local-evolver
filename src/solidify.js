const fs = require('fs');
const path = require('path');
const { PATHS, SAFETY, ensureDir, readJsonSafe, writeJsonAtomic, readFileSafe, nowIso } = require('./config');
const { upsertGene, recordGeneOutcome } = require('./genes');

/**
 * 读取所有进化事件
 */
function readEvents() {
  ensureDir(PATHS.evolution);
  if (!fs.existsSync(PATHS.events)) return [];
  try {
    const raw = fs.readFileSync(PATHS.events, 'utf8');
    return raw.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 追加进化事件
 */
function appendEvent(event) {
  ensureDir(PATHS.evolution);
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(PATHS.events, line, 'utf8');
}

/**
 * 读取进化状态
 */
function readState() {
  return readJsonSafe(PATHS.state, {
    version: 1,
    last_run: null,
    consecutive_failures: 0,
    total_runs: 0,
    total_success: 0,
    total_failed: 0,
    total_skipped: 0,
    created_at: nowIso(),
  });
}

/**
 * 保存进化状态
 */
function saveState(state) {
  state.updated_at = nowIso();
  writeJsonAtomic(PATHS.state, state);
}

/**
 * 验证进化结果的安全性
 */
function validateSafety(result) {
  const errors = [];

  // 检查 blast radius
  if (result.blast_radius) {
    if (result.blast_radius.files > SAFETY.maxBlastRadius.files) {
      errors.push(`文件数 ${result.blast_radius.files} 超过限制 ${SAFETY.maxBlastRadius.files}`);
    }
    if (result.blast_radius.lines > SAFETY.maxBlastRadius.lines) {
      errors.push(`行数 ${result.blast_radius.lines} 超过限制 ${SAFETY.maxBlastRadius.lines}`);
    }
  }

  // 检查是否修改了禁止文件
  if (Array.isArray(result.files_changed)) {
    for (const f of result.files_changed) {
      const basename = path.basename(f);
      if (SAFETY.forbiddenFiles.includes(basename)) {
        errors.push(`禁止修改文件: ${f}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 解析 agent 输出中的 EvolutionResult JSON
 */
function parseEvolutionResult(text) {
  if (!text || typeof text !== 'string') return null;

  // 尝试从 ```json ... ``` 块中提取
  const jsonBlockMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonBlockMatch) {
    try {
      const obj = JSON.parse(jsonBlockMatch[1]);
      if (obj.type === 'EvolutionResult') return obj;
    } catch {}
  }

  // 尝试从裸 JSON 中提取
  const braceMatch = text.match(/\{[\s\S]*"type"\s*:\s*"EvolutionResult"[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {}
  }

  return null;
}

/**
 * 固化进化结果
 *
 * 接收 agent 产出的 EvolutionResult，验证安全性，
 * 更新基因库和事件日志。
 */
function solidify(result, opts) {
  const dryRun = opts && opts.dryRun;
  const state = readState();

  // 验证安全性
  const safety = validateSafety(result);
  if (!safety.ok) {
    const event = {
      id: `evt_${Date.now()}`,
      timestamp: nowIso(),
      intent: result.intent || 'unknown',
      gene_id: result.gene_id || null,
      signals: [],
      outcome: { status: 'failed', reason: `安全检查失败: ${safety.errors.join('; ')}` },
      blast_radius: result.blast_radius || { files: 0, lines: 0 },
    };

    if (!dryRun) {
      appendEvent(event);
      if (result.gene_id) recordGeneOutcome(result.gene_id, false);
      state.consecutive_failures = (state.consecutive_failures || 0) + 1;
      state.total_failed = (state.total_failed || 0) + 1;
      state.total_runs = (state.total_runs || 0) + 1;
      state.last_run = event;
      saveState(state);
    }

    return { ok: false, event, errors: safety.errors };
  }

  // 处理 skipped
  if (result.outcome && result.outcome.status === 'skipped') {
    const event = {
      id: `evt_${Date.now()}`,
      timestamp: nowIso(),
      intent: result.intent || 'idle',
      gene_id: result.gene_id || null,
      signals: [],
      outcome: { status: 'skipped', reason: result.outcome.reason || '无可操作信号' },
      blast_radius: { files: 0, lines: 0 },
    };

    if (!dryRun) {
      appendEvent(event);
      state.total_skipped = (state.total_skipped || 0) + 1;
      state.total_runs = (state.total_runs || 0) + 1;
      state.last_run = event;
      saveState(state);
    }

    return { ok: true, event, skipped: true };
  }

  // 构建事件
  const event = {
    id: `evt_${Date.now()}`,
    timestamp: nowIso(),
    intent: result.intent || 'unknown',
    gene_id: result.gene_id || null,
    summary: result.summary_zh || '',
    signals: [],
    outcome: result.outcome || { status: 'unknown' },
    blast_radius: result.blast_radius || { files: 0, lines: 0 },
    files_changed: result.files_changed || [],
    lesson: result.lesson || null,
  };

  const isSuccess = event.outcome.status === 'success';

  if (!dryRun) {
    // 记录事件
    appendEvent(event);

    // 更新基因成功/失败计数
    if (event.gene_id) {
      recordGeneOutcome(event.gene_id, isSuccess);
    }

    // 如果有新基因，加入基因库
    if (isSuccess && result.new_gene && result.new_gene.id) {
      upsertGene({
        ...result.new_gene,
        created_at: nowIso(),
        success_count: 1,
        fail_count: 0,
      });
    }

    // 如果有教训，追加到 lessons.md
    if (result.lesson && result.lesson.trim()) {
      appendLesson(result.lesson, event);
    }

    // 更新状态
    state.total_runs = (state.total_runs || 0) + 1;
    if (isSuccess) {
      state.total_success = (state.total_success || 0) + 1;
      state.consecutive_failures = 0;
    } else {
      state.total_failed = (state.total_failed || 0) + 1;
      state.consecutive_failures = (state.consecutive_failures || 0) + 1;
    }
    state.last_run = event;
    saveState(state);
  }

  return { ok: isSuccess, event };
}

/**
 * 追加教训到 lessons.md
 */
function appendLesson(lesson, event) {
  const current = readFileSafe(PATHS.lessonsMd, '');
  const header = current.includes('# 踩坑记录') ? '' : '# 踩坑记录\n\n';
  const cleaned = current.replace(/^# 踩坑记录\s*\n*/, '').replace(/_\(暂无.*?\)_\s*/g, '').trim();

  const entry = `### [${event.intent.toUpperCase()}] ${event.summary || '进化记录'} (${event.timestamp.slice(0, 10)})
- ${lesson}
- 基因: ${event.gene_id || '无'}
- 结果: ${event.outcome.status}
`;

  const newContent = `# 踩坑记录\n\n${entry}\n${cleaned ? cleaned + '\n' : ''}`;
  fs.writeFileSync(PATHS.lessonsMd, newContent, 'utf8');
}

/**
 * 检查是否应该暂停进化（连续失败过多）
 */
function shouldPause() {
  const state = readState();
  return (state.consecutive_failures || 0) >= SAFETY.maxConsecutiveFailures;
}

/**
 * 获取被 ban 的基因 ID（连续失败 2+ 次的）
 */
function getBannedGeneIds() {
  const events = readEvents();
  const recent = events.slice(-10);
  const banned = new Set();

  // 统计最近事件中每个基因的连续失败
  const geneFailStreak = {};
  for (const evt of recent) {
    if (!evt.gene_id) continue;
    if (evt.outcome && evt.outcome.status === 'failed') {
      geneFailStreak[evt.gene_id] = (geneFailStreak[evt.gene_id] || 0) + 1;
    } else {
      geneFailStreak[evt.gene_id] = 0;
    }
  }

  for (const [geneId, streak] of Object.entries(geneFailStreak)) {
    if (streak >= 2) banned.add(geneId);
  }

  return banned;
}

module.exports = {
  readEvents,
  appendEvent,
  readState,
  saveState,
  validateSafety,
  parseEvolutionResult,
  solidify,
  shouldPause,
  getBannedGeneIds,
};
