const fs = require('fs');
const path = require('path');
const { PATHS, STRATEGY, readFileSafe, todayStr } = require('./config');

// --- 信号定义 ---

// 错误类信号（触发 repair）
const ERROR_PATTERNS = [
  { pattern: /\[error\]|error:|exception:|报错|异常|失败[：:]/i, signal: 'log_error' },
  { pattern: /timeout|timed?\s*out|超时/i, signal: 'timeout_error' },
  { pattern: /ECONNREFUSED|ENOTFOUND|连接失败|连接拒绝/i, signal: 'connection_error' },
  { pattern: /permission denied|权限不足|EACCES/i, signal: 'permission_error' },
  { pattern: /out of memory|OOM|内存不足/i, signal: 'memory_error' },
  { pattern: /syntax\s*error|语法错误/i, signal: 'syntax_error' },
];

// 机会类信号（触发 innovate）
const OPPORTUNITY_PATTERNS = [
  { pattern: /加个|实现一下|做个|想要|需要一个|帮我加|新增|加个功能/u, signal: 'user_feature_request' },
  { pattern: /\b(add|implement|create|build)\b[^.]{3,80}\b(feature|function|tool|command)\b/i, signal: 'user_feature_request' },
  { pattern: /改进|优化一下|简化|重构|整理|弄得更好/u, signal: 'user_improvement' },
  { pattern: /\b(improve|enhance|refactor|simplify|clean\s*up)\b/i, signal: 'user_improvement' },
  { pattern: /太慢|性能|卡顿|bottleneck|slow|latency/iu, signal: 'perf_bottleneck' },
  { pattern: /不支持|没法|cannot|not\s*supported|missing\s*feature/iu, signal: 'capability_gap' },
];

// 重复模式信号（触发 optimize）
const REPETITION_PATTERNS = [
  { pattern: /又遇到|再次|same\s*issue|again|重复/iu, signal: 'recurring_issue' },
  { pattern: /每次都要|手动|manual|repetitive|重复操作/iu, signal: 'automation_opportunity' },
];

/**
 * 获取最近 N 天的日志文件路径
 */
function getRecentLogPaths(days) {
  const paths = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const logPath = path.join(PATHS.memory, `${dateStr}.md`);
    if (fs.existsSync(logPath)) {
      paths.push({ date: dateStr, path: logPath });
    }
  }
  return paths;
}

/**
 * 从文本中提取错误签名（用于去重和追踪）
 */
function extractErrorSignature(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/(?:TypeError|ReferenceError|SyntaxError|Error)\s*:\s*(.{10,200})/i);
    if (match) return match[1].trim().slice(0, 150);
    const zhMatch = line.match(/(?:错误|异常|报错)\s*[：:]\s*(.{5,200})/u);
    if (zhMatch) return zhMatch[1].trim().slice(0, 150);
  }
  return null;
}

/**
 * 统计文本中模式出现次数
 */
function countPattern(text, pattern) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags + 'g'));
  return matches ? matches.length : 0;
}

/**
 * 从日志和记忆中提取结构化信号
 */
function extractSignals() {
  const signals = [];
  const logPaths = getRecentLogPaths(STRATEGY.logWindowDays);

  // 收集所有文本
  let corpus = '';
  for (const lp of logPaths) {
    corpus += readFileSafe(lp.path, '') + '\n';
  }
  const lessons = readFileSafe(PATHS.lessonsMd, '');
  const projects = readFileSafe(PATHS.projectsMd, '');
  corpus += lessons + '\n' + projects;

  if (!corpus.trim()) {
    signals.push({ type: 'no_data', detail: '没有找到最近的日志数据', source: 'system' });
    return signals;
  }

  // 错误信号
  for (const ep of ERROR_PATTERNS) {
    const count = countPattern(corpus, ep.pattern);
    if (count > 0) {
      signals.push({
        type: ep.signal,
        count,
        detail: `检测到 ${count} 次匹配`,
        source: 'logs',
        category: 'error',
      });
    }
  }

  // 错误签名提取
  const errSig = extractErrorSignature(corpus);
  if (errSig) {
    signals.push({
      type: 'error_signature',
      detail: errSig,
      source: 'logs',
      category: 'error',
    });
  }

  // 重复错误检测
  const errorLines = corpus.split('\n').filter(l =>
    /\[error\]|error:|exception:|报错|异常|失败[：:]/i.test(l)
  );
  const errorCounts = {};
  for (const line of errorLines) {
    const key = line.replace(/\s+/g, ' ').trim().slice(0, 100);
    errorCounts[key] = (errorCounts[key] || 0) + 1;
  }
  const recurring = Object.entries(errorCounts).filter(([, c]) => c >= 3);
  if (recurring.length > 0) {
    signals.push({
      type: 'recurring_error',
      detail: `${recurring.length} 个重复错误模式，最高频: "${recurring[0][0]}" (${recurring[0][1]}次)`,
      source: 'logs',
      category: 'error',
    });
  }

  // 机会信号
  for (const op of OPPORTUNITY_PATTERNS) {
    if (op.pattern.test(corpus)) {
      // 提取上下文片段
      const match = corpus.match(new RegExp('.{0,60}' + op.pattern.source + '.{0,60}', op.pattern.flags));
      signals.push({
        type: op.signal,
        detail: match ? match[0].replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        source: 'logs',
        category: 'opportunity',
      });
    }
  }

  // 重复模式信号
  for (const rp of REPETITION_PATTERNS) {
    if (rp.pattern.test(corpus)) {
      const match = corpus.match(new RegExp('.{0,60}' + rp.pattern.source + '.{0,60}', rp.pattern.flags));
      signals.push({
        type: rp.signal,
        detail: match ? match[0].replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        source: 'logs',
        category: 'optimize',
      });
    }
  }

  // 日志健康度信号
  if (logPaths.length === 0) {
    signals.push({ type: 'no_recent_logs', detail: '最近 7 天没有日志', source: 'system', category: 'warning' });
  } else if (logPaths.length < 3) {
    signals.push({ type: 'sparse_logs', detail: `最近 7 天只有 ${logPaths.length} 天有日志`, source: 'system', category: 'warning' });
  }

  // 教训文件检查
  if (!lessons.trim() || lessons.includes('暂无')) {
    signals.push({ type: 'empty_lessons', detail: 'lessons.md 为空，尚未积累教训', source: 'system', category: 'info' });
  }

  // 如果没有任何可操作信号，标记为稳定
  const actionable = signals.filter(s => s.category === 'error' || s.category === 'opportunity' || s.category === 'optimize');
  if (actionable.length === 0) {
    signals.push({ type: 'stable', detail: '系统稳定，无明显问题或机会', source: 'system', category: 'info' });
  }

  // 去重
  const seen = new Set();
  return signals.filter(s => {
    const key = s.type + ':' + (s.detail || '').slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 根据信号决定进化意图
 */
function determineIntent(signals) {
  const hasError = signals.some(s => s.category === 'error');
  const hasOpportunity = signals.some(s => s.category === 'opportunity');
  const hasOptimize = signals.some(s => s.category === 'optimize');

  if (hasError) return 'repair';
  if (hasOpportunity) return 'innovate';
  if (hasOptimize) return 'optimize';
  return 'idle';
}

/**
 * 根据历史事件抑制过度处理的信号
 */
function suppressOverprocessed(signals, recentEvents) {
  if (!Array.isArray(recentEvents) || recentEvents.length === 0) return signals;

  const window = recentEvents.slice(-STRATEGY.signalSuppressionWindow);
  const freq = {};
  for (const evt of window) {
    const sigs = Array.isArray(evt.signals) ? evt.signals : [];
    for (const s of sigs) {
      const key = typeof s === 'string' ? s : s.type;
      freq[key] = (freq[key] || 0) + 1;
    }
  }

  const suppressed = new Set();
  for (const [key, count] of Object.entries(freq)) {
    if (count >= STRATEGY.signalSuppressionThreshold) suppressed.add(key);
  }

  if (suppressed.size === 0) return signals;

  const filtered = signals.filter(s => !suppressed.has(s.type));

  // 如果全部被抑制，注入停滞信号
  if (filtered.length === 0 || filtered.every(s => s.category === 'info' || s.category === 'warning')) {
    filtered.push({
      type: 'evolution_stagnation',
      detail: `信号 [${[...suppressed].join(', ')}] 已被处理多次，需要新方向`,
      source: 'system',
      category: 'opportunity',
    });
  }

  return filtered;
}

module.exports = {
  extractSignals,
  determineIntent,
  suppressOverprocessed,
  getRecentLogPaths,
};
