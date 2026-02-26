const fs = require('fs');
const path = require('path');

// --- 路径解析 ---

function findOpenClawRoot() {
  // 优先环境变量，否则向上查找 openclaw.json
  if (process.env.OPENCLAW_ROOT) return process.env.OPENCLAW_ROOT;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'openclaw.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '../..');
}

const OPENCLAW_ROOT = findOpenClawRoot();

const PATHS = {
  root: OPENCLAW_ROOT,
  workspace: path.join(OPENCLAW_ROOT, 'workspace'),
  memory: path.join(OPENCLAW_ROOT, 'workspace', 'memory'),
  evolution: path.join(OPENCLAW_ROOT, 'workspace', 'evolution'),
  genes: path.join(OPENCLAW_ROOT, 'workspace', 'evolution', 'genes.json'),
  events: path.join(OPENCLAW_ROOT, 'workspace', 'evolution', 'events.jsonl'),
  state: path.join(OPENCLAW_ROOT, 'workspace', 'evolution', 'state.json'),
  pending: path.join(OPENCLAW_ROOT, 'workspace', 'evolution', 'pending.md'),
  soulMd: path.join(OPENCLAW_ROOT, 'workspace', 'SOUL.md'),
  agentsMd: path.join(OPENCLAW_ROOT, 'workspace', 'AGENTS.md'),
  memoryMd: path.join(OPENCLAW_ROOT, 'workspace', 'MEMORY.md'),
  lessonsMd: path.join(OPENCLAW_ROOT, 'workspace', 'memory', 'lessons.md'),
  projectsMd: path.join(OPENCLAW_ROOT, 'workspace', 'memory', 'projects.md'),
};

// --- 安全约束 ---

const SAFETY = {
  // 允许进化修改的文件路径（相对于 workspace）
  allowedPaths: [
    'memory/',
    'evolution/',
    'HEARTBEAT.md',
    'TOOLS.md',
  ],
  // 绝对禁止修改的文件
  forbiddenFiles: [
    'SOUL.md',
    'IDENTITY.md',
    'USER.md',
    'MEMORY.md',
    'AGENTS.md',
  ],
  // 每次进化最大影响范围
  maxBlastRadius: {
    files: 5,
    lines: 200,
  },
  // 连续失败阈值 - 超过后强制暂停
  maxConsecutiveFailures: 3,
};

// --- 进化策略 ---

const STRATEGY = {
  // 信号优先级：repair > optimize > innovate
  intentPriority: ['repair', 'optimize', 'innovate'],
  // 最近 N 天的日志参与信号提取
  logWindowDays: 7,
  // 最近 N 条事件参与历史分析
  recentEventCount: 10,
  // 基因匹配最低分数
  minGeneScore: 1,
  // 去重：同一信号在最近 N 次进化中出现超过此次数则抑制
  signalSuppressionThreshold: 3,
  signalSuppressionWindow: 8,
};

// --- 工具函数 ---

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, obj) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

function readFileSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  PATHS,
  SAFETY,
  STRATEGY,
  ensureDir,
  readJsonSafe,
  writeJsonAtomic,
  readFileSafe,
  nowIso,
  todayStr,
};
