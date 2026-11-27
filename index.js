/**
 * dsh-aupdate
 *
 * 定时查询可更新的 DSH 插件 → 串行安装 → 借 hmr 服务就地换掉插件代码。全程不重启应用。
 *
 * 安全边界：
 *  - 只更新 registry 上的普通版本依赖；link: / file: / workspace: 一律跳过。
 *  - 安装严格串行（同一 profile 并行 pnpm 会抢锁失败）。
 *  - 热生效只用公开契约 reconcileProfile + runExclusive；服务不在就降级为「已装好，等重启」。
 *  - 有子任务在跑时不换代码（换了会把它们全部中止）。
 *  - 每个定时回调和启动项都包在 try 里：开机项抛错会让整个桌面壳退出。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

export const name = 'dsh-aupdate'

/**
 * 当前插件版本，直接读 package.json。
 *
 * 设置页的「关于 aupdate」要显示版本；写死在 client 里每次发版都得改两处，
 * 还容易忘。这里在模块加载时读一次，发版只改 package.json 就够了。
 */
let pluginVersion = '0.0.0'
try {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  if (typeof manifest.version === 'string' && manifest.version !== '') pluginVersion = manifest.version
} catch {
  // 读不到就显示 0.0.0，绝不让设置页因为一个版本号加载失败。
}

const LOG_MAX_BYTES = 1_000_000
/** 一次查询里同时在飞的 registry 请求数。 */
const FETCH_CONCURRENCY = 6
/** 单个包安装的上限；实测最慢 1m51s。 */
const INSTALL_TIMEOUT_MS = 420_000
/** 超过这个时长就写一条明确提示：别让人把网络重试误当成卡死。 */
const INSTALL_SLOW_MS = 120_000
const RELOAD_TIMEOUT_MS = 180_000
/** 这些包的 dist-tags.latest 落后于 next。 */
const NEXT_TAG_SCOPES = ['@deepseek-ai/dsh-']
const NPM_NAME_RE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu
/** 会话目录多久没写入才算「真的闲」。 */
const SESSION_IDLE_MINUTES = 2
/** 跨进程的安装锁：同一 profile 同时跑两个 pnpm 会抢锁失败。 */
const LOCK_STALE_MS = 30 * 60 * 1000

// 上一次运行结果从磁盘恢复。原来是纯内存的，DSH 一重启就没了：设置页明明刚装过
// 东西，却显示「还没跑过」——那是真的没记住，不是没跑。注意这是在模块加载期调用，
// 所以只能依赖函数声明（readLastRun/readJson 都提升），不能依赖下面的 const。
let lastRun = readLastRun()
let running = null

/**
 * 正在进行的这一轮的进度。
 *
 * 原来安装阶段只有开始/结束两条日志，中途 registry 超时重试好几分钟时界面上
 * 一片空白——用户以为卡死。这里把「装到第几个、哪个包」记成可查询状态，
 * /state 每次读都带上，设置页就能实时显示。
 */
let progress = null

function setProgress(value) {
  progress = value
}

function clearProgress() {
  progress = null
}

function oneLine(value, limit = 2000) {
  const text = String(value ?? '')
    .replace(/[\r\n\u2028\u2029]+/gu, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
  return text.length > limit ? text.slice(0, limit) + '\u2026' : text
}

function logPath() {
  const fromEnv = process.env.DSH_AUTO_UPDATE_LOG
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh', 'aupdate.log')
}

/**
 * 日志改成异步批量写。
 *
 * 原来每写一行都要 statSync + 判定 + appendFileSync，三个同步系统调用落在主线程上；
 * 一轮检查会写好几行，热重载时还会跟着 apply 连写。现在只把行推进队列，
 * 由一次 setImmediate 合批写盘，体积检查最多每 30 秒做一次。
 * 任何一步失败都只丢日志，不影响更新逻辑本身。
 */
let logDirTried = false
let logQueue = []
let logFlushing = false
let logCheckedAt = 0

function flushLog() {
  if (logQueue.length === 0) {
    logFlushing = false
    return
  }
  const payload = logQueue.join('')
  logQueue = []
  logFlushing = false
  const file = logPath()
  try {
    if (!logDirTried) {
      logDirTried = true
      mkdirSync(dirname(file), { recursive: true })
    }
    // 体积检查本来每行都做，现在最多 30 秒一次：日志超限不是实时需求。
    if (Date.now() - logCheckedAt > 30000) {
      logCheckedAt = Date.now()
      try {
        if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, file + '.old')
      } catch {}
    }
    appendFileSync(file, payload, 'utf8')
  } catch {
    // 落盘失败就算了，绝不能把日志问题抛进更新流程。
  }
}

/**
 * 结构化日志。
 *
 * 0.6.1 及以前是把成品句子写进文件：中文环境下写中文，那一刻语言就钉死了，
 * 之后在设置页切成 English，历史行仍然全是中文。要让日志跟着语言走，落盘的内容
 * 就不能是句子——这里改成写 code + 参数（一行一个 JSON 数组），等到读取时
 * 才按请求的语言渲染。想加一种语言只是多一张模板表。
 *
 * 兼容：旧格式的行是成品句子，解析失败就原样显示，不丢历史。
 */

/** 状态词。运行结果是数据（done/skipped/…），显示成哪种语言由读取侧决定。 */
const LOG_STATUS = {
  zh: {
    done: '完成', blocked: '已让开', failed: '失败', skipped: '已跳过', none: '无', ok: '成功',
    partial: '部分完成', busy: '正在跑', unavailable: '不可用', applying: '生效中',
    restart: '需重启', cancelled: '已取消',
  },
  en: {
    done: 'done', blocked: 'held off', failed: 'failed', skipped: 'skipped', none: 'none', ok: 'ok',
    partial: 'partly done', busy: 'busy', unavailable: 'unavailable', applying: 'applying',
    restart: 'restart needed', cancelled: 'cancelled',
  },
}

/** 设置项在日志里的名字：enabled / autoApply 这种字面量不该出现在面板上。 */
const LOG_FIELD_LABELS = {
  zh: {
    lang: '显示语言', enabled: '定时检查', autoApply: '自动安装', hotReload: '就地生效',
    checkOnStart: '启动先查', idleOnly: '忙时不动手', notify: '更新提醒',
    intervalMinutes: '检查间隔', firstDelayMinutes: '首次延迟', exclude: '不更新的包',
    allowMajor: '跨大版本', allowPrerelease: '预发布', scheduleMode: '调度方式',
    dailyAt: '每天时刻', everyHours: '每几小时', everyDays: '每几天',
    suppressHours: '失败抑制', maxPerCycle: '单轮上限', sessionIdleMinutes: '会话静默',
    historyRetentionDays: '更新记录保留', logRetentionDays: '运行日志保留',
  },
  en: {
    lang: 'display language', enabled: 'scheduled check', autoApply: 'auto-install',
    hotReload: 'apply in place', checkOnStart: 'check on start', idleOnly: 'hold while busy',
    notify: 'update notices', intervalMinutes: 'check interval', firstDelayMinutes: 'first delay',
    exclude: 'never-update list', allowMajor: 'major upgrades', allowPrerelease: 'prereleases',
    scheduleMode: 'schedule', dailyAt: 'time of day', everyHours: 'every N hours',
    everyDays: 'every N days', suppressHours: 'failure suppression', maxPerCycle: 'per-cycle cap',
    sessionIdleMinutes: 'session idle',
    historyRetentionDays: 'history retention', logRetentionDays: 'log retention',
  },
}

function makeLogTemplates(lang) {
  const S = LOG_STATUS[lang] ?? LOG_STATUS.zh
  const labels = LOG_FIELD_LABELS[lang] ?? LOG_FIELD_LABELS.zh
  const zh = lang !== 'en'
  const sep = zh ? '、' : ', '
  const status = (value) => S[String(value ?? '')] ?? String(value ?? '')
  const list = (value) => (Array.isArray(value) ? value.join(sep) : String(value ?? ''))
  const onOff = (value) => (zh ? (value === true ? '开' : '关') : (value === true ? 'on' : 'off'))
  return {
    raw: (text) => String(text ?? ''),
    checked: (n, u) => (zh ? `检查 ${n} 个插件，${u} 个可更新` : `Checked ${n} plugin(s), ${u} update(s) available`),
    capped: (max, left) => (zh ? `本轮限量装 ${max} 个，剩下 ${left} 个下一轮再装` : `Capped at ${max} install(s) this cycle; ${left} left for the next round`),
    skipInstall: (why) => (zh ? `跳过安装：${list(why)}` : `Skipped installing: ${list(why)}`),
    snapshotTaken: (dir, files) => (zh ? `已留快照 ${dir}（${list(files)}）` : `Snapshot saved to ${dir} (${list(files)})`),
    snapshotFailed: (msg) => (zh ? `留快照失败：${msg}` : `Snapshot failed: ${msg}`),
    tookOverLock: (minutes) => (zh ? `接管了一个已挂 ${minutes} 分钟的安装锁` : `Took over an install lock left for ${minutes} min`),
    install: (name, target, ok, detail) => (zh
      ? `安装 ${name}@${target} → ${ok ? '成功' : '失败：' + (detail || '')}`
      : `Installed ${name}@${target} → ${ok ? 'ok' : 'failed: ' + (detail || '')}`),
    hotApply: (state, reason) => (zh
      ? `就地生效 → ${status(state)}${reason ? '：' + reason : ''}`
      : `Hot apply → ${status(state)}${reason ? ': ' + reason : ''}`),
    cycle: (mode, state, reason) => (zh
      ? `本轮${mode === 'check' ? '检查' : '更新'} → ${status(state)}：${reason}`
      : `Cycle ${mode === 'check' ? 'check' : 'update'} → ${status(state)}: ${reason}`),
    cycleFailed: (reason) => (zh ? `本轮失败：${reason}` : `Cycle failed: ${reason}`),
    cycleThrew: (msg) => (zh ? `本轮抛错：${msg}` : `Cycle threw: ${msg}`),
    rollback: (name, from, to, ok, detail) => (zh
      ? `回滚 ${name} ${to} → ${from} → ${ok ? '成功' : '失败：' + (detail || '')}`
      : `Rolled back ${name} ${to} → ${from} → ${ok ? 'ok' : 'failed: ' + (detail || '')}`),
    rollbackRequest: (name, ok, reason) => (zh
      ? `收到回滚请求 ${name} → ${ok ? '成功' : '失败：' + (reason || '')}`
      : `Rollback requested for ${name} → ${ok ? 'ok' : 'failed: ' + (reason || '')}`),
    settingsChanged: (keys) => (zh
      ? `设置页改了：${list((Array.isArray(keys) ? keys : []).map((key) => labels[key] ?? String(key)))}`
      : `Settings changed: ${list((Array.isArray(keys) ? keys : []).map((key) => labels[key] ?? String(key)))}`),
    rescheduleFailed: (msg) => (zh ? `重排定时失败：${msg}` : `Rescheduling failed: ${msg}`),
    toolFailed: (msg) => (zh ? `工具调用失败：${msg}` : `Tool call failed: ${msg}`),
    toolUnavailable: (msg) => (zh ? `无法提供工具：${msg}` : `Could not offer the tool: ${msg}`),
    toolRegistered: (ok) => (zh ? `工具注册：${ok ? '成功' : '失败'}` : `Tool registered: ${ok ? 'ok' : 'failed'}`),
    toolRegisterThrew: (msg) => (zh ? `注册工具时抛错：${msg}` : `Tool registration threw: ${msg}`),
    routeFailed: (msg) => (zh ? `接口处理出错：${msg}` : `Route failed: ${msg}`),
    routeReady: (prefix) => (zh ? `设置接口已就绪：${prefix}` : `Settings route ready: ${prefix}`),
    routeReadyNoScope: (prefix) => (zh ? `设置接口已就绪（没有 effect 作用域）：${prefix}` : `Settings route ready (no effect scope): ${prefix}`),
    routeRegisterFailed: (msg) => (zh ? `无法注册设置接口：${msg}` : `Could not register the settings route: ${msg}`),
    routeRegisterThrew: (msg) => (zh ? `注册设置接口时抛错：${msg}` : `Route registration threw: ${msg}`),
    webServerMissing: () => (zh ? '没有 webServer 服务，设置页会显示不可用' : 'No webServer service; the settings page will report it'),
    toolScopeEnded: (msg) => (zh ? `工具作用域已结束：${msg}` : `Tool scope ended: ${msg}`),
    disabledBySettings: () => (zh ? '设置里已关闭自动更新，定时器待命' : 'Auto-update is off in settings; scheduler parked'),
    disabledByConfig: () => (zh ? '配置里已关闭自动更新，定时器待命，设置页仍然可用' : 'Auto-update is off in config; scheduler parked, settings page stays live'),
    // 清理日志按对象报数，几个数字一处说完，免得刷三行。
    // 安装进度：N/M 个 + 包名，超时时也给出上一包的明确提示。
    installing: (n, total, name) => (zh
      ? `正在安装第 ${n}/${total} 个：${name}`
      : `Installing ${n}/${total}: ${name}`),
    installTimeout: (name, minutes) => (zh
      ? `${name} 安装超过 ${minutes} 分钟仍没结束，等本包收尾后继续`
      : `${name} has been installing for over ${minutes} min; will continue when it finishes`),
    cleaned: (kind, rows, days) => (zh
      ? `清理${kind}：删掉 ${rows} 条超过 ${days} 天的`
      : `Cleaned ${kind}: removed ${rows} entr${rows === 1 ? 'y' : 'ies'} older than ${days} day(s)`),
    cleanSkipped: (kind) => (zh ? `${kind}没有需要清理的` : `Nothing to clean in ${kind}`),
    compatBlocked: (name, version, range, dsh) => (zh
      ? `${name}@${version} 跳过：要求 DSH ${range}，当前 ${dsh}`
      : `${name}@${version} skipped: needs DSH ${range}, host is ${dsh}`),
    mirrorLag: (name, upstream, mirror) => (zh
      ? `${name} 镜像落后：镜像 ${mirror}，官方 ${upstream}`
      : `${name} mirror lag: mirror ${mirror}, upstream ${upstream}`),
    registryPicked: (source) => (zh ? `安装源：${source}` : `Registry: ${source}`),
    settingsDropped: (keys) => (zh
      ? `这些设置没存下来（没有对应的校验分支）：${keys.join(', ')}`
      : `These settings were not stored (no validation branch): ${keys.join(', ')}`),
    switching: (name, from, to) => (zh
      ? '切换版本：' + name + ' ' + from + ' → ' + to
      : 'Switching: ' + name + ' ' + from + ' → ' + to),
    switched: (name, from, to) => (zh
      ? '已切换：' + name + ' ' + from + ' → ' + to
      : 'Switched: ' + name + ' ' + from + ' → ' + to),
    reloaded: (status, reason) => (zh
      ? '就地生效：' + status + (reason ? '（' + reason + '）' : '')
      : 'Apply in place: ' + status + (reason ? ' (' + reason + ')' : '')),
    ready: (minutes, autoApply, hotReload) => (zh
      ? `已就绪：每 ${minutes} 分钟检查一次，自动安装=${onOff(autoApply)}，就地生效=${onOff(hotReload)}`
      : `Ready: every ${minutes} min, autoApply=${onOff(autoApply)}, hotReload=${onOff(hotReload)}`),
  }
}

const LOG_TEMPLATES = { zh: makeLogTemplates('zh'), en: makeLogTemplates('en') }

/**
 * 原因事件。
 *
 * 运行结果里的「为什么没装 / 为什么不动手」以前直接拼成中文句子：写进 lastRun、
 * 拼进 report.reason、再喂给日志。语言一换，这些句子就是不动的中文，跟日志正文
 * 对不上。所以原因也照日志的做法拆成 { code, args }，渲染时才决定语言。
 *
 * 自由文本（pnpm 的报错、锁持有者、宿主给的 restart 原因）仍然是字符串：
 * 那些不是我们写的话，翻译不了，原样透出比乱翻更诚实。
 */
function makeReasonTemplates(lang) {
  const zh = lang !== 'en'
  const sep = zh ? '；' : '; '
  const ageText = (age) => {
    if (typeof age !== 'number' || !Number.isFinite(age)) return zh ? '刚才' : 'just now'
    return age < 1 ? (zh ? '不到 1' : 'under 1') : String(Math.round(age))
  }
  return {
    raw: (msg) => String(msg ?? ''),
    uncomparable: () => (zh ? '版本号无法比较' : 'Versions are not comparable'),
    latest: () => (zh ? '已经是最新' : 'Already up to date'),
    prerelease: () => (zh ? '是预发布版本，未允许' : 'Prerelease, not allowed'),
    major: (from, to) => (zh ? `跨大版本（${from} -> ${to}），未允许` : `Major version change (${from} -> ${to}), not allowed`),
    noTag: (tag) => (zh ? `没有 ${tag} 标签` : `No ${tag} tag`),
    noInstalled: () => (zh ? '读不到已装版本' : 'Installed version unreadable'),
    suppressed: (stamp) => (zh ? `上次安装失败，${stamp} UTC 前不再重试` : `Install failed before; not retried until ${stamp} UTC`),
    lookupFailed: (msg) => (zh ? `查不到：${msg}` : `Lookup failed: ${msg}`),
    compatBlocked: (version, range, dsh) => (zh
      ? `${version} 要求 DSH ${range}，当前宿主是 ${dsh}，没装`
      : `${version} needs DSH ${range}; this host is ${dsh}, not installed`),
    incompatible: (range, dsh) => (zh
      ? `已装的版本要求 DSH ${range}，当前宿主是 ${dsh}`
      : `The installed version needs DSH ${range}; this host is ${dsh}`),
    mirrorLag: (upstream, mirror) => (zh
      ? `镜像还停在 ${mirror}，官方源已经是 ${upstream}`
      : `The mirror still has ${mirror}; upstream is at ${upstream}`),
    agentsBusy: (n) => (zh ? `${n} 个子任务在跑` : `${n} subagent(s) running`),
    sessionActive: (age) => (zh ? `会话在 ${ageText(age)} 分钟前还在写入` : `Session was written ${ageText(age)} min ago`),
    noDeps: () => (zh ? '这个 profile 里没有可检查的依赖' : 'No dependencies to check in this profile'),
    noUpdates: () => (zh ? '没有可更新的插件' : 'No updatable plugins'),
    checkOnly: () => (zh ? '只查不装' : 'Check only'),
    gated: (reasons) => (zh
      ? `${listOf(reasons, sep)}，这一轮不安装`
      : `${listOf(reasons, sep)} — not installing this cycle`),
    noCli: () => (zh ? '找不到 dsh 命令行入口，无法安装' : 'dsh CLI entry not found; cannot install'),
    noneInstalled: () => (zh ? '一个包都没装成' : 'No package installed successfully'),
    installedRestart: (n) => (zh ? `已安装 ${n} 个，待重启` : `Installed ${n}; restart pending`),
    installedNoHot: (n) => (zh ? `已安装 ${n} 个，未热生效` : `Installed ${n}; not applied in place`),
    installedWith: (n, reason) => (zh ? `已安装 ${n} 个；${reason}` : `Installed ${n}; ${reason}`),
    reloadUnavailable: () => (zh ? '这里没有能换插件的服务，已装好但要重启才生效' : 'No hot-reload service here; installed, applies after restart'),
    reloadApplying: () => (zh ? '换代码还没结束，稍后再看一次' : 'Hot apply still running; check again shortly'),
    reloadQueued: () => (zh ? '换代码还在排队，稍后再看一次' : 'Hot apply still queued; check again shortly'),
    reloadDone: () => (zh ? '插件已换好，界面没重开' : 'Plugins swapped; page not reloaded'),
    reloadOff: () => (zh ? '装好了，热生效是关的，重启后生效' : 'Installed; in-place apply is off, applies after restart'),
    reloadCancelled: () => (zh ? '安装期间有子任务开跑，这一次不换代码' : 'A subagent started during install; not swapping code'),
    rollbackRestart: () => (zh ? '回滚完成，重启后生效' : 'Rollback done; applies after restart'),
    lockHeld: (holder, age) => (zh
      ? `另一个进程正在装（${holder || '看不见持有者'}${typeof age === 'number' ? `，${age} 分钟前` : ''}）`
      : `Another process is installing (${holder || 'holder unknown'}${typeof age === 'number' ? `, ${age} min ago` : ''})`),
    lockFailed: (msg) => (zh ? `抢锁失败：${msg}` : `Could not take the install lock: ${msg}`),
    rollbackNoRecord: (name) => (zh ? `没有可回滚的记录：${name}` : `Nothing to roll back: ${name}`),
    runBusy: () => (zh ? '上一轮还没跑完' : 'The previous cycle is still running'),
    neverRun: () => (zh ? '还没跑过' : 'Never run'),
    lastSummary: (at, reason) => (zh ? `上一次：${at}；${reason}` : `Last run: ${at}; ${reason}`),
    stateBroken: () => (zh ? '没能完成，插件状态需要核对' : 'Did not finish; plugin state needs a check'),
    alreadyRunning: () => (zh ? '已经有一轮在跑' : 'A cycle is already running'),
  }
}

const REASON_TEMPLATES = { zh: makeReasonTemplates('zh'), en: makeReasonTemplates('en') }

function listOf(value, sep) {
  if (Array.isArray(value)) return value.filter((item) => item !== '').join(sep)
  return value === undefined || value === null ? '' : String(value)
}

/** 把参数里的原因对象就地翻成文字；数组要深挖，原因里可能嵌着原因。 */
function localizeArg(value, lang) {
  if (Array.isArray(value)) return value.map((item) => localizeArg(item, lang))
  if (value !== null && typeof value === 'object') {
    if (typeof value.code === 'string') return renderReason(value, lang)
    return value
  }
  return value
}

/**
 * 渲染一条原因。字符串原样返回——那是我们翻译不了的自由文本。
 */
function renderReason(value, lang) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const code = typeof value.code === 'string' ? value.code : ''
  const table = REASON_TEMPLATES[logLangOf(lang)]
  const render = table[code]
  const args = Array.isArray(value.args) ? value.args.map((item) => localizeArg(item, lang)) : []
  if (typeof render !== 'function') return '[' + code + '] ' + args.join(' ')
  try {
    return render(...args)
  } catch {
    return '[' + code + '] ' + args.join(' ')
  }
}

/** 只认 zh / en；其余（含 undefined）按中文渲染。 */
function logLangOf(choice) {
  return choice === 'en' ? 'en' : 'zh'
}

/** 渲染一条日志。认不出的 code 退化成一串参数，至少不丢信息。 */
function renderLogEntry(code, args, lang) {
  const table = LOG_TEMPLATES[logLangOf(lang)]
  // 参数里可能塞着原因对象（例如 skipInstall 的 why），先翻成文字再套模板。
  const values = (Array.isArray(args) ? args : []).map((item) => localizeArg(item, lang))
  const render = table[String(code)]
  if (typeof render !== 'function') return '[' + String(code) + '] ' + values.join(' ')
  try {
    return render(...values)
  } catch {
    return '[' + String(code) + '] ' + values.join(' ')
  }
}

/**
 * 写一条日志。
 *
 * @param code 模板名（见 makeLogTemplates），不是成品句子。
 * @param args 模板参数；自由文本走 raw。
 */
function writeLog(code, args = []) {
  const values = Array.isArray(args) ? args : []
  try {
    // 控制台固定中文：那是给开发者看的，跟界面语言无关。
    console.log('[dsh-aupdate] ' + oneLine(renderLogEntry(code, values, 'zh'), 400))
  } catch {}
  try {
    logQueue.push('[' + new Date().toISOString() + '] ' + oneLine(JSON.stringify([String(code), ...values])) + '\n')
    // 队列异常长说明写盘一直失败，直接丢掉最老的，避免吃内存。
    if (logQueue.length > 500) logQueue = logQueue.slice(-500)
    if (!logFlushing) {
      logFlushing = true
      setImmediate(flushLog).unref?.()
    }
  } catch {}
}

/** 进程要退出时把队列里剩下的写完，否则最后几行会丢。 */
function flushLogNow() {
  try {
    flushLog()
  } catch {}
}

/** 设置页最多回看多少行。再多就不该在这个面板里看了，直接开文件。 */
const LOG_TAIL_MAX_LINES = 1000

/**
 * 读日志尾部给设置页看。
 *
 * 日志文件满 1MB 就轮转成 .old，整份读进来再切尾巴比拼 offset 简单得多，
 * 代价也就是一次 1MB 的同步读。读之前先把待写队列刷下去，否则「刚点了检查、
 * 面板里却没有这一行」——差的就是 setImmediate 那一拍。
 * 读不到不算错误：可能从没跑过检查，也可能用户把文件删了。
 */
function readLogTail(limit, lang) {
  try {
    flushLogNow()
  } catch {}
  const file = logPath()
  const want = Math.min(Math.max(Math.floor(Number(limit)) || 200, 1), LOG_TAIL_MAX_LINES)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { path: file, exists: false, size: 0, total: 0, rows: [], rotated: existsSync(file + '.old') }
  }
  const all = raw.split('\n')
  // 每个进程都会补换行，split 后末尾必然多一个空串。
  if (all.length > 0 && all[all.length - 1] === '') all.pop()
  const rows = []
  const wanted = logLangOf(lang)
  for (const line of all.slice(-want)) {
    const match = /^\[([^\]]+)\] ([\s\S]*)$/u.exec(line)
    if (match === null) {
      rows.push({ at: '', text: line })
      continue
    }
    const body = match[2]
    // 新格式是 JSON 数组；0.6.1 及更早写的是成品句子，解析不出就原样显示。
    let parsed = null
    if (body.startsWith('[')) {
      try { parsed = JSON.parse(body) } catch {}
    }
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      rows.push({ at: match[1], text: renderLogEntry(parsed[0], parsed.slice(1), wanted) })
    } else {
      rows.push({ at: match[1], text: body })
    }
  }
  let size = 0
  try {
    size = statSync(file).size
  } catch {}
  return { path: file, exists: true, size, total: all.length, rows, rotated: existsSync(file + '.old') }
}

/** 防御性读属性：Cordis 对未声明的读会抛。 */
function propOf(target, key) {
  try {
    return target?.[key]
  } catch {
    return undefined
  }
}

function serviceOf(ctx, key) {
  // 有 reflect 就先走 reflect.get：cordis 4 的 ctx 是 Proxy，裸读（以及 ctx.get）
  // 碰未在 inject 里声明的服务会抛 "cannot get property without inject"，而不是
  // 返回 undefined。connection 正是那种没声明的服务，用 ctx.get 会被我们自己的
  // catch 吞成 null，于是每个请求都判成 503。
  try {
    const reflect = propOf(ctx, 'reflect')
    if (reflect !== undefined && reflect !== null && typeof reflect.get === 'function') {
      return reflect.get(key) ?? null
    }
  } catch {}
  try {
    return (typeof ctx?.get === 'function' ? ctx.get(key) : undefined) ?? null
  } catch {
    return null
  }
}

function numberSetting(config, key, fallback, min, max) {
  const raw = config?.[key]
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function booleanSetting(config, key, fallback) {
  const value = config?.[key]
  if (value === undefined || value === null) return fallback
  return typeof value === 'boolean' ? value : false
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const rows = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    // 设置页是手输的，前后空格一定有；重复项也去掉，免得白名单看起来比实际多。
    const text = item.trim()
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    rows.push(text)
  }
  return rows
}

/**
 * 设置覆盖层。
 *
 * 设置页是客户端代码，它没法直接改宿主的 config 对象，所以把用户改过的项写进
 * 这个 JSON；settingsOf 读的时候叠在 config 之上。只有设置页写过的键才在文件里，
 * 其余仍然走 config / 默认值，两边不会互相打架。
 *
 * 读文件带 mtime 缓存：settingsOf 每轮都会调用，不做缓存等于每轮读一次盘。
 */
function settingsPath() {
  const fromEnv = process.env.DSH_AUPDATE_SETTINGS
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh', 'aupdate-settings.json')
}

const OVERRIDEABLE = [
  'enabled', 'autoApply', 'hotReload', 'checkOnStart', 'idleOnly', 'notify',
  'intervalMinutes', 'firstDelayMinutes', 'exclude',
  'allowMajor', 'allowPrerelease',
  // 安装源与兼容性预检（0.8.0 借自 dsh-plugin-upgrader）。
  'registryMode', 'registryUrl', 'compatCheck',
  // 调度：四种节奏 + 失败抑制时长。这些键不写进 Config schema，
  // 只活在覆盖层里——Config 的字段类型是宿主校验的，加错一个类型
  // 会在加载期直接抛错，而覆盖层是我们自己的文件，改坏了只影响这一项。
  'scheduleMode', 'dailyAt', 'everyHours', 'everyDays', 'suppressHours',
  // 界面显示语言。存这里而不是浏览器里：换台机器、换个浏览器打开，选择还在。
  'lang',
  // 效率闸门：一轮最多装几个、会话多静才算闲。
  'maxPerCycle', 'sessionIdleMinutes',
  // 更新记录 / 运行日志 / 快照的保留期限（天）。0 = 永不清理。
  'historyRetentionDays', 'logRetentionDays',
]

/** 四种调度模式。minutes 是原来的「间隔 N 分钟」，其余照抄竞品。 */
const SCHEDULE_MODES = ['minutes', 'hours', 'days', 'daily']

/**
 * 保留期限。默认 3 天——记录主要是「刚才装坏了什么」的现场，放太久只会占空间、
 * 还会让更新记录栏翻很久。0 表示永不自动清理。
 *
 * 这是天数不是毫秒：设置页传 3 就是 3 天，写入时钳到 [0, 3650]。
 */
const RETENTION_CHOICES = [1, 3, 7, 30, 90, 0]

function retentionOf(config, key, fallback) {
  const value = Number(config?.[key])
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 0), 3650)
}

/**
 * 界面语言。auto = 跟随系统（中文环境给中文，其余给英文）。
 *
 * 之所以要存到设置层而不是只留在 localStorage：这个值决定整页文案，
 * 换个浏览器或换台机器打开设置页时，用户不该再选一次。
 */
const LANG_CHOICES = ['auto', 'zh', 'en']

function langOf(config) {
  const text = typeof config?.lang === 'string' ? config.lang.trim().toLowerCase() : ''
  return LANG_CHOICES.includes(text) ? text : 'auto'
}

/** 数值型覆盖项的边界：写坏了钳进范围，而不是让设置页把插件配废。 */
const NUMBER_BOUNDS = {
  intervalMinutes: [10, 10080],
  firstDelayMinutes: [0, 1440],
  everyHours: [1, 168],
  everyDays: [1, 30],
  suppressHours: [0, 720],
  maxPerCycle: [0, 50],
  sessionIdleMinutes: [0, 120],
  historyRetentionDays: [0, 3650],
  logRetentionDays: [0, 3650],
}

let overrideCache = { stamp: null, value: {} }

function readOverrides() {
  const file = settingsPath()
  let stamp = 'missing'
  try {
    const info = statSync(file)
    stamp = info.mtimeMs + ':' + info.size
  } catch {
    // 文件不存在是正常状态：用户还没改过任何设置。
    overrideCache = { stamp: 'missing', value: {} }
    return overrideCache.value
  }
  if (overrideCache.stamp === stamp) return overrideCache.value
  const raw = readJson(file)
  const value = {}
  if (raw !== null && typeof raw === 'object') {
    for (const key of OVERRIDEABLE) {
      if (raw[key] !== undefined) value[key] = raw[key]
    }
  }
  overrideCache = { stamp, value }
  return value
}

/**
 * 只落盘校验过的字段：设置页传什么都可能，写坏了下次读出来会把插件配废。
 */
function writeOverrides(patch) {
  const current = { ...readOverrides() }
  const next = { ...current }
  for (const key of OVERRIDEABLE) {
    if (patch === null || typeof patch !== 'object' || patch[key] === undefined) continue
    const raw = patch[key]
    if (key === 'exclude') {
      next[key] = stringList(raw)
      continue
    }
    if (key === 'dailyAt') {
      const text = typeof raw === 'string' ? raw.trim() : ''
      if (!/^([01]?\d|2[0-3]):([0-5]\d)$/u.test(text)) continue
      const [hour, minute] = text.split(':')
      next[key] = String(hour).padStart(2, '0') + ':' + minute
      continue
    }
    if (key === 'scheduleMode') {
      const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      if (SCHEDULE_MODES.includes(text)) next[key] = text
      continue
    }
    if (key === 'lang') {
      const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      if (LANG_CHOICES.includes(text)) next[key] = text
      continue
    }
    // 安装源。这两个键是字符串，而下面的兜底只认布尔——0.7.5 到 0.8.3 它们就是
    // 这样「保存成功、文件里没有」的：POST 返回 200、日志记了 settingsChanged，
    // 界面上却又弹回默认值。凡是新增字符串键，都必须在这里有一支，没有就被丢掉。
    if (key === 'registryMode') {
      const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      if (REGISTRY_MODES.includes(text)) next[key] = text
      continue
    }
    if (key === 'registryUrl') {
      const text = typeof raw === 'string' ? raw.trim().replace(/\/+$/u, '') : ''
      // 空串是合法值（清空自定义地址并退回跟随 pnpm）；非空必须是 http(s)。
      if (text === '' || /^https?:\/\/[^\s]+$/iu.test(text)) next[key] = text
      continue
    }
    const bounds = NUMBER_BOUNDS[key]
    if (bounds !== undefined) {
      const value = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(value)) continue
      next[key] = Math.min(Math.max(Math.round(value), bounds[0]), bounds[1])
      continue
    }
    if (typeof raw === 'boolean') next[key] = raw
    else if (raw === 'true' || raw === 'false') next[key] = raw === 'true'
  }
  // 传了、也是可覆盖的键，但一个都没落下来：记一条，别再静默成功。
  // 上面那类「字符串键没有分支」的 bug 只有日志能提前暴露。
  const asked = Object.keys(patch ?? {})
  const landed = asked.filter((key) => OVERRIDEABLE.includes(key) && next[key] !== undefined)
  if (asked.length > 0 && landed.length === 0) {
    writeLog('settingsDropped', [asked])
  }
  const file = settingsPath()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch (error) {
    return { ok: false, error: oneLine(error?.message ?? error, 200) }
  }
  // 缓存立刻跟上，否则这一轮读到的还是旧值。
  overrideCache = { stamp: null, value: {} }
  return { ok: true, value: next }
}

/** 只接受四种已知模式，写错了退回 minutes，绝不让调度器拿到一个不认识的字符串。 */
function scheduleModeOf(config) {
  const raw = config?.scheduleMode
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return SCHEDULE_MODES.includes(value) ? value : 'minutes'
}

/**
 * HH:MM 时钟。故意不接受秒、不接受 12 小时制、不接受 25:00：
 * 一个写错的时刻会让「每天几点」永远不触发，而用户不会去看日志。
 */
function clockOf(config, key, fallback) {
  const raw = config?.[key]
  const text = typeof raw === 'string' ? raw.trim() : ''
  const matched = /^([01]?\d|2[0-3]):([0-5]\d)$/u.exec(text)
  if (matched === null) return fallback
  return String(matched[1]).padStart(2, '0') + ':' + matched[2]
}

/**
 * 这一轮跑完之后，隔多少分钟再跑。
 *
 * 竞品 niubi 的四种调度模式确实有用：有人想「每天凌晨三点跑一次」，
 * 有人想「每 6 小时」。但定时器本身仍然是「跑完再排下一次」——
 * 不是 setInterval 对齐到墙钟，因为一轮检查可能跑几分钟，
 * 对齐反而会让两次执行重叠。所以这里返回的是「从现在起多久」。
 */
function nextDelayMinutes(live, now) {
  switch (live.scheduleMode) {
    case 'hours':
      return live.everyHours * 60
    case 'days':
      return live.everyDays * 24 * 60
    case 'daily': {
      // 算出下一个 HH:MM 还有多久；刚好过点就顺延到明天，不留 0 分钟的空转。
      const [hour, minute] = live.dailyAt.split(':').map(Number)
      const target = new Date(now.getTime())
      target.setHours(hour, minute, 0, 0)
      let wait = target.getTime() - now.getTime()
      if (wait <= 0) wait += 24 * 60 * 60 * 1000
      return Math.round(wait / 60000)
    }
    default:
      return live.intervalMinutes
  }
}

function settingsOf(config) {
  const overrides = readOverrides()
  const merged = { ...(config !== null && typeof config === 'object' ? config : {}), ...overrides }
  config = merged
  return {
    enabled: booleanSetting(config, 'enabled', true),
    autoApply: booleanSetting(config, 'autoApply', true),
    hotReload: booleanSetting(config, 'hotReload', true),
    checkOnStart: booleanSetting(config, 'checkOnStart', true),
    idleOnly: booleanSetting(config, 'idleOnly', true),
    // 发现可更新版本时是否弹出提醒。默认开着：定时更新最容易出的事，是它一直在
    // 后台装，用户根本不知道装了什么、装到哪一版。
    notify: booleanSetting(config, 'notify', true),
    // 安装源：默认跟随 pnpm，选别的才动（生效值见 registryOf）。
    registryMode: registryModeOf(config),
    registryUrl: typeof config?.registryUrl === 'string' ? config.registryUrl : '',
    registry: registryOf(config),
    // 兼容性预检：装之前先看目标版本声明的 DSH 范围。默认开——宿主闸门是在
    // bundle 已经卸下之后才拒绝的，等它拒绝就已经晚了。
    compatCheck: booleanSetting(config, 'compatCheck', true),
    intervalMinutes: numberSetting(config, 'intervalMinutes', 1440, 10, 10080),
    firstDelayMinutes: numberSetting(config, 'firstDelayMinutes', 5, 0, 1440),
    exclude: stringList(config?.exclude),
    // 默认允许跨大版本：这些都是 0.x 插件，按 semver 卡大版本等于几乎不更新。
    allowMajor: booleanSetting(config, 'allowMajor', true),
    // 默认不装预发布。注意：走 next 标签的包（@deepseek-ai/dsh-*）是显式选择，
    // 不受这一条限制，否则 DSH 本体永远停在旧版本上。
    allowPrerelease: booleanSetting(config, 'allowPrerelease', false),
    // 调度模式：intervalMinutes 只在 minutes 模式下生效，
    // 其余三种各有自己的参数，切模式不丢原来的值。
    lang: langOf(config),
    scheduleMode: scheduleModeOf(config),
    dailyAt: clockOf(config, 'dailyAt', '03:00'),
    everyHours: numberSetting(config, 'everyHours', 6, 1, 168),
    everyDays: numberSetting(config, 'everyDays', 1, 1, 30),
    // 装失败的 pkg@版本 在这么多小时内不再重试。0 = 不抑制，每轮都试。
    suppressHours: numberSetting(config, 'suppressHours', 6, 0, 720),
    // 一轮最多装几个。0 = 不限（保持原有行为）。
    // 装包会一直占着 pnpm 锁，20 个包连着装能把 profile 占住几十分钟；
    // 限一个数就把单次占用封顶，剩下的下一轮再来。
    maxPerCycle: numberSetting(config, 'maxPerCycle', 0, 0, 50),
    // 会话目录多少分钟内没有写入才算「闲」。0 = 不看会话写入，只看子任务。
    sessionIdleMinutes: numberSetting(config, 'sessionIdleMinutes', SESSION_IDLE_MINUTES, 0, 120),
    // 更新记录 / 运行日志的保留天数。0 = 永不清理，默认 3 天。
    historyRetentionDays: retentionOf(config, 'historyRetentionDays', 3),
    logRetentionDays: retentionOf(config, 'logRetentionDays', 3),
    // 说明：这两个键不进 Config schema（见 OVERRIDEABLE 上的注释），
    // 所以只能通过设置页/覆盖层改，改坏了不会影响插件加载。
  }
}

const FIELDS = {
  enabled: { type: 'boolean', meta: { default: true, description: '启用定时检查' } },
  autoApply: { type: 'boolean', meta: { default: true, description: '发现新版本就安装' } },
  hotReload: { type: 'boolean', meta: { default: true, description: '安装后就地生效不重启' } },
  checkOnStart: { type: 'boolean', meta: { default: true, description: '启动后先查一次' } },
  idleOnly: { type: 'boolean', meta: { default: true, description: '有子任务在跑时不换代码' } },
  intervalMinutes: { type: 'number', meta: { default: 1440, description: '检查间隔（分钟）' } },
  firstDelayMinutes: { type: 'number', meta: { default: 5, description: '启动后多久开始第一次' } },
  exclude: { type: 'array', meta: { default: [], description: '不要自动更新的包' } },
  allowMajor: { type: 'boolean', meta: { default: true, description: '允许跨大版本更新' } },
  allowPrerelease: { type: 'boolean', meta: { default: false, description: '允许安装预发布版本' } },
}

const DICT = {
  enabled: 1, autoApply: 2, hotReload: 3, checkOnStart: 4, idleOnly: 5,
  intervalMinutes: 6, firstDelayMinutes: 7, exclude: 8,
  allowMajor: 12, allowPrerelease: 13,
}

export const Config = {
  uid: 9,
  refs: {
    1: FIELDS.enabled,
    2: FIELDS.autoApply,
    3: FIELDS.hotReload,
    4: FIELDS.checkOnStart,
    5: FIELDS.idleOnly,
    6: FIELDS.intervalMinutes,
    7: FIELDS.firstDelayMinutes,
    8: FIELDS.exclude,
    12: FIELDS.allowMajor,
    13: FIELDS.allowPrerelease,
    10: { type: 'object', meta: { default: {} }, dict: DICT },
  },
  type: 'object',
  dict: FIELDS,
  meta: { default: {} },
  toJSON() {
    return { uid: 9, refs: Config.refs }
  },
  '~standard': {
    version: 1,
    vendor: 'dsh-aupdate',
    validate(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      return { value: { ...source, ...settingsOf(source) } }
    },
  },
}

/**
 * 更新历史。
 *
 * 竞品里 publieople 的「动手前快照、随时回滚」和 chendaleiQ 的「更新记录：谁、从哪个版本、
 * 到哪个版本、什么时候、成没成」都是同一件事的两面：出问题时人得知道刚才动了什么。
 * 这里把两者并起来——每成功装上一个包就留一条，带上旧版本，回滚就靠它。
 */
const HISTORY_MAX = 200

function historyPath() {
  return join(dirname(settingsPath()), 'aupdate-history.json')
}

/**
 * 上一次运行结果落盘。
 *
 * 「上一次」这张卡是设置页最有用的东西——它告诉你最近一轮什么时候跑、查了多少个、
 * 装成了几个。但它是纯内存状态，DSH 一重启就归零，页面显示「还没跑过」，而磁盘上
 * 明明有刚装好的包。所以照历史表的做法落一份在 ~/.dsh 下。
 *
 * 读的时候按字段逐个校验：这个文件可能是别的版本写的，缺字段就当默认值，
 * 绝不因为一个坏文件让插件加载失败。
 */
function lastRunPath() {
  return join(dirname(settingsPath()), 'aupdate-lastrun.json')
}

function readLastRun() {
  let raw = null
  try {
    raw = readJson(lastRunPath())
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null
  if (typeof raw.at !== 'string' || raw.at === '') return null
  const textList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  /**
   * 待更新清单。
   *
   * 0.6.7 及更早把这一项存成「名字 1.0 -> 1.1」的句子，界面只能整行照搬；
   * 现在存 { name, from, to }，提醒和设置页才能把包名和版本分开排版。
   * 旧数据在这里解析回来，不需要用户清文件。
   */
  const updateList = (value) => {
    if (!Array.isArray(value)) return []
    const out = []
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        if (typeof item.name !== 'string' || item.name === '') continue
        out.push({
          name: item.name,
          from: typeof item.from === 'string' ? item.from : '',
          to: typeof item.to === 'string' ? item.to : '',
        })
        continue
      }
      if (typeof item !== 'string' || item === '') continue
      const match = /^(.*) (\S+) -> (\S+)$/u.exec(item)
      if (match === null) out.push({ name: item, from: '', to: '' })
      else out.push({ name: match[1], from: match[2], to: match[3] })
    }
    return out
  }
  return {
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    at: raw.at,
    checked: Number.isFinite(raw.checked) ? raw.checked : 0,
    updates: updateList(raw.updates),
    installed: textList(raw.installed),
    reload: typeof raw.reload === 'string' ? raw.reload : 'none',
    // 0.6.2 及更早存的是句子；0.6.3 起是 { code, args }，两种都要能读。
    reason: typeof raw.reason === 'string'
      ? raw.reason
      : (raw.reason !== null && typeof raw.reason === 'object' ? raw.reason : ''),
    snapshot: typeof raw.snapshot === 'string' ? raw.snapshot : '',
    // 0.7.x 及更早没有这两项；缺了就是空数组，不当成坏数据。
    lagged: Array.isArray(raw.lagged)
      ? raw.lagged.filter((row) => row !== null && typeof row === 'object' && typeof row.name === 'string')
      : [],
    blocked: Array.isArray(raw.blocked)
      ? raw.blocked.filter((row) => row !== null && typeof row === 'object' && typeof row.name === 'string')
      : [],
  }
}

function saveLastRun(value) {
  try {
    const file = lastRunPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
  } catch {
    // 记不住也不要紧，最坏的结果就是下次重启又显示「还没跑过」，不该影响更新本身。
  }
}

// 和失败表一样按 mtime+size 判新旧：这个文件也在 ~/.dsh 下跨 profile 共用，
// 读到一次就永久缓存会让另一个进程刚写的记录在这边看不见。
let historyCache = { stamp: null, value: [] }

function readHistory() {
  const file = historyPath()
  let stamp = 'missing'
  try {
    const info = statSync(file)
    stamp = info.mtimeMs + ':' + info.size
  } catch {
    historyCache = { stamp: 'missing', value: [] }
    return historyCache.value
  }
  if (historyCache.stamp === stamp) return historyCache.value
  const raw = readJson(file)
  const rows = Array.isArray(raw?.entries) ? raw.entries : []
  historyCache = {
    stamp,
    value: rows.filter((row) => row !== null && typeof row === 'object'),
  }
  return historyCache.value
}

function saveHistory(rows) {
  const value = rows.slice(0, HISTORY_MAX)
  try {
    const file = historyPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ entries: value }, null, 2) + '\n', 'utf8')
    const info = statSync(file)
    historyCache = { stamp: info.mtimeMs + ':' + info.size, value }
    return true
  } catch {
    // 记不上历史不影响更新本身，绝不能让它把这一轮搞挂。
    historyCache = { stamp: null, value: [] }
    return false
  }
}

/**
 * 写一条历史。
 *
 * 去重抄的是 chendaleiQ：同一个包、同样的 from→to，只留最新那条。
 * 否则「装了但磁盘上没变」这类失败每一轮都写一条，几十轮之后记录里
 * 全是同一行，回滚时反而找不到真正要回的那个点。
 * 注意只合并 from/to 完全相同的：1.0→1.1 和 1.0→1.2 是两件事，不能并。
 */
function appendHistory(row) {
  const rows = readHistory().slice()
  const duplicate = rows.findIndex((item) =>
    item.name === row.name &&
    item.from === row.from &&
    item.to === row.to &&
    item.profile === row.profile &&
    item.rolledBack !== true &&
    row.rolledBack !== true,
  )
  if (duplicate >= 0) rows.splice(duplicate, 1)
  rows.unshift(row)
  saveHistory(rows)
}

/**
 * 失败抑制。
 *
 * 抄的是 publieople 的做法：装失败的 pkg@版本 记下来，短时间内不再重试。
 * 没有这一条时，一个坏版本会让每一轮检查都去装一次、失败一次——
 * 日志被刷满，pnpm 被占着，而结果是注定的。注意键是「包名@版本」
 * 而不是包名：升级到新版本之后仍要重新试一次，那是新的事实。
 */
const FAILURE_MAX = 100

function failurePath() {
  return join(dirname(settingsPath()), 'aupdate-failures.json')
}

// 这个文件在 ~/.dsh 下，是所有 profile 共用的；两个进程都会写它，
// 所以和设置覆盖层一样按 mtime 判新旧，不能读到一次就永久缓存。
let failureCache = { stamp: null, value: [] }

function readFailures() {
  const file = failurePath()
  let stamp = 'missing'
  try {
    const info = statSync(file)
    stamp = info.mtimeMs + ':' + info.size
  } catch {
    failureCache = { stamp: 'missing', value: [] }
    return failureCache.value
  }
  if (failureCache.stamp === stamp) return failureCache.value
  const raw = readJson(file)
  const rows = Array.isArray(raw?.entries) ? raw.entries : []
  failureCache = {
    stamp,
    value: rows.filter((row) => row !== null && typeof row === 'object' && typeof row.key === 'string'),
  }
  return failureCache.value
}

function saveFailures(rows) {
  const value = rows.slice(0, FAILURE_MAX)
  try {
    const file = failurePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ entries: value }, null, 2) + '\n', 'utf8')
    // 写成功后把缓存指向刚写的内容，下次读不必再解析一遍。
    const info = statSync(file)
    failureCache = { stamp: info.mtimeMs + ':' + info.size, value }
    return true
  } catch {
    failureCache = { stamp: null, value: [] }
    return false
  }
}

function noteFailure(pkgName, version) {
  const key = pkgName + '@' + version
  const rows = readFailures().filter((row) => row.key !== key)
  rows.unshift({ key, at: new Date().toISOString() })
  saveFailures(rows)
}

function clearFailure(pkgName, version) {
  const key = pkgName + '@' + version
  const rows = readFailures()
  if (!rows.some((row) => row.key === key)) return
  saveFailures(rows.filter((row) => row.key !== key))
}

/** 这个 pkg@版本 是否还在抑制窗口内。suppressHours 为 0 时永不抑制。 */
function suppressedUntil(pkgName, version, settings, now) {
  if (settings.suppressHours <= 0) return null
  const key = pkgName + '@' + version
  const row = readFailures().find((item) => item.key === key)
  if (row === undefined) return null
  const at = Date.parse(String(row.at ?? ''))
  if (!Number.isFinite(at)) return null
  const until = at + settings.suppressHours * 3600_000
  return until > now.getTime() ? new Date(until) : null
}

/**
 * 该不该从这个版本升到那个版本。
 *
 * 三条规则，对应竞品的三种默认值：
 *  - 预发布：默认不装（chendaleiQ 同款），但 next 标签是显式选择，不受限；
 *  - 跨大版本：默认允许。这些插件基本都是 0.x，按 semver 把 0.1 -> 0.2 当大版本卡住，
 *    等于永远不更新（publieople 就把这类行标成「范围外」）；
 *  - 降级：不装。
 */
function upgradeVerdict(target, current, tag, settings) {
  const a = parseVersion(target)
  const b = parseVersion(current)
  if (a === null || b === null) return { ok: false, code: 'uncomparable', why: { code: 'uncomparable' } }
  if (compareVersions(target, current) <= 0) return { ok: false, code: 'latest', why: { code: 'latest' } }
  // parseVersion 对正式版返回的是空数组而不是 null，判空得看长度。
  if (a.pre.length > 0 && tag !== 'next' && !settings.allowPrerelease) {
    return { ok: false, code: 'prerelease', why: { code: 'prerelease' } }
  }
  // 版本段存在 core 里：core[0] 是主版本。
  if (!settings.allowMajor && a.core[0] !== b.core[0]) {
    return { ok: false, code: 'major', why: { code: 'major', args: [b.core[0], a.core[0]] } }
  }
  return { ok: true }
}

function parseVersion(text) {
  const raw = String(text ?? '').trim().replace(/^v/iu, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(raw)
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/u.test(x)
    const ny = /^\d+$/u.test(y)
    if (nx && ny) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff > 0 ? 1 : -1
      continue
    }
    if (nx !== ny) return nx ? -1 : 1
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 1 = a 更新，0 = 相同，-1 = a 更旧；解析不了返回 null。 */
function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1
  }
  return comparePre(left.pre, right.pre)
}

function distTagFor(pkgName) {
  return NEXT_TAG_SCOPES.some((prefix) => pkgName.startsWith(prefix)) ? 'next' : 'latest'
}

/* ── 安装源 / 兼容性预检 / 镜像落后 ─────────────────────────────────────
 *
 * 这三样是从 dsh-plugin-upgrader 学来的（差距清单见 docs/BORROWED-FROM-UPGRADER.md），
 * 但按 aupdate 自己的量级实现：
 *
 * - 安装源：没选就不干预——dist-tags 走官方源、pnpm 用自己配置的源，和改造前
 *   一个字节都不差；选了才把 dist-tags 和 npm_config_registry 一起换过去。
 * - 兼容性预检：只在「已经决定要装这个版本」时读一次该版本的 manifest（几 KB），
 *   不像竞品那样为了版本列表去拉整份 packument（24 个包 2.88 MB）。
 * - 镜像落后：只有用了镜像才多查一次官方源的 dist-tags，默认零额外请求。
 */
const OFFICIAL_REGISTRY = 'https://registry.npmjs.org'
const REGISTRY_MIRROR = 'https://registry.npmmirror.com'
const REGISTRY_MODES = ['pnpm', 'npmjs', 'mirror', 'custom']

function registryModeOf(config) {
  const mode = typeof config?.registryMode === 'string' ? config.registryMode : ''
  return REGISTRY_MODES.includes(mode) ? mode : 'pnpm'
}

/**
 * 生效的源；'' 表示不干预。
 *
 * 自定义源只认 http(s) 并去掉尾部斜杠：后头是直接拼 URL 的，不校验的话一个
 * file: 或者带空格的串会变成更难查的「查不到版本」。
 */
function registryOf(config) {
  const mode = registryModeOf(config)
  if (mode === 'pnpm') return ''
  if (mode === 'npmjs') return OFFICIAL_REGISTRY
  if (mode === 'mirror') return REGISTRY_MIRROR
  const raw = typeof config?.registryUrl === 'string' ? config.registryUrl.trim().replace(/\/+$/u, '') : ''
  return /^https?:\/\/[^\s]+$/iu.test(raw) ? raw : ''
}

/** 查 dist-tags 用的基地址：没选源也走官方源（和改造前一致）。 */
function tagsBaseOf(registry) {
  return registry === '' ? OFFICIAL_REGISTRY : registry
}

/**
 * 当前宿主真正在跑的 DSH 版本。
 *
 * 兼容性闸门比的是 @deepseek-ai/dsh-app-boot 的版本——入口加载的是哪一份，闸门
 * 就用哪一份。桌面版入口在 app.asar 里，命令行启动看到的是 profile 里那份，两者
 * 可能不是同一个构建；从入口往上找是两种布局都对读法，读一个写死的路径会在两者
 * 不一致时骗人。读不到就返回 null：宁可漏拦，也不要按猜的版本误拦。
 */
let dshVersionMemo = null
const RUNTIME_PACKAGE = '@deepseek-ai/dsh-app-boot'

function dshVersion() {
  if (dshVersionMemo !== null) return dshVersionMemo
  const versionAt = (file) => {
    const raw = readJson(file)
    return raw !== null && typeof raw.version === 'string' && raw.version.trim() !== '' ? raw.version.trim() : null
  }
  const beside = (entry) => {
    let dir = dirname(entry)
    for (let depth = 0; depth < 10; depth += 1) {
      const found = versionAt(join(dir, 'node_modules', RUNTIME_PACKAGE, 'package.json'))
      if (found !== null) return found
      const up = dirname(dir)
      if (up === dir) return null
      dir = up
    }
    return null
  }
  try {
    for (const entry of process.argv.slice(1, 7)) {
      if (typeof entry !== 'string' || !/[.]c?js$/iu.test(entry)) continue
      const found = beside(entry)
      if (found !== null) {
        dshVersionMemo = found
        return found
      }
    }
  } catch {}
  return null
}

/**
 * 一个 range 是否接受这个版本。
 *
 * 只实现真正会遇到的那几种写法（比较符组合、^、~、裸版本号、x/星号）。遇到
 * 看不懂的（||、连字符区间、nested）一律放行：这套逻辑的用途是「提前拦住装不上
 * 的版本」，漏拦只是回到改造前的行为，误拦却会让一个本来能升的包永远不升。
 */
function satisfiesRange(range, version) {
  const text = String(range ?? '').trim()
  if (text === '') return true
  if (parseVersion(version) === null) return true
  if (text.includes('||')) return true
  const parts = text.split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return true
  for (const part of parts) if (!satisfiesOne(part, version)) return false
  return true
}

function satisfiesOne(part, version) {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/u.exec(part)
  if (match === null) return true
  const op = match[1] ?? ''
  const wantedRaw = match[2].trim()
  const wanted = parseVersion(wantedRaw)
  const got = parseVersion(version)
  if (got === null) return true
  // 1.x / 1.2.x / * 这类认不出完整版本号的，当通配处理。
  if (wanted === null) return true
  const cmp = compareVersions(version, wantedRaw)
  if (cmp === null) return true
  const [gotMajor, gotMinor] = got.core
  const [wantMajor, wantMinor] = wanted.core
  switch (op) {
    case '>=': return cmp >= 0
    case '>': return cmp > 0
    case '<=': return cmp <= 0
    case '<': return cmp < 0
    case '=': return cmp === 0
    case '^':
      // ^0.2.1 → >=0.2.1 <0.3.0；^1.2.3 → >=1.2.3 <2.0.0
      if (cmp < 0) return false
      if (wantMajor > 0) return gotMajor === wantMajor
      if (wantMinor > 0) return gotMajor === 0 && gotMinor === wantMinor
      return gotMajor === 0 && gotMinor === 0 && wanted.core[2] === got.core[2]
    case '~': return cmp >= 0 && gotMajor === wantMajor && gotMinor === wantMinor
    default: {
      const segments = wantedRaw.split('.').length
      if (segments >= 3) return cmp === 0
      if (segments === 2) return gotMajor === wantMajor && gotMinor === wantMinor
      return gotMajor === wantMajor
    }
  }
}

/**
 * 一个已发布版本声明的 DSH 要求。
 *
 * 顺序照宿主闸门：有 engines.dsh 就只认它，没有才看 @deepseek-ai/dsh(-*) 的 peer。
 * 反过来读会把宿主随后会拒绝的版本标成可用，正是这条路径要防的事。
 */
const DSH_PEER = '@deepseek-ai/dsh'
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'

function dshRequirementOf(manifest) {
  if (manifest === null || typeof manifest !== 'object') return null
  const engines = manifest.engines
  if (engines !== null && typeof engines === 'object' && typeof engines.dsh === 'string' && engines.dsh.trim() !== '') {
    return { range: engines.dsh.trim().replace(/^workspace:/u, ''), from: 'engines.dsh' }
  }
  const peers = manifest.peerDependencies
  if (peers === null || typeof peers !== 'object') return null
  const rank = (key) => (key === DSH_PEER ? 0 : key.startsWith(DSH_PEER_PREFIX) ? 1 : 2)
  const entries = Object.entries(peers)
    .filter(([key, value]) => rank(key) < 2 && typeof value === 'string' && value !== '' && !value.startsWith('workspace:'))
    .sort((a, b) => rank(a[0]) - rank(b[0]))
  if (entries.length === 0) return null
  return { range: entries[0][1].trim(), from: 'peer ' + entries[0][0] }
}

const manifestCache = new Map()

/** 单个已发布版本的 manifest（几 KB），带缓存。 */
async function versionManifestOf(pkgName, version, registry) {
  const key = tagsBaseOf(registry) + '|' + pkgName + '|' + version
  const hit = manifestCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < TAG_TTL_MS) return hit.value
  const url = tagsBaseOf(registry) + '/' + pkgName.replace('/', '%2f') + '/' + encodeURIComponent(version)
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('registry ' + response.status)
  const value = await response.json()
  manifestCache.set(key, { at: Date.now(), value })
  if (manifestCache.size > 200) {
    const oldest = manifestCache.keys().next()
    if (!oldest.done) manifestCache.delete(oldest.value)
  }
  return value
}

/**
 * 这个版本能不能装在这台宿主上。
 *
 * 返回 null 表示「说不了」：DSH 版本读不到、manifest 查不到、这个包根本没声明
 * 要求——三种情况都不拦，照常装。只有明确不满足时才返回 ok:false。
 */
async function compatOf(pkgName, version, registry) {
  const dsh = dshVersion()
  if (dsh === null) return null
  let manifest
  try {
    manifest = await versionManifestOf(pkgName, version, registry)
  } catch {
    return null
  }
  const need = dshRequirementOf(manifest)
  if (need === null) return null
  return { ok: satisfiesRange(need.range, dsh), range: need.range, from: need.from, dsh }
}

/**
 * 镜像落后：官方源已经有更新的版本，你在用的镜像还没同步。
 *
 * 只比 dist-tags 上那一个标签。镜像模式下每个包多一次很小的请求；不选镜像时
 * 直接返回 null，一个请求都不发。
 */
async function mirrorLagOf(pkgName, registry, mirrorTags) {
  if (registry === '' || tagsBaseOf(registry) === OFFICIAL_REGISTRY) return null
  try {
    const upstream = await registryTags(pkgName, OFFICIAL_REGISTRY)
    const tag = distTagFor(pkgName)
    const up = typeof upstream[tag] === 'string' ? upstream[tag] : null
    const mirror = typeof mirrorTags?.[tag] === 'string' ? mirrorTags[tag] : null
    if (up === null || mirror === null) return null
    const cmp = compareVersions(up, mirror)
    return cmp !== null && cmp > 0 ? { tag, upstream: up, mirror } : null
  } catch {
    return null
  }
}

/* ── 版本管理 ───────────────────────────────────────────────────────────
 *
 * 「插件」页多一个标签页，列每个已装插件的全部已发布版本，可以点到某一版。
 *
 * 只读缩略 packument（Accept: application/vnd.npm.install-v1+json）：它保留
 * versions 里每个版本的 engines/deprecated，正好是这里要判断的东西，而把
 * readme、tarball 元数据和 maintainer 全砍掉了。整份 packument 最大单包 26 MB，
 * 缩略版 10 MB，常见插件只有几 KB —— 这个差别决定了能不能一页列一排包的版本。
 */
const MAX_VERSIONS = 80
const versionsCache = new Map()
const VERSIONS_TTL_MS = 5 * 60 * 1000
const ABBREVIATED_ACCEPT = 'application/vnd.npm.install-v1+json'

async function publishedVersions(pkgName, registry) {
  const base = tagsBaseOf(registry)
  const key = base + '|' + pkgName
  const hit = versionsCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < VERSIONS_TTL_MS) return hit.value
  const url = base + '/' + pkgName.replace('/', '%2f')
  const response = await fetch(url, {
    headers: { accept: ABBREVIATED_ACCEPT },
    // 慢的包（几千个版本那种）在镜像上要几秒；超时就回报失败，不拖住整页。
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('registry ' + response.status)
  const doc = await response.json()
  const packs = doc?.versions !== null && typeof doc?.versions === 'object' ? doc.versions : {}
  const tags = doc?.['dist-tags'] !== null && typeof doc?.['dist-tags'] === 'object' ? doc['dist-tags'] : {}
  const dsh = dshVersion()
  const rows = []
  for (const [version, manifest] of Object.entries(packs)) {
    if (parseVersion(version) === null) continue
    const need = dshRequirementOf(manifest)
    rows.push({
      version,
      // 宿主闸门读的是同一个字段，这里算出来的结论和它一致。
      need: need === null ? '' : need.range,
      ok: need === null || dsh === null ? null : satisfiesRange(need.range, dsh),
      deprecated: typeof manifest?.deprecated === 'string' && manifest.deprecated !== '',
    })
  }
  rows.sort((a, b) => (compareVersions(b.version, a.version) ?? 0))
  const tag = distTagFor(pkgName)
  const value = {
    name: pkgName,
    latest: typeof tags.latest === 'string' ? tags.latest : '',
    tag,
    tagVersion: typeof tags[tag] === 'string' ? tags[tag] : '',
    total: rows.length,
    versions: rows.slice(0, MAX_VERSIONS),
  }
  versionsCache.set(key, { at: Date.now(), value })
  if (versionsCache.size > 60) {
    const oldest = versionsCache.keys().next()
    if (!oldest.done) versionsCache.delete(oldest.value)
  }
  return value
}

/** 正在切版本时挡住定时轮次，反过来也一样：pnpm 是按 profile 上一把锁的。 */
let switching = null

/**
 * 把某个插件切到指定版本。
 *
 * 和整轮更新走同一条安装路径（installOne → 回读磁盘版本 → 记历史），只是不带
 * 调度、抑制和单轮上限。兼容性预检在这里同样生效：宿主的闸门要等 bundle 卸下
 * 之后才拒绝，切到装不上的版本会留下一个半装的样子。
 */
async function switchVersion(ctxRef, pkgName, version) {
  if (switching !== null || running !== null) return { ok: false, reason: { code: 'runBusy' } }
  const settings = settingsOf(ctxRef.config)
  const profileDir = profileDirOf(ctxRef.ctx)
  const profileName = basename(profileDir)
  const current = installedVersion(profileDir, pkgName, null)
  if (current === version) return { ok: true, unchanged: true, from: current, to: version, detail: '' }
  const compat = await compatOf(pkgName, version, settings.registry)
  if (compat !== null && !compat.ok) {
    return { ok: false, from: current, to: version, reason: { code: 'compatBlocked', args: [version, compat.range, compat.dsh] } }
  }
  const runner = cliRunner()
  if (runner === null) return { ok: false, from: current, to: version, reason: { code: 'noCli' } }
  const lock = takeProfileLock(profileDir, new Date())
  if (!lock.ok) return { ok: false, from: current, to: version, reason: lock.reason }
  switching = { name: pkgName, version }
  try {
    writeLog('switching', [pkgName, current ?? '?', version])
    const outcome = await installOne(runner, profileName, profileDir, pkgName, version, settings.registry)
    if (!outcome.ok) return { ok: false, from: current, to: version, detail: outcome.detail ?? '' }
    clearFailure(pkgName, version)
    appendHistory({
      at: new Date().toISOString(),
      name: pkgName,
      from: current ?? '',
      to: version,
      tag: '',
      profile: profileName,
      rolledBack: false,
    })
    writeLog('switched', [pkgName, current ?? '?', version])
    // 切完就地换代码：和回滚同一条路径（requiredBefore 传空），不重启就能用上。
    let reload = null
    if (settings.hotReload) {
      reload = await hotApply(ctxRef.ctx, [])
      writeLog('reloaded', [reload?.status ?? 'none', reload?.reason ?? ''])
    }
    return { ok: true, from: current, to: version, detail: outcome.detail ?? '', reload: reload?.status ?? 'off' }
  } finally {
    switching = null
    releaseProfileLock(lock)
  }
}
function profileDirOf(ctx) {
  const base = propOf(serviceOf(ctx, 'hmr'), 'baseDir')
  if (typeof base === 'string' && base !== '') return base
  return process.cwd()
}

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** 要被检查的依赖：dependencies 里非 link/file 的那些。 */
function dependencyList(profileDir, exclude) {
  const manifest = readJson(join(profileDir, 'package.json'))
  const deps = manifest?.dependencies
  if (deps === null || typeof deps !== 'object') return []
  const skip = new Set(exclude)
  const rows = []
  for (const [pkgName, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string') continue
    if (/^(link|file|workspace|portal):/iu.test(spec)) continue
    if (!NPM_NAME_RE.test(pkgName) || skip.has(pkgName)) continue
    rows.push({ name: pkgName, spec })
  }
  return rows
}

/**
 * 设置页的勾选清单。
 *
 * dependencyList 会按 exclude 过滤，而那正是勾选框要展示的东西——被排除的包
 * 也必须出现在列表里，否则一旦勾上就再也取消不掉。所以这里不过滤，只给每一项
 * 标注「当前是否被排除」，让页面自己决定勾没勾。
 */
function packageChoices(profileDir, settings) {
  const manifest = readJson(join(profileDir, 'package.json'))
  const deps = manifest?.dependencies
  if (deps === null || typeof deps !== 'object') return []
  const skip = new Set(settings.exclude)
  const rows = []
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string') continue
    if (/^(link|file|workspace|portal):/iu.test(spec)) continue
    if (!NPM_NAME_RE.test(name)) continue
    const version = installedVersion(profileDir, name, spec)
    // 已装版本自己声明的 DSH 要求：读的是本地 node_modules 里的 manifest，
    // 不发任何网络请求。宿主闸门只认它，所以「装不上」的判断要按它来。
    // 这类包很可能根本没被加载，而升级按钮救不了它，只能换版本或升 DSH。
    const local = readJson(join(profileDir, 'node_modules', name, 'package.json'))
    const need = dshRequirementOf(local)
    const host = dshVersion()
    rows.push({
      name,
      version: typeof version === 'string' ? version : '',
      excluded: skip.has(name),
      need: need === null ? '' : need.range,
      ok: need === null || host === null ? null : satisfiesRange(need.range, host),
    })
  }
  // 不能直接用 localeCompare：它的结果跟着系统区域变，同一个 profile 在不同机器上
  // 排出来的顺序会不一样，页面顺序跳来跳去会让人以为列表变了。
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return rows
}

/**
 * 已装版本带缓存。
 *
 * 每个依赖每轮都 readFileSync 一次 package.json，24 个包就是 24 次同步读盘，
 * 而且这些文件在两次检查之间几乎不会变。缓存以 package.json 的 mtime+size 为键：
 * 版本真被装上去了 mtime 必变，缓存自然失效，不会读到旧值。
 */
const versionCache = new Map()

function installedVersion(profileDir, pkgName, spec) {
  const manifestPath = join(profileDir, 'node_modules', pkgName, 'package.json')
  let stamp = null
  try {
    const info = statSync(manifestPath)
    stamp = info.mtimeMs + ':' + info.size
  } catch {}
  const cacheKey = manifestPath
  if (stamp !== null) {
    const hit = versionCache.get(cacheKey)
    if (hit !== undefined && hit.stamp === stamp) return hit.version
  }
  const manifest = readJson(manifestPath)
  const version = manifest?.version
  if (typeof version === 'string' && version !== '') {
    if (stamp !== null) {
      if (versionCache.size > 400) versionCache.clear()
      versionCache.set(cacheKey, { stamp, version })
    }
    return version
  }
  const cleaned = String(spec ?? '').replace(/^[~^<>=]*/u, '').replace(/\s.*$/u, '')
  return parseVersion(cleaned) === null ? null : cleaned
}

/**
 * 只取 dist-tags，不取整份 packument。
 *
 * 原来的地址返回的是完整 packument：24 个包合计 2.88 MB，单个最大的 439 KB，
 * 客户端只是要找 dist-tags 里那十几个字节。registry 有专门的轻量端点，
 * 24 个包合计约 655 B —— 相差三个数量级，这是这一轮最大的浪费。
 */
const tagCache = new Map()
const TAG_TTL_MS = 10 * 60 * 1000

/** 缓存键带上源：同一个包在两个源上的答案可以不一样，不能混用。 */
function tagCacheGet(key) {
  const hit = tagCache.get(key)
  if (hit === undefined) return null
  if (Date.now() - hit.at > TAG_TTL_MS) {
    tagCache.delete(key)
    return null
  }
  return hit.tags
}

function tagCacheSet(key, tags) {
  tagCache.set(key, { at: Date.now(), tags })
  // 缓存不设上限会随着 profile 换包一直长；几百个包就够用，超出就丢最旧的。
  if (tagCache.size > 400) {
    const oldest = tagCache.keys().next()
    if (!oldest.done) tagCache.delete(oldest.value)
  }
}

async function registryTags(pkgName, base = OFFICIAL_REGISTRY) {
  const key = base + '|' + pkgName
  const cached = tagCacheGet(key)
  if (cached !== null) return cached
  const url = base + '/-/package/' + pkgName.replace('/', '%2f') + '/dist-tags'
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    // 镜像慢起来很慢，但一个页面不该被它拖住：8 秒拿不到就回报失败。
    signal: AbortSignal.timeout(base === OFFICIAL_REGISTRY ? 10000 : 8000),
  })
  if (!response.ok) throw new Error('registry ' + response.status)
  const tags = await response.json()
  if (tags === null || typeof tags !== 'object') throw new Error('没有 dist-tags')
  tagCacheSet(key, tags)
  return tags
}
/**
 * dsh plugin 的入口：优先用宿主自己的 Electron 可执行文件加 cli.js，
 * 不必经 cmd.exe 转一层，也就没有引号与元字符的问题。
 */
function cliRunner(exe = process.execPath) {
  const inner = join('app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  const beside = dirname(exe)
  // app.asar 是文件而不是目录，进不去也 stat 不到里面；看得见它本身就说明布局对，
  // cli.js 由 Electron 自己进 asar 去读，这正是 dsh.cmd 的做法。
  const roots = [join(beside, 'resources'), join(beside, '..', 'Resources'), beside]
  for (const root of roots) {
    if (!existsSync(join(root, 'app.asar'))) continue
    return { command: exe, prefix: ['--expose-internals', join(root, inner)], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const base = join(local, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin')
  for (const leaf of ['dsh.cmd', 'dsh']) {
    const file = join(base, leaf)
    if (!existsSync(file)) continue
    // .cmd 必须交给 shell；直接 spawn 时 Node 会替我们补一对引号，路径里有空格就废了。
    if (/[.]cmd$/iu.test(file)) return { command: file, prefix: [], env: {}, shell: true }
    return { command: file, prefix: [], env: {} }
  }
  return null
}

function runOnce(command, args, options) {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    let child = null
    try {
      // shell 为真时不能把参数数组交给 shell（Node 只拼接不转义，DEP0190 就是这件事），
      // 自己按 Windows 规矩加引号拼成一条命令行再交给 shell。
      const quote = (value) => (/[\s"]/u.test(value) ? '"' + value.replace(/"/gu, '""') + '"' : value)
      // 整条命令行由我们拼：带空格的路径必须加引号，否则 cmd.exe 会在空格处截断。
      const line = [command, ...args].map(quote).join(' ')
      child = spawn(options.shell === true ? line : command, options.shell === true ? [] : args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: true,
        shell: options.shell === true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ ok: false, output: String(error?.message ?? error) })
      return
    }
    let output = ''
    const collect = (chunk) => {
      if (output.length < 20000) output += String(chunk)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish({ ok: false, output: output + ' 超时' })
    }, options.timeoutMs)
    timer.unref?.()
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, output: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: code === 0, output })
    })
  })
}

async function installOne(runner, profileName, profileDir, pkgName, version, registry = '') {
  const args = [...runner.prefix, 'plugin', '--profile', profileName, 'add', pkgName + '@' + version]
  // 选了安装源就让 pnpm 也走这个源：npm_config_registry 是 pnpm 也认的变量，
  // 只作用于这个子进程，不动 profile 的 .npmrc，也不动 pnpm 自己的配置。
  const env = { ...runner.env, CI: '1' }
  if (registry !== '') env.npm_config_registry = registry
  const result = await runOnce(runner.command, args, {
    cwd: profileDir,
    env,
    shell: runner.shell === true,
    timeoutMs: INSTALL_TIMEOUT_MS,
  })
  const tail = String(result.output ?? '').trim().split('\n').slice(-4).join(' / ')
  if (!result.ok) return { name: pkgName, version, ok: false, detail: oneLine(tail, 600) }
  // 命令返回 0 不等于装上了：pnpm 可能只是「已是最新」什么也没做。
  // 回读磁盘上的真实版本，才能说这一条到底成没成。
  versionCache.delete(join(profileDir, 'node_modules', pkgName, 'package.json'))
  const onDisk = installedVersion(profileDir, pkgName, null)
  if (onDisk === version) return { name: pkgName, version, ok: true, detail: oneLine(tail, 600) }
  return {
    name: pkgName,
    version,
    ok: false,
    detail: oneLine('装上去了但磁盘上是 ' + (onDisk ?? '读不到') + '；' + tail, 600),
  }
}
function transactionContext(service) {
  try {
    if (typeof service?.executing?.exit === 'function') return service.executing
    for (const value of Object.values(service ?? {})) if (value instanceof AsyncLocalStorage) return value
  } catch {}
  return null
}

function isNestedTransaction(error) {
  return /\btransactions? cannot be nested\b/iu.test(String(error?.message ?? error))
}

/**
 * 会话目录里最近一次写入距今多少分钟；目录不存在时返回 null（未知）。
 *
 * 为什么还要看文件 mtime，而不是只看 agent.status：竞品 niubi 实测踩过这个坑——
 * turn 结束后 status 可能长期停在 running。只看 status 的话，「有子任务在跑」
 * 会变成永久成立，自动更新永远不落地，而且用户从界面上看不出原因。
 * 文件 mtime 是磁盘事实，谁在写会话一目了然。
 *
 * 代价也很清楚：深遍历会 stat 很多文件，所以限深四层、逐层只 readdir 一次。
 * 实测本机 ~/.dsh/sessions 只有 251 个文件，扫一遍是毫秒级。
 */
function sessionAgeMinutes(now, root = null) {
  const home = typeof root === 'string' && root !== ''
    ? root
    : (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh'))
  const base = join(home, 'sessions')
  let newest = 0
  let seen = 0
  const walk = (dir, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      // 单个条目 stat 失败就跳过：它可能是刚被删掉的文件，也可能权限不对。
      // 读不到就当没看见，让判断回落到其它文件；全都读不到时 seen 为 0，
      // 返回 null 表示「不知道」，调用方据此不拦更新——宁可照常跑，
      // 也不因为一个读不了的文件把自动更新永久停掉。
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 4) walk(full, depth + 1)
        continue
      }
      try {
        const info = statSync(full)
        seen += 1
        if (info.mtimeMs > newest) newest = info.mtimeMs
      } catch {}
    }
  }
  walk(base, 0)
  if (seen === 0 || newest === 0) return null
  return (now.getTime() - newest) / 60000
}

/**
 * 现在为什么不该动手（安装或换代码）。
 *
 * 两件事都会被「有人在用」否决，但理由不同：子任务在跑时换代码会把它中止；
 * 会话在写说明用户正干着活，装包会占住 pnpm 并让界面变卡。
 * 探测失败时返回空数组——宁可照常跑，也不因为读不到目录就把更新永久停掉。
 */
function activityReasons(ctx, now, idleMinutes) {
  const reasons = []
  const agents = runningSubagents(ctx)
  if (agents.length > 0) reasons.push({ code: 'agentsBusy', args: [agents.length] })
  if (!(idleMinutes > 0)) return reasons
  const age = sessionAgeMinutes(now)
  if (age !== null && age < idleMinutes) {
    reasons.push({ code: 'sessionActive', args: [age] })
  }
  return reasons
}

/**
 * 跨进程的安装锁。
 *
 * 原来的 running 只是进程内的互斥：自己的两轮不会叠在一起，但管不了别的进程
 * （另一个窗口、另一个 profile 的宿主、用户自己开的终端）。而 pnpm 的锁是
 * 按 profile 目录算的，两个进程同时装就会撞 pnpm-workspace.yaml 的瞬时 EPERM。
 * 这个文件锁把「同一 profile 同时只有一个安装」这件事落到磁盘上。
 *
 * 超时接管是为了不让一次崩溃永久堵住更新：锁超过 LOCK_STALE_MS 就当作没主。
 */
/** 动手前要留底的文件。这四个丢了任何一个，profile 都可能起不来。 */
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']
/** 留最近几份。一份约 100KB，三份足够覆盖「刚才那次装坏了」。 */
const SNAPSHOT_KEEP = 3

function snapshotRoot() {
  return join(dirname(settingsPath()), 'aupdate-snapshots')
}

/**
 * 动手前把 manifest 那一套拷一份。
 *
 * 这一条抄自 publieople 和 z460440448，但只抄一半：他们还会「还原快照并重装」，
 * 我们不做自动还原。原因是还原 manifest 会和已经装好的 node_modules 打架——
 * 把旧的 pnpm-lock.yaml 盖回去、再让 pnpm 重装，等于用一次更长的高风险操作
 * 去修一次可能的失败，判错的代价比原问题还大。
 * 所以这里只留底、记下路径、在设置页显示出来；要不要用它，人自己决定。
 * 这也让它和已有的「按包回滚」完全不重叠：那个是「我要旧版本」，这个是「留个现场」。
 */
function snapshotProfile(profileDir, now) {
  try {
    const stamp = now.toISOString().replace(/[:.]/gu, '-')
    const dir = join(snapshotRoot(), stamp)
    mkdirSync(dir, { recursive: true })
    const saved = []
    for (const file of SNAPSHOT_FILES) {
      const from = join(profileDir, file)
      if (!existsSync(from)) continue
      writeFileSync(join(dir, file), readFileSync(from))
      saved.push(file)
    }
    if (saved.length === 0) return null
    pruneSnapshots()
    return { dir, files: saved }
  } catch (error) {
    // 留底失败不该拦住更新本身：它只是事后证据，不是前置条件。
    writeLog('snapshotFailed', [oneLine(error?.message ?? error, 200)])
    return null
  }
}

function pruneSnapshots() {
  try {
    const root = snapshotRoot()
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
    for (const stale of dirs.slice(SNAPSHOT_KEEP)) {
      rmSync(join(root, stale), { recursive: true, force: true })
    }
  } catch {}
}

/**
 * 按保留天数清理更新记录。
 *
 * 不能简单地「按 at 删老行」：pickRollbackTarget 是从回滚记录反推哪些更新已消费的。
 * 若把回滚记录删了、留下对应更新行，那次已经回滚过的降级就会重新变得可回滚——
 * 用户点一下，等于把一个已经被撤销的更新又执行一次。
 *
 * 所以按「一组」判新旧：一条更新 + 所有撤销它的回滚记录算一组，组内最新的时间
 * 决定这一组去留。同时删，就不会留下半组。
 */
function pruneHistory(days, now) {
  if (!(days > 0)) return 0
  const rows = readHistory()
  if (rows.length === 0) return 0
  const cutoff = now.getTime() - days * 86400_000
  const stampOf = (row) => {
    const at = Date.parse(String(row?.at ?? ''))
    return Number.isFinite(at) ? at : 0
  }
  const keyOf = (row) => [row?.name ?? '', row?.from ?? '', row?.to ?? '', row?.profile ?? ''].join('\u0000')

  // 组 key 用「被更新的那次」的 (包, from, to, profile)。
  // 回滚行的 from/to 是反的（from=新版本, to=旧版本），换回来就落到同一个 key。
  // 这样一条更新和撤销它的回滚一定同进同退，不会出现半组。
  const groups = new Map()
  for (const row of rows) {
    const isRollback = row?.tag === 'rollback'
    const key = keyOf(isRollback
      ? { name: row.name, from: row.to, to: row.from, profile: row.profile }
      : row)
    const group = groups.get(key) ?? { rows: [], newest: 0 }
    group.rows.push(row)
    group.newest = Math.max(group.newest, stampOf(row))
    groups.set(key, group)
  }

  const survivors = []
  for (const group of groups.values()) {
    if (group.newest >= cutoff) survivors.push(...group.rows)
  }
  const removed = rows.length - survivors.length
  if (removed > 0) {
    // 保持原有顺序（新→旧），组被打散过，按时间重排一次即可。
    survivors.sort((a, b) => stampOf(b) - stampOf(a))
    saveHistory(survivors)
  }
  return removed
}

/**
 * 按保留天数清理运行日志。
 *
 * 日志是「一行一条」的纯文本，每行以 [ISO 时间] 开头。逐行解析时间，只保留
 *  cutoff 之后的行；解析不出时间的行（旧格式里偶有）一律保留——宁可多留，
 *  不因为格式不认识就删掉用户的现场。
 *
 * 写之前先 flush，否则待写队列里的新行还没落盘，写完被旧内容覆盖。
 */
function pruneLog(days, now) {
  if (!(days > 0)) return 0
  try {
    flushLogNow()
  } catch {}
  const file = logPath()
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const cutoff = now.getTime() - days * 86400_000
  const lines = raw.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const kept = []
  let removed = 0
  for (const line of lines) {
    const match = /^\[([^\]]+)\]/u.exec(line)
    if (match === null) {
      kept.push(line)
      continue
    }
    const at = Date.parse(match[1])
    if (Number.isFinite(at) && at < cutoff) removed += 1
    else kept.push(line)
  }
  if (removed === 0) return 0
  try {
    writeFileSync(file, kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf8')
  } catch {
    return 0
  }
  return removed
}

/** 一次清理：记录、日志、快照目录。按各自设置独立开关，0 表示不动。 */
function pruneAll(settings, now) {
  const historyDays = settings.historyRetentionDays
  const logDays = settings.logRetentionDays
  if (!(historyDays > 0) && !(logDays > 0)) return
  const removedHistory = pruneHistory(historyDays, now)
  const removedLog = pruneLog(logDays, now)
  if (removedHistory > 0) writeLog('cleaned', ['更新记录', removedHistory, historyDays])
  if (removedLog > 0) writeLog('cleaned', ['运行日志', removedLog, logDays])
}

function profileLockPath(profileDir) {
  return join(profileDir, '.aupdate-install.lock')
}

function lockHolder(file) {
  try {
    return readFileSync(file, 'utf8').trim().slice(0, 200)
  } catch {
    return ''
  }
}

function takeProfileLock(profileDir, now) {
  const file = profileLockPath(profileDir)
  const stamp = process.pid + ' ' + now.toISOString()
  try {
    writeFileSync(file, stamp + '\n', { encoding: 'utf8', flag: 'wx' })
    return { ok: true, file }
  } catch (error) {
    if (error?.code !== 'EEXIST') return { ok: false, reason: { code: 'lockFailed', args: [oneLine(error?.message ?? error, 160)] } }
  }
  // 锁已存在：只有确认它过期（持有者崩了）才接管，否则老老实实让开。
  let ageMinutes = null
  try {
    ageMinutes = Math.round((now.getTime() - statSync(file).mtimeMs) / 60000)
  } catch {
    ageMinutes = null
  }
  if (ageMinutes === null || ageMinutes * 60000 <= LOCK_STALE_MS) {
    return {
      ok: false,
      reason: { code: 'lockHeld', args: [lockHolder(file), ageMinutes] },
    }
  }
  try {
    unlinkSync(file)
  } catch {}
  try {
    writeFileSync(file, stamp + '\n', { encoding: 'utf8', flag: 'wx' })
    writeLog('tookOverLock', [ageMinutes])
    return { ok: true, file }
  } catch (error) {
    return { ok: false, reason: { code: 'lockFailed', args: [oneLine(error?.message ?? error, 160)] } }
  }
}

function releaseProfileLock(lock) {
  if (lock === null || lock === undefined || typeof lock.file !== 'string') return
  try {
    unlinkSync(lock.file)
  } catch {}
}

/** 正在跑的子任务；有它们时换代码会把它们中止。 */
function runningSubagents(ctx) {
  try {
    const agents = serviceOf(ctx, 'agents')
    if (typeof agents?.list !== 'function' || typeof agents?.roots !== 'function') return []
    const list = agents.list()
    const roots = agents.roots()
    if (!Array.isArray(list) || !Array.isArray(roots)) return []
    const top = new Set(roots)
    return list
      .filter((agent) => agent !== null && typeof agent === 'object' && !top.has(agent) && agent.status !== 'idle')
      .map((agent) => String(agent.id ?? ''))
  } catch {
    return []
  }
}

/** 现在在跑的 Loader 条目；热生效用它们判断换完之后谁没起来。 */
function activeEntryIds(ctx) {
  try {
    const loader = serviceOf(ctx, 'loader')
    if (typeof loader?.entries !== 'function') return []
    const ids = []
    for (const entry of loader.entries()) {
      const id = entry?.options?.id
      if (typeof id === 'string' && id !== '' && entry?.fiber?.state === 2) ids.push(id)
    }
    return ids
  } catch {
    return []
  }
}

/**
 * 就地换掉插件代码。只用公开契约：reconcileProfile 做换，runExclusive 排队。
 * 服务不在、或换的过程中抛错，都退化成「已装好，等重启」，绝不让宿主崩。
 */
async function hotApply(ctx, requiredBefore) {
  const hmr = serviceOf(ctx, 'hmr')
  if (hmr === null || typeof hmr.reconcileProfile !== 'function' || typeof hmr.runExclusive !== 'function') {
    return { status: 'unavailable', reason: { code: 'reloadUnavailable' } }
  }
  const context = transactionContext(hmr)
  const baseline = requiredBefore.filter((id) => id !== name)
  const inside = async () => hmr.reconcileProfile(baseline)
  const run = () => (context === null ? hmr.runExclusive(inside) : context.exit(() => hmr.runExclusive(inside)))
  let timedOut = false
  const timeout = new Promise((resolvePromise) => {
    // 这个定时器被 await 着，不能 unref：一旦没有别的句柄撑着事件循环，
    // unref 的定时器永远不会触发，Promise.race 就永远停在那儿。
    setTimeout(() => {
      timedOut = true
      resolvePromise(null)
    }, RELOAD_TIMEOUT_MS)
  })
  try {
    let result = null
    for (let attempt = 0; ; attempt += 1) {
      try {
        result = await Promise.race([run(), timeout])
        if (timedOut) return { status: 'applying', reason: { code: 'reloadApplying' } }
        break
      } catch (error) {
        if (isNestedTransaction(error) && attempt < 9) {
          await new Promise((resolvePromise) => {
            setTimeout(resolvePromise, 250 * (attempt + 1))
          })
          if (timedOut) return { status: 'applying', reason: { code: 'reloadQueued' } }
          continue
        }
        throw error
      }
    }
    const warnings = Array.isArray(result?.warnings) ? result.warnings.map((item) => oneLine(item, 300)) : []
    const restartReason = typeof result?.restartReason === 'string' ? result.restartReason : null
    if (restartReason !== null) return { status: 'restart', reason: oneLine(restartReason, 400), warnings }
    if (warnings.length > 0) return { status: 'blocked', reason: oneLine(warnings[0], 400), warnings }
    return { status: 'done', reason: { code: 'reloadDone' }, warnings }
  } catch (error) {
    return { status: 'failed', reason: oneLine(error?.message ?? error, 400) }
  }
}
function beginningRun(mode, ctxRef, options = {}) {
  if (running !== null) return null
  if (mode === 'update') setProgress({ phase: 'checking', index: 0, total: 0, name: '' })
  const promise = runCycle(mode, ctxRef, options).finally(() => {
    running = null
    clearProgress()
  })
  running = promise
  return promise
}

async function runCycle(mode, ctxRef, options = {}) {
  const settings = settingsOf(ctxRef.config)
  const only = Array.isArray(options.names) ? options.names.filter((item) => typeof item === 'string' && item !== '') : []
  // 「检查更新」要能绕过缓存：dist-tags 缓存 10 分钟，用户刚在别处发了新版时
  // 等 10 分钟才看见没有道理。
  if (options.fresh === true) {
    tagCache.clear()
    versionsCache.clear()
    manifestCache.clear()
  }
  const report = {
    status: 'done',
    startedAt: new Date().toISOString(),
    mode,
    checked: 0,
    updates: [],
    skipped: [],
    installed: [],
    reload: null,
    reason: '',
    snapshot: '',
  }
  try {
    const profileDir = profileDirOf(ctxRef.ctx)
    const profileName = basename(profileDir)
    let deps = dependencyList(profileDir, settings.exclude)
    // 只跑选中的那些：版本管理页的「升级选中」用它，别为了几个包重查整轮。
    if (only.length > 0) deps = deps.filter((dep) => only.includes(dep.name))
    report.checked = deps.length
    if (deps.length === 0) {
      report.reason = { code: 'noDeps' }
      return report
    }
    // 镜像落后 / 兼容性拦下的明细：这一轮结束后写进 lastRun，界面按名字展示。
    const lagged = []
    const blocked = []
    for (let i = 0; i < deps.length; i += FETCH_CONCURRENCY) {
      // 每批之间让出一次事件循环：同步读 package.json 和结果合批都在主线程上，
      // 一口气跑完 24 个包会让界面掉帧。setImmediate 只让一次，代价可以忽略。
      if (i > 0) await new Promise((settle) => setImmediate(settle))
      const batch = deps.slice(i, i + FETCH_CONCURRENCY)
      const answers = await Promise.all(batch.map(async (dep) => {
        const current = installedVersion(profileDir, dep.name, dep.spec)
        try {
          // 换了源就按那个源查：缓存键带 base，两个源的答案不会串。
          const tags = await registryTags(dep.name, tagsBaseOf(settings.registry))
          const tag = distTagFor(dep.name)
          const target = typeof tags[tag] === 'string' ? tags[tag] : null
          // 用了镜像时顺手比一次官方源。它不改变这一轮的判断，但「已经是最新」
          // 这时候可能是假的——镜像没同步，官方源其实已经发了新版本。
          const lag = await mirrorLagOf(dep.name, settings.registry, tags)
          if (lag !== null) {
            lagged.push({ name: dep.name, installed: current, ...lag })
            writeLog('mirrorLag', [dep.name, lag.upstream, lag.mirror])
          }
          if (target === null) return { name: dep.name, current, why: { code: 'noTag', args: [tag] } }
          if (current === null) return { name: dep.name, current, why: { code: 'noInstalled' } }
          const verdict = upgradeVerdict(target, current, tag, settings)
          if (!verdict.ok) {
            // 「已经是最新」不算异常，不必出现在 skipped 里。
            if (verdict.code === 'latest') return null
            return { name: dep.name, current, target, why: verdict.why }
          }
          // 兼容性预检：宿主闸门要等 bundle 卸下之后才拒绝，那时候快照已经白拍了、
          // 插件也处于「卸了一半」的样子。这里先问一句，装不了就不进队列。
          if (settings.compatCheck) {
            const compat = await compatOf(dep.name, target, settings.registry)
            if (compat !== null && !compat.ok) {
              blocked.push({ name: dep.name, target, need: compat.range, dsh: compat.dsh, from: compat.from })
              writeLog('compatBlocked', [dep.name, target, compat.range, compat.dsh])
              return { name: dep.name, current, target, why: { code: 'compatBlocked', args: [target, compat.range, compat.dsh] } }
            }
          }
          // 这个版本之前装失败过、还在抑制窗口内：这一轮不再试它。
          const until = suppressedUntil(dep.name, target, settings, new Date())
          if (until !== null) {
            return {
              name: dep.name,
              current,
              target,
              // 这里是服务端拼的纯文本，拿不到浏览器时区，所以显式写 UTC，
              // 免得把一个 UTC 时刻当成本地时间读。
              why: { code: 'suppressed', args: [until.toISOString().slice(0, 16).replace('T', ' ')] },
            }
          }
          return { name: dep.name, current, target, tag }
        } catch (error) {
          return { name: dep.name, current, why: { code: 'lookupFailed', args: [oneLine(error?.message ?? error, 120)] } }
        }
      }))
      for (const answer of answers) {
        if (answer === null) continue
        if (typeof answer.target === 'string') report.updates.push(answer)
        else report.skipped.push(answer)
      }
    }
    report.lagged = lagged
    report.blocked = blocked
    writeLog('checked', [report.checked, report.updates.length])
    if (report.updates.length === 0) {
      report.reason = { code: 'noUpdates' }
      return report
    }
    // 单轮上限：装包会一直占着 pnpm 锁，一轮装 20 个能把 profile 占住几十分钟。
    // 超出部分留在 updates 里，下一轮接着装——「发现」和「这一轮装到哪」是两件事。
    const deferred = settings.maxPerCycle > 0 ? report.updates.length - settings.maxPerCycle : 0
    if (deferred > 0) {
      report.updates = report.updates.slice(0, settings.maxPerCycle)
      writeLog('capped', [settings.maxPerCycle, deferred])
    }
    // 手动「一键升级」传 force：用户当场点了装，就不该被「自动安装」这个开关挡住——
    // 那个开关管的是定时轮次，不是人按下的按钮。
    if (mode === 'check' || (!settings.autoApply && options.force !== true)) {
      report.reason = { code: 'checkOnly' }
      return report
    }
    // 空闲门槛：装包会常驻占住 pnpm 并让界面变卡，换代码会把子任务中止。
    // 只有 update 且真的有事可做时才检查——check 模式什么都没装，打断不了任何人。
    if (settings.idleOnly) {
      // sessionIdleMinutes=0 表示不看会话写入，只保留「有子任务在跑」这一条。
      const idleWindow = settings.sessionIdleMinutes
      const why = activityReasons(ctxRef.ctx, new Date(), idleWindow)
      if (why.length > 0) {
        report.status = 'blocked'
        report.reason = { code: 'gated', args: [why] }
        writeLog('skipInstall', [why])
        return report
      }
    }
    const runner = cliRunner()
    if (runner === null) {
      report.status = 'failed'
      report.reason = { code: 'noCli' }
      return report
    }
    // 进程内的 running 管得住自己的两轮，管不住别的进程；pnpm 的锁是按 profile 算的。
    const lock = takeProfileLock(profileDir, new Date())
    if (!lock.ok) {
      report.status = 'blocked'
      report.reason = lock.reason
      writeLog('skipInstall', [lock.reason])
      return report
    }
    try {
      // 动手之前留个现场。装失败了至少有东西可查，而不是只剩日志。
      const snapshot = snapshotProfile(profileDir, new Date())
      if (snapshot !== null) {
        report.snapshot = snapshot.dir
        writeLog('snapshotTaken', [snapshot.dir, snapshot.files])
      }
      return await applyUpdates(ctxRef, report, settings, runner, profileDir, profileName)
    } finally {
      releaseProfileLock(lock)
    }
  } catch (error) {
    report.status = 'failed'
    report.reason = { code: 'raw', args: [oneLine(error?.message ?? error, 400)] }
    writeLog('cycleFailed', [report.reason])
    return report
  } finally {
    report.finishedAt = new Date().toISOString()
    lastRun = {
      status: report.status,
      at: report.finishedAt,
      checked: report.checked,
      // 这一轮「镜像落后」与「兼容性拦下」的明细：界面要能指着名字说清为什么。
      lagged: Array.isArray(report.lagged) ? report.lagged : [],
      blocked: Array.isArray(report.blocked) ? report.blocked : [],
      // 结构化存：界面要分开排「包名」和「版本」，句子做不到。
      updates: report.updates.map((item) => ({ name: item.name, from: item.current ?? '', to: item.target })),
      installed: report.installed.map((item) => item.name + '@' + item.version + (item.ok ? '' : ' !failed')),
      reload: report.reload?.status ?? 'none',
      reason: report.reason,
      snapshot: report.snapshot,
    }
    saveLastRun(lastRun)
  }
}

/** 真正去装的那一段；从 runCycle 里拆出来，好让锁的释放有明确的 finally。 */
async function applyUpdates(ctxRef, report, settings, runner, profileDir, profileName) {
  // 安装与换代码。锁由外层 runCycle 持有并在 finally 里释放，
  // 所以这里只管把包一个个装上、最后换一次代码，不碰锁。
  {
    const requiredBefore = activeEntryIds(ctxRef.ctx)
    // 自身放到最后：换掉自身之后，这一轮剩下的代码就来自旧模块了。
    const ordered = report.updates.slice().sort((a, b) => (a.name === name ? 1 : b.name === name ? -1 : 0))
    const total = ordered.length
    for (let i = 0; i < ordered.length; i += 1) {
      const update = ordered[i]
      // 每装一个之前更新一次进度；日志也写一行，日志卡片里能看到同样的话。
      setProgress({ phase: 'installing', index: i + 1, total, name: update.name })
      writeLog('installing', [i + 1, total, update.name])
      // 慢装提示：到点就报，不等整个命令结束。pnpm 的网络重试会把 WARN
      // 攒到结束才吐出来，中途必须有个「还在跑、已经跑了多久」的锚点。
      const startedAt = Date.now()
      const slowTimer = setTimeout(() => {
        writeLog('installTimeout', [update.name, Math.round(INSTALL_SLOW_MS / 60000)])
      }, INSTALL_SLOW_MS)
      slowTimer.unref?.()
      let outcome
      try {
        outcome = await installOne(runner, profileName, profileDir, update.name, update.target, settings.registry)
      } finally {
        clearTimeout(slowTimer)
      }
      report.installed.push(outcome)
      writeLog('install', [update.name, update.target, outcome.ok === true, outcome.detail ?? ''])
      if (outcome.ok) {
        clearFailure(update.name, update.target)
        appendHistory({
          at: new Date().toISOString(),
          name: update.name,
          from: update.current,
          to: update.target,
          tag: update.tag,
          profile: profileName,
          rolledBack: false,
        })
      } else {
        // 记下失败，下一轮跳过这个版本，而不是每轮都撞一次同样的墙。
        noteFailure(update.name, update.target)
      }
    }
    setProgress({ phase: 'applying', index: total, total, name: '' })
    const okCount = report.installed.filter((item) => item.ok).length
    if (okCount === 0) {
      report.status = 'failed'
      report.reason = { code: 'noneInstalled' }
      return report
    }
    if (!settings.hotReload) {
      report.reload = { status: 'skipped', reason: { code: 'reloadOff' } }
      report.reason = { code: 'installedRestart', args: [okCount] }
      return report
    }
    // 装完之后再确认一次：安装可能耗时几分钟，期间可能有人开了子任务。
    // 这里只看子任务，不看会话写入——换代码不会打断正在打字的用户，
    // 但会因为「刚有写入」就放弃热生效，让装好的东西白等一次重启。
    if (settings.idleOnly && runningSubagents(ctxRef.ctx).length > 0) {
      report.reload = { status: 'cancelled', reason: { code: 'reloadCancelled' } }
      report.reason = { code: 'installedNoHot', args: [okCount] }
      return report
    }
    report.reload = await hotApply(ctxRef.ctx, requiredBefore)
    writeLog('hotApply', [report.reload.status, report.reload.reason ?? ''])
    report.reason = { code: 'installedWith', args: [okCount, report.reload.reason] }
    if (report.reload.status === 'failed') report.status = 'failed'
    else if (report.reload.status === 'blocked' || report.reload.status === 'restart') report.status = 'partial'
    return report
  }
}
/**
 * 挑出可以回滚的那一条记录。
 *
 * 「哪条已经被回滚过」不靠改标志位，而是从回滚记录反推：只要存在一条更晚的
 * 回滚记录、把同一个包退回了这条的旧版本，这条就算用掉了。这样即使写历史失败，
 * 同一个操作也不可能被重放——之前用可变标志位就踩过这个坑，第二次回滚
 * 又摸回原始更新行，等于降级可以无限重复。
 */
function pickRollbackTarget(rows, entryName) {
  const rollbacks = rows.filter((item) => item?.tag === 'rollback')
  for (const item of rows) {
    if (item?.name !== entryName) continue
    if (item.tag === 'rollback') continue
    if (item.rolledBack === true) continue
    if (typeof item.from !== 'string' || typeof item.to !== 'string') continue
    // 只有「更晚发生的、把这个版本退回去的」回滚才算消费了这条更新。
    // 光看 (包名, 版本对) 会误伤：同一对版本后来又更新过一次时，
    // 上一次的回滚记录会把新的那条也判成已经用掉。
    const stamp = String(item.at ?? '')
    const used = rollbacks.some((rb) =>
      rb.name === item.name &&
      rb.from === item.to &&
      rb.to === item.from &&
      String(rb.at ?? '') > stamp,
    )
    if (used) continue
    return item
  }
  return undefined
}

/**
 * 回滚到某一次更新之前的版本。
 *
 * 只允许回滚「本插件自己装上去的那一次」：from 必须是历史上记下来的旧版本，
 * 否则就成了任意版本降级出口，风险比自动更新本身还大。
 */
async function rollbackOne(ctxRef, entryName) {
  const settings = settingsOf(ctxRef.config)
  const rows = readHistory()
  const row = pickRollbackTarget(rows, entryName)
  if (row === undefined) return { ok: false, reason: { code: 'rollbackNoRecord', args: [entryName] } }
  const profileDir = profileDirOf(ctxRef.ctx)
  const profileName = basename(profileDir)
  const runner = cliRunner()
  if (runner === null) return { ok: false, reason: { code: 'noCli' } }
  // 回滚也是一次 pnpm 安装，和定时轮次抢同一把 profile 锁。
  // 拿不到就明确告诉用户「有别的进程在装」，而不是让两个 pnpm 撞锁报 EPERM。
  const lock = takeProfileLock(profileDir, new Date())
  if (!lock.ok) return { ok: false, reason: lock.reason }
  let outcome
  try {
    outcome = await installOne(runner, profileName, profileDir, row.name, row.from, settings.registry)
  } finally {
    releaseProfileLock(lock)
  }
  writeLog('rollback', [row.name, row.from, row.to, outcome.ok === true, outcome.detail ?? ''])
  if (!outcome.ok) return { ok: false, reason: outcome.detail }
  const next = rows.slice()
  next.unshift({
    at: new Date().toISOString(),
    name: row.name,
    from: row.to,
    to: row.from,
    tag: 'rollback',
    profile: profileName,
    rolledBack: true,
  })
  saveHistory(next)
  let reload = { status: 'skipped', reason: { code: 'rollbackRestart' } }
  if (settings.hotReload) reload = await hotApply(ctxRef.ctx, [])
  return { ok: true, name: row.name, to: row.from, reload: reload.status }
}

function registerTool(ctx, config) {
  const tools = serviceOf(ctx, 'tools')
  if (tools === null || typeof tools.register !== 'function') return false
  const effect = propOf(ctx, 'effect')
  if (typeof effect !== 'function') return false
  const empty = { status: 'busy', reason: { code: 'runBusy' }, checked: 0, updates: [], installed: [], reload: 'none' }
  try {
    effect.call(ctx, () => tools.register({
      name: 'plugin_updater',
      description: '查可更新的 DSH 插件，装好后就地生效不重启',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['check', 'update', 'status'],
            description: 'check 只查；update 查并装；status 看上一次的结果',
          },
        },
        additionalProperties: false,
      },
      output: {
        presentationMeta: (_args, value) => ({ kind: 'plugin-updater', status: value?.status ?? 'done' }),
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            reason: { type: 'string' },
            checked: { type: 'number' },
            updates: { type: 'array', items: { type: 'string' } },
            installed: { type: 'array', items: { type: 'string' } },
            skipped: { type: 'array', items: { type: 'string' } },
            reload: { type: 'string' },
          },
          required: ['status'],
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: (settingsOf(config).lang === 'en' ? 'Plugin update · ' : '插件更新 · ') + (value?.reason || value?.status || ''),
        }],
      },
      execute: async (args) => {
        try {
          // 工具结果是给模型看的，也照设置里的语言出，别让 reason 变成 { code, args } 的裸 JSON。
          const lang = settingsOf(config).lang
          const action = args?.action === 'check' || args?.action === 'update' ? args.action : 'status'
          if (action === 'status') {
            const seen = lastRun
            if (seen === null) return { status: 'done', reason: renderReason({ code: 'neverRun' }, lang), checked: 0, updates: [], installed: [], reload: 'none' }
            return {
              status: seen.status,
              reason: renderReason({ code: 'lastSummary', args: [seen.at, seen.reason || seen.status] }, lang),
              checked: seen.checked,
              updates: seen.updates,
              installed: seen.installed,
              reload: seen.reload,
            }
          }
          const report = await beginningRun(action, { ctx, config })
          if (report === null) return { ...empty, reason: renderReason(empty.reason, lang) }
          return {
            status: report.status,
            reason: renderReason(report.reason, lang),
            checked: report.checked,
            updates: report.updates.map((item) => item.name + ' ' + (item.current ?? '?') + ' -> ' + item.target),
            installed: report.installed.map((item) => item.name + '@' + item.version + (item.ok ? '' : ' !failed')),
            reload: report.reload?.status ?? 'none',
            skipped: report.skipped.map((item) => item.name + (lang === 'en' ? ': ' : '：') + renderReason(item.why, lang)),
          }
        } catch (error) {
          writeLog('toolFailed', [oneLine(error?.message ?? error, 300)])
          return {
            status: 'failed',
            reason: renderReason({ code: 'stateBroken' }, settingsOf(config).lang),
            checked: 0, updates: [], installed: [], reload: 'none',
          }
        }
      },
    }), 'dsh-aupdate: plugin_updater')
    return true
  } catch (error) {
    writeLog('toolUnavailable', [oneLine(error?.message ?? error, 300)])
    return false
  }
}

/**
 * 设置页的后端：一个小前缀路由。
 *
 * 客户端要读当前设置、写设置、立刻跑一次、看上次结果；这些都没法只靠 config 解决
 * （config 是宿主的，客户端改不到）。webServer 是插件注册 HTTP 的正式途径，
 * 取不到就用空实现降级 —— 没有它插件照样能自动更新，只是设置页会报告不可用。
 */
const ROUTE_PREFIX = '/api/dsh-aupdate'

function sendJson(res, status, value) {
  try {
    const body = JSON.stringify(value)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  } catch {}
}

/**
 * 谁能调这些路由。
 *
 * 浏览器里任何一个网页都能向 127.0.0.1 发请求，所以「只看 Host/Origin/回环地址」
 * 不算准入。宿主把这件事交给 connection 服务，这里只做转发：
 *
 * - 新宿主是 admit(req)，返回 { rejection: status } 信封；旧宿主是
 *   requestRejection(req)，直接返回状态码。两种拼写都要认，认错一种就会把
 *   鉴权整个关掉。
 * - 返回 undefined 才是放行。
 * - 服务不在、或调用抛错，一律当拒绝（503）。这里不能「降级成放行」——
 *   那等于宿主一抖动，设置页对全世界的网页开放。
 *
 * connection 故意不写进 inject：cordis 的注入是全或无的，多声明一个依赖会让
 * 整个作用域等一个可能永远不来的服务。改成每次请求惰性读一次。
 */
function admitRequest(scope, req, res) {
  const connection = serviceOf(scope, 'connection')
  // 必须回 true：调用点写的是 if (admitRequest(...)) return，回 undefined 的话
  // 请求照旧往下走，鉴权就形同虚设（写的时候真踩过一次）。
  const write = (status) => {
    try {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
    } catch {}
    return true
  }
  if (connection === null) return write(503)
  let status
  try {
    const admit = propOf(connection, 'admit')
    if (typeof admit === 'function') {
      const verdict = admit.call(connection, req)
      status = verdict && typeof verdict === 'object' ? verdict.rejection : undefined
    } else {
      const reject = propOf(connection, 'requestRejection')
      if (typeof reject !== 'function') return write(503)
      status = reject.call(connection, req)
    }
  } catch {
    return write(503)
  }
  if (status === undefined || status === null) return false
  return write(typeof status === 'number' ? status : 403)
}

function readBody(req) {
  return new Promise((settle) => {
    let size = 0
    const chunks = []
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      settle(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      // 设置项都很小，超过 64KB 一定是打错了，直接丢。
      if (size > 65536) {
        finish(null)
        try { req.destroy() } catch {}
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        finish(text === '' ? {} : JSON.parse(text))
      } catch {
        finish(null)
      }
    })
    req.on('error', () => finish(null))
    // 没人发数据时别一直挂着。
    setTimeout(() => finish(null), 10000).unref?.()
  })
}

function settingsSnapshot(config, ctxRef, lang) {
  const settings = settingsOf(config)
  return {
    settings,
    overrides: readOverrides(),
    // 「关于 aupdate」显示用；随 package.json 自动更新，无需手改前端。
    version: pluginVersion,
    // 这台宿主真正在跑的 DSH 版本：兼容性预检就是按它比的，界面也要能看见它。
    dshVersion: dshVersion(),
    // 生效的安装源（'' = 跟随 pnpm）。
    registry: settings.registry,
    // 运行中的进度：没在跑时为 null，设置页据此决定要不要显示进度条。
    progress: progress === null ? null : { ...progress },
    lastRun: lastRun === null ? null : {
      status: lastRun.status,
      reason: renderReason(lastRun.reason, lang),
      at: lastRun.at,
      checked: lastRun.checked,
      updates: lastRun.updates,
      installed: lastRun.installed,
      lagged: Array.isArray(lastRun.lagged) ? lastRun.lagged : [],
      blocked: Array.isArray(lastRun.blocked) ? lastRun.blocked : [],
      reload: lastRun.reload,
      snapshot: lastRun.snapshot ?? '',
    },
    // 设置页把已装插件列成勾选框，用户勾就行，不用照着手抄包名。
    // 每项带上已装版本，勾的时候能看见自己勾的是哪个版本。
    packages: (() => {
      try {
        return packageChoices(profileDirOf(ctxRef?.ctx ?? null), settings)
      } catch {
        return []
      }
    })(),
    path: settingsPath(),
    history: readHistory().slice(0, 40),
    historyPath: historyPath(),
    // 下一轮什么时候跑：设置页把它直接显示出来，用户不用自己推算。
    // 调度器已经把「这一轮真实等多久」记在 pendingMinutes 上，优先用它；
    // 取不到（比如定时器还没排上）才退回按当前规则现算。
    nextInMinutes: typeof ctxRef?.pendingMinutes === 'number'
      ? ctxRef.pendingMinutes
      : nextDelayMinutes(settings, new Date()),
    // 被抑制的 pkg@版本：让人看得见「为什么这个包不更新了」。
    failures: readFailures().slice(0, 20).map((row) => {
      const at = Date.parse(String(row.at ?? ''))
      const until = Number.isFinite(at) && settings.suppressHours > 0
        ? new Date(at + settings.suppressHours * 3600_000).toISOString()
        : null
      return { key: row.key, at: row.at, until: until !== null && Date.parse(until) > Date.now() ? until : null }
    }),
    failurePath: failurePath(),
    // 动手前留的现场：设置页把它显示出来，出问题时有地方可查。
    snapshotPath: snapshotRoot(),
    // 保留期限也放在 state 里：设置页显示当前选择，并且按它算出「下次会清掉什么」。
    retention: {
      historyDays: settings.historyRetentionDays,
      logDays: settings.logRetentionDays,
    },
    // 为什么这一轮没动手：设置页把这两个直接显示出来，用户不用翻日志猜。
    // 尤其 sessionIdleMinutes —— 它太短会挡住大半夜的更新，太长又不该挡，
    // 得让人一眼看到「现在到底算不算闲」。
    gate: (() => {
      try {
        const profileDir = profileDirOf(ctxRef?.ctx ?? null)
        const lockFile = profileLockPath(profileDir)
        const held = existsSync(lockFile)
        return {
          idleOnly: settings.idleOnly,
          sessionIdleMinutes: settings.sessionIdleMinutes,
          maxPerCycle: settings.maxPerCycle,
          sessionAgeMinutes: (() => {
            const age = sessionAgeMinutes(new Date())
            return age === null ? null : Math.round(age * 10) / 10
          })(),
          lock: held ? lockHolder(lockFile) : '',
        }
      } catch {
        return null
      }
    })(),
  }
}

function registerRoutes(scope, ctxRef) {
  const webServer = serviceOf(scope, 'webServer')
  if (webServer === null || typeof webServer.register !== 'function') return false
  const handler = async (req, res) => {
    try {
      // 先过宿主准入，再碰任何设置或文件。读接口也过：/state 里有全量设置，
      // /logs 会读磁盘上的日志文件，都不该由任意网页拿到。
      if (admitRequest(scope, req, res)) return
      const url = new URL(req.url ?? '/', 'http://localhost')
      const suffix = url.pathname.slice(ROUTE_PREFIX.length)
      const method = req.method ?? 'GET'
      if (method === 'GET' || method === 'HEAD') {
        if (suffix === '/state') {
          sendJson(res, 200, settingsSnapshot(ctxRef.config, ctxRef, url.searchParams.get('lang')))
          return
        }
        if (suffix === '/logs') {
          sendJson(res, 200, readLogTail(url.searchParams.get('lines'), url.searchParams.get('lang')))
          return
        }
        if (suffix === '/versions') {
          // 一次只看一个包的版本列表：整页一次拉一排包，镜像上会很慢。
          const target = url.searchParams.get('name') ?? ''
          if (target === '') {
            sendJson(res, 400, { error: 'missing name' })
            return
          }
          try {
            const live = settingsOf(ctxRef.config)
            const listed = await publishedVersions(target, live.registry)
            const profileDir = profileDirOf(ctxRef.ctx)
            sendJson(res, 200, { ...listed, installed: installedVersion(profileDir, target, null) })
          } catch (error) {
            sendJson(res, 502, { error: oneLine(error?.message ?? error, 200) })
          }
          return
        }
        sendJson(res, 404, { error: 'unknown endpoint' })
        return
      }
      if (method === 'POST') {
        if (suffix === '/state') {
          const body = await readBody(req)
          if (body === null) {
            sendJson(res, 400, { error: 'bad json' })
            return
          }
          const result = writeOverrides(body)
          if (!result.ok) {
            sendJson(res, 500, { error: result.error })
            return
          }
          writeLog('settingsChanged', [Object.keys(body)])
          // 改完立刻按新设置重排，否则要等下一次触发才换节奏。
          try {
            if (typeof ctxRef.reschedule === 'function') ctxRef.reschedule()
          } catch (error) {
            writeLog('rescheduleFailed', [oneLine(error?.message ?? error, 200)])
          }
          sendJson(res, 200, settingsSnapshot(ctxRef.config, ctxRef, url.searchParams.get('lang')))
          return
        }
        if (suffix === '/registry/test') {
          const body = await readBody(req)
          const target = typeof body?.url === 'string' ? body.url.trim().replace(/\/+$/u, '') : ''
          if (!/^https?:\/\/[^\s]+$/iu.test(target)) {
            sendJson(res, 400, { ok: false, url: target, ms: 0, detail: 'not http(s)' })
            return
          }
          // 两支一起发、谁先答应用谁：/-/ping 在大陆镜像上有时要 15 秒，根地址只要 0.3 秒，
          // 串行探测会把能用的镜像报成连不上。整次 5 秒封顶。
          const probe = async (url) => {
            const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
            return response.ok
          }
          const started = Date.now()
          const [ping, root] = await Promise.allSettled([probe(target + '/-/ping'), probe(target + '/')])
          const ok = (ping.status === 'fulfilled' && ping.value === true) || (root.status === 'fulfilled' && root.value === true)
          sendJson(res, 200, { ok, url: target, ms: Date.now() - started })
          return
        }
        if (suffix === '/switch') {
          const body = await readBody(req)
          const target = typeof body?.name === 'string' ? body.name : ''
          const version = typeof body?.version === 'string' ? body.version : ''
          if (target === '' || version === '') {
            sendJson(res, 400, { error: 'missing name or version' })
            return
          }
          const outcome = await switchVersion(ctxRef, target, version)
          sendJson(res, outcome.ok ? 200 : 409, {
            ...outcome,
            reason: outcome.reason === undefined ? '' : renderReason(outcome.reason, url.searchParams.get('lang')),
          })
          return
        }
        if (suffix === '/rollback') {
          const body = await readBody(req)
          const target = typeof body?.name === 'string' ? body.name : ''
          if (target === '') {
            sendJson(res, 400, { error: 'missing name' })
            return
          }
          const outcome = await rollbackOne(ctxRef, target)
          writeLog('rollbackRequest', [target, outcome.ok === true, outcome.reason ?? ''])
          sendJson(res, outcome.ok ? 200 : 409, { ...outcome, reason: renderReason(outcome.reason, url.searchParams.get('lang')) })
          return
        }
        if (suffix === '/cleanup') {
          // 用户手动点「立即清理」：用当前设置跑一遍，回报删了多少条。
          const live = settingsOf(ctxRef.config)
          const now = new Date()
          const removedHistory = pruneHistory(live.historyRetentionDays, now)
          const removedLog = pruneLog(live.logRetentionDays, now)
          if (removedHistory > 0) writeLog('cleaned', ['更新记录', removedHistory, live.historyRetentionDays])
          if (removedLog > 0) writeLog('cleaned', ['运行日志', removedLog, live.logRetentionDays])
          const lang = logLangOf(url.searchParams.get('lang'))
          sendJson(res, 200, {
            history: removedHistory,
            log: removedLog,
            days: { history: live.historyRetentionDays, log: live.logRetentionDays },
            message: removedHistory === 0 && removedLog === 0
              ? LOG_TEMPLATES[lang].cleanSkipped('更新记录 / 运行日志')
              : LOG_TEMPLATES[lang].cleaned(removedHistory + removedLog > 0 ? '记录与日志' : '', removedHistory + removedLog, Math.max(live.historyRetentionDays, live.logRetentionDays)),
          })
          return
        }
        if (suffix === '/run') {
          const body = await readBody(req)
          const mode = body?.mode === 'check' ? 'check' : 'update'
          const report = await beginningRun(mode, ctxRef, {
            names: Array.isArray(body?.names) ? body.names : [],
            fresh: body?.fresh === true,
            force: body?.force === true,
          })
          if (report === null) {
            sendJson(res, 200, { started: false, reason: renderReason({ code: 'alreadyRunning' }, url.searchParams.get('lang')) })
            return
          }
          sendJson(res, 200, { started: true, status: report.status, reason: renderReason(report.reason, url.searchParams.get('lang')) })
          return
        }
        sendJson(res, 404, { error: 'unknown endpoint' })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
    } catch (error) {
      writeLog('routeFailed', [oneLine(error?.message ?? error, 300)])
      try { sendJson(res, 500, { error: 'internal' }) } catch {}
    }
  }
  try {
    const effect = propOf(scope, 'effect')
    const register = () => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
    if (typeof effect === 'function') {
      effect.call(scope, register, 'dsh-aupdate: settings routes')
      writeLog('routeReady', [ROUTE_PREFIX])
      return true
    }
    register()
    writeLog('routeReadyNoScope', [ROUTE_PREFIX])
    return true
  } catch (error) {
    writeLog('routeRegisterFailed', [oneLine(error?.message ?? error, 300)])
    return false
  }
}

export { compareVersions, upgradeVerdict, pickRollbackTarget, readHistory, historyPath, distTagFor, cliRunner, dependencyList, installedVersion, registryTags, hotApply, runCycle, settingsOf, readOverrides, writeOverrides, takeProfileLock, releaseProfileLock, sessionAgeMinutes, activityReasons, settingsSnapshot, snapshotProfile, snapshotRoot, pruneSnapshots, nextDelayMinutes, readLogTail, logPath, pruneAll, pruneHistory, pruneLog }

export function apply(ctx, config) {
  const ctxRef = { ctx, config }
  const settings = settingsOf(config)
  const timers = []

  // 工具放在动态 inject 作用域里注册：热重载时 tools 服务可能还没就绪，
  // 一次性注册会静默失败且永不重试；作用域会在服务重新出现时重放。
  let toolService = null
  const offerTool = (scope) => {
    try {
      const tools = serviceOf(scope, 'tools')
      if (tools === null || typeof tools.register !== 'function') {
        writeLog('toolRegistered', [false])
        return
      }
      if (toolService === tools) return
      toolService = tools
      const ok = registerTool(scope, config)
      writeLog('toolRegistered', [ok === true])
    } catch (error) {
      writeLog('toolRegisterThrew', [oneLine(error?.message ?? error, 300)])
    }
  }
  // 路由和工具是同一类问题：apply 执行时 webServer 可能还没就绪，
  // 一次性取服务会静默失败且永不重试。同样放进动态 inject 作用域里重放。
  let routeService = null
  const offerRoutes = (scope) => {
    try {
      const webServer = serviceOf(scope, 'webServer')
      if (webServer === null || typeof webServer.register !== 'function') {
        writeLog('webServerMissing', [])
        return
      }
      if (routeService === webServer) return
      const ok = registerRoutes(scope, ctxRef)
      if (ok) routeService = webServer
    } catch (error) {
      writeLog('routeRegisterThrew', [oneLine(error?.message ?? error, 300)])
    }
  }
  const inject = propOf(ctx, 'inject')
  if (typeof inject === 'function') {
    // 兜底：inject 的作用域回调只在依赖齐备时重放，若是宿主不认 webServer
    // 这个依赖名，回调可能永远不来。所以先就地抢一次，拿不到再等重放。
    offerRoutes(ctx)
    try {
      const fiber = inject.call(ctx, ['tools', 'webServer'], (scope) => {
        offerTool(scope)
        offerRoutes(scope)
      })
      Promise.resolve(fiber).catch((error) => {
        writeLog('toolScopeEnded', [oneLine(error?.message ?? error, 300)])
      })
    } catch (error) {
      writeLog('toolUnavailable', [oneLine(error?.message ?? error, 300)])
      offerTool(ctx)
      offerRoutes(ctx)
    }
  } else {
    offerTool(ctx)
    offerRoutes(ctx)
  }

  const runSafely = (mode) => {
    const go = async () => {
      try {
        const report = await beginningRun(mode, ctxRef)
        if (report !== null) writeLog('cycle', [mode, report.status, report.reason])
      } catch (error) {
        writeLog('cycleThrew', [oneLine(error?.message ?? error, 300)])
      }
    }
    void go()
  }

  /**
   * 定期清理。
   *
   * 放在每次定时器触发前，而不是另起一个定时器：调度器本来就按当前设置走，
   * 清理跟着它走就不会出现「两个节奏各跑各的、改了设置只有一个生效」。
   * 启动时也跑一次（见下面的 pruneAll(settings, new Date())），保证长时间不开
   * DSH 的用户一进来就看不到过期记录。
   */
  const runCleanup = () => {
    try {
      pruneAll(settingsOf(ctxRef.config), new Date())
    } catch (error) {
      writeLog('routeFailed', [oneLine(error?.message ?? error, 200)])
    }
  }
  runCleanup()

  /**
   * 定时器改成「每次重排」，而不是一次性 setInterval。
   *
   * setInterval 把间隔焊死在注册那一刻：用户在设置页把间隔从 1440 分钟改成 60，
   * 旧定时器还会按 1440 走，等于设置没生效。现在每次触发后按当前设置重新排，
   * 设置页改完顺手重排一次，改完立刻按新节奏走。
   *
   * 这里不因为启动时 enabled=false 就提前 return：那样 ctxRef.reschedule 永远不会赋值，
   * 用户在设置页重新打开定时检查后没有任何东西能把它启动起来。调度器一律建好，
   * 由 scheduleNext 自己看 enabled 决定排不排。
   */
  let scheduled = null
  let stopped = false
  let firstPending = true

  const clearScheduled = () => {
    ctxRef.pendingMinutes = null
    if (scheduled === null) return
    try {
      clearTimeout(scheduled)
    } catch {}
    scheduled = null
  }

  const scheduleNext = () => {
    if (stopped) return
    clearScheduled()
    const live = settingsOf(ctxRef.config)
    if (!live.enabled) {
      writeLog('disabledBySettings', [])
      return
    }
    // 启动后第一次仍然只看 firstDelayMinutes，之后按当前调度模式算。
    const minutes = firstPending && live.checkOnStart ? live.firstDelayMinutes : nextDelayMinutes(live, new Date())
    firstPending = false
    // 记下这一轮真实的等待时长，设置页按它显示「下一轮」。
    // 直接拿 nextDelayMinutes 算会漏掉启动后那次短期检查：明明 5 分钟后就要跑，
    // 面板却显示 1440 分钟，看的人只会以为「启动后根本不查」，于是手动点一次。
    ctxRef.pendingMinutes = minutes
    const handle = setTimeout(() => {
      scheduled = null
      runCleanup()
      runSafely('update')
      scheduleNext()
    }, Math.max(minutes, 0) * 60000)
    handle.unref?.()
    scheduled = handle
  }

  /** 设置页保存后调用：立即按新设置重排。 */
  const reschedule = () => {
    firstPending = false
    scheduleNext()
  }
  ctxRef.reschedule = reschedule

  scheduleNext()
  timers.push(() => {
    stopped = true
    clearScheduled()
  })

  // 设置页要能读到运行状态并改设置，所以路由最后注册、且与 enabled 无关：
  // 关掉定时检查之后，用户仍然要能看到这一页并把它重新打开。
  if (!settings.enabled) writeLog('disabledByConfig', [])

  const stop = () => {
    for (const off of timers.splice(0)) {
      try {
        off()
      } catch {}
    }
  }
  const on = propOf(ctx, 'on')
  if (typeof on === 'function') {
    try {
      on.call(ctx, 'dispose', stop)
    } catch {}
  }

  writeLog('ready', [settings.intervalMinutes, settings.autoApply === true, settings.hotReload === true])
}




