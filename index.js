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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

export const name = 'dsh-aupdate'

const LOG_MAX_BYTES = 1_000_000
/** 一次查询里同时在飞的 registry 请求数。 */
const FETCH_CONCURRENCY = 6
/** 单个包安装的上限；实测最慢 1m51s。 */
const INSTALL_TIMEOUT_MS = 420_000
const RELOAD_TIMEOUT_MS = 180_000
/** 这些包的 dist-tags.latest 落后于 next。 */
const NEXT_TAG_SCOPES = ['@deepseek-ai/dsh-']
const NPM_NAME_RE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu

let lastRun = null
let running = null

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

function writeLog(message) {
  try {
    console.log('[dsh-aupdate] ' + oneLine(message, 400))
  } catch {}
  try {
    logQueue.push('[' + new Date().toISOString() + '] ' + oneLine(message) + '\n')
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

/** 防御性读属性：Cordis 对未声明的读会抛。 */
function propOf(target, key) {
  try {
    return target?.[key]
  } catch {
    return undefined
  }
}

function serviceOf(ctx, key) {
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
  'enabled', 'autoApply', 'hotReload', 'checkOnStart', 'idleOnly',
  'intervalMinutes', 'firstDelayMinutes', 'exclude',
  'allow', 'allowMajor', 'allowPrerelease',
]

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
    if (key === 'exclude' || key === 'allow') {
      next[key] = stringList(raw)
      continue
    }
    if (key === 'intervalMinutes' || key === 'firstDelayMinutes') {
      const value = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(value)) continue
      const min = key === 'intervalMinutes' ? 10 : 0
      const max = key === 'intervalMinutes' ? 10080 : 1440
      next[key] = Math.min(Math.max(Math.round(value), min), max)
      continue
    }
    if (typeof raw === 'boolean') next[key] = raw
    else if (raw === 'true' || raw === 'false') next[key] = raw === 'true'
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
    intervalMinutes: numberSetting(config, 'intervalMinutes', 1440, 10, 10080),
    firstDelayMinutes: numberSetting(config, 'firstDelayMinutes', 5, 0, 1440),
    exclude: stringList(config?.exclude),
    allow: stringList(config?.allow),
    // 默认允许跨大版本：这些都是 0.x 插件，按 semver 卡大版本等于几乎不更新。
    allowMajor: booleanSetting(config, 'allowMajor', true),
    // 默认不装预发布。注意：走 next 标签的包（@deepseek-ai/dsh-*）是显式选择，
    // 不受这一条限制，否则 DSH 本体永远停在旧版本上。
    allowPrerelease: booleanSetting(config, 'allowPrerelease', false),
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
  allow: { type: 'array', meta: { default: [], description: '只更新这些包（留空表示全部）' } },
  allowMajor: { type: 'boolean', meta: { default: true, description: '允许跨大版本更新' } },
  allowPrerelease: { type: 'boolean', meta: { default: false, description: '允许安装预发布版本' } },
}

const DICT = {
  enabled: 1, autoApply: 2, hotReload: 3, checkOnStart: 4, idleOnly: 5,
  intervalMinutes: 6, firstDelayMinutes: 7, exclude: 8,
  allow: 11, allowMajor: 12, allowPrerelease: 13,
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
    11: FIELDS.allow,
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

let historyCache = null

function readHistory() {
  if (historyCache !== null) return historyCache
  const raw = readJson(historyPath())
  const rows = Array.isArray(raw?.entries) ? raw.entries : []
  historyCache = rows.filter((row) => row !== null && typeof row === 'object')
  return historyCache
}

function appendHistory(row) {
  try {
    const rows = readHistory().slice()
    rows.unshift(row)
    historyCache = rows.slice(0, HISTORY_MAX)
    const file = historyPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ entries: historyCache }, null, 2) + '\n', 'utf8')
  } catch {
    // 记不上历史不影响更新本身，绝不能让它把这一轮搞挂。
    historyCache = null
  }
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
  if (a === null || b === null) return { ok: false, why: '版本号无法比较' }
  if (compareVersions(target, current) <= 0) return { ok: false, why: '已经是最新' }
  if (a.pre !== null && tag !== 'next' && !settings.allowPrerelease) {
    return { ok: false, why: '是预发布版本，未允许' }
  }
  if (!settings.allowMajor && a.major !== b.major) {
    return { ok: false, why: '跨大版本（' + b.major + ' -> ' + a.major + '），未允许' }
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
function dependencyList(profileDir, exclude, allow = []) {
  const manifest = readJson(join(profileDir, 'package.json'))
  const deps = manifest?.dependencies
  if (deps === null || typeof deps !== 'object') return []
  const skip = new Set(exclude)
  // 白名单非空时就是「只更新这些」；空数组表示不启用白名单。
  const only = new Set(allow)
  const rows = []
  for (const [pkgName, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string') continue
    if (/^(link|file|workspace|portal):/iu.test(spec)) continue
    if (!NPM_NAME_RE.test(pkgName) || skip.has(pkgName)) continue
    if (only.size > 0 && !only.has(pkgName)) continue
    rows.push({ name: pkgName, spec })
  }
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

function tagCacheGet(pkgName) {
  const hit = tagCache.get(pkgName)
  if (hit === undefined) return null
  if (Date.now() - hit.at > TAG_TTL_MS) {
    tagCache.delete(pkgName)
    return null
  }
  return hit.tags
}

function tagCacheSet(pkgName, tags) {
  tagCache.set(pkgName, { at: Date.now(), tags })
  // 缓存不设上限会随着 profile 换包一直长；几百个包就够用，超出就丢最旧的。
  if (tagCache.size > 400) {
    const oldest = tagCache.keys().next()
    if (!oldest.done) tagCache.delete(oldest.value)
  }
}

async function registryTags(pkgName) {
  const cached = tagCacheGet(pkgName)
  if (cached !== null) return cached
  const url = 'https://registry.npmjs.org/-/package/' + pkgName.replace('/', '%2f') + '/dist-tags'
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('registry ' + response.status)
  const tags = await response.json()
  if (tags === null || typeof tags !== 'object') throw new Error('没有 dist-tags')
  tagCacheSet(pkgName, tags)
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

async function installOne(runner, profileName, profileDir, pkgName, version) {
  const args = [...runner.prefix, 'plugin', '--profile', profileName, 'add', pkgName + '@' + version]
  const result = await runOnce(runner.command, args, {
    cwd: profileDir,
    env: { ...runner.env, CI: '1' },
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
    return { status: 'unavailable', reason: '这里没有能换插件的服务，已装好但要重启才生效' }
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
        if (timedOut) return { status: 'applying', reason: '换代码还没结束，稍后再看一次' }
        break
      } catch (error) {
        if (isNestedTransaction(error) && attempt < 9) {
          await new Promise((resolvePromise) => {
            setTimeout(resolvePromise, 250 * (attempt + 1))
          })
          if (timedOut) return { status: 'applying', reason: '换代码还在排队，稍后再看一次' }
          continue
        }
        throw error
      }
    }
    const warnings = Array.isArray(result?.warnings) ? result.warnings.map((item) => oneLine(item, 300)) : []
    const restartReason = typeof result?.restartReason === 'string' ? result.restartReason : null
    if (restartReason !== null) return { status: 'restart', reason: oneLine(restartReason, 400), warnings }
    if (warnings.length > 0) return { status: 'blocked', reason: oneLine(warnings[0], 400), warnings }
    return { status: 'done', reason: '插件已换好，界面没重开', warnings }
  } catch (error) {
    return { status: 'failed', reason: oneLine(error?.message ?? error, 400) }
  }
}
function beginningRun(mode, ctxRef) {
  if (running !== null) return null
  const promise = runCycle(mode, ctxRef).finally(() => {
    running = null
  })
  running = promise
  return promise
}

async function runCycle(mode, ctxRef) {
  const settings = settingsOf(ctxRef.config)
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
  }
  try {
    const profileDir = profileDirOf(ctxRef.ctx)
    const profileName = basename(profileDir)
    const deps = dependencyList(profileDir, settings.exclude, settings.allow)
    report.checked = deps.length
    if (deps.length === 0) {
      report.reason = '这个 profile 里没有可检查的依赖'
      return report
    }
    for (let i = 0; i < deps.length; i += FETCH_CONCURRENCY) {
      // 每批之间让出一次事件循环：同步读 package.json 和结果合批都在主线程上，
      // 一口气跑完 24 个包会让界面掉帧。setImmediate 只让一次，代价可以忽略。
      if (i > 0) await new Promise((settle) => setImmediate(settle))
      const batch = deps.slice(i, i + FETCH_CONCURRENCY)
      const answers = await Promise.all(batch.map(async (dep) => {
        const current = installedVersion(profileDir, dep.name, dep.spec)
        try {
          const tags = await registryTags(dep.name)
          const tag = distTagFor(dep.name)
          const target = typeof tags[tag] === 'string' ? tags[tag] : null
          if (target === null) return { name: dep.name, current, why: '没有 ' + tag + ' 标签' }
          if (current === null) return { name: dep.name, current, why: '读不到已装版本' }
          const verdict = upgradeVerdict(target, current, tag, settings)
          if (!verdict.ok) {
            // 「已经是最新」不算异常，不必出现在 skipped 里。
            if (verdict.why === '已经是最新') return null
            return { name: dep.name, current, target, why: verdict.why }
          }
          return { name: dep.name, current, target, tag }
        } catch (error) {
          return { name: dep.name, current, why: '查不到：' + oneLine(error?.message ?? error, 120) }
        }
      }))
      for (const answer of answers) {
        if (answer === null) continue
        if (typeof answer.target === 'string') report.updates.push(answer)
        else report.skipped.push(answer)
      }
    }
    writeLog('checked ' + report.checked + ' package(s), ' + report.updates.length + ' update(s) available')
    if (report.updates.length === 0) {
      report.reason = '没有可更新的插件'
      return report
    }
    if (mode === 'check' || !settings.autoApply) {
      report.reason = '只查不装'
      return report
    }
    const busy = runningSubagents(ctxRef.ctx)
    if (busy.length > 0) {
      report.status = 'blocked'
      report.reason = '还有 ' + busy.length + ' 个子任务在跑，这一轮不安装'
      writeLog('apply skipped: ' + busy.length + ' subagent(s) running')
      return report
    }
    const runner = cliRunner()
    if (runner === null) {
      report.status = 'failed'
      report.reason = '找不到 dsh 命令行入口，无法安装'
      return report
    }
    const requiredBefore = activeEntryIds(ctxRef.ctx)
    // 自身放到最后：换掉自身之后，这一轮剩下的代码就来自旧模块了。
    const ordered = report.updates.slice().sort((a, b) => (a.name === name ? 1 : b.name === name ? -1 : 0))
    for (const update of ordered) {
      const outcome = await installOne(runner, profileName, profileDir, update.name, update.target)
      report.installed.push(outcome)
      writeLog('install ' + update.name + '@' + update.target + ' -> ' + (outcome.ok ? 'ok' : 'failed: ' + outcome.detail))
      if (outcome.ok) {
        appendHistory({
          at: new Date().toISOString(),
          name: update.name,
          from: update.current,
          to: update.target,
          tag: update.tag,
          profile: profileName,
          rolledBack: false,
        })
      }
    }
    const okCount = report.installed.filter((item) => item.ok).length
    if (okCount === 0) {
      report.status = 'failed'
      report.reason = '一个包都没装成'
      return report
    }
    if (!settings.hotReload) {
      report.reload = { status: 'skipped', reason: '装好了，热生效是关的，重启后生效' }
      report.reason = '已安装 ' + okCount + ' 个，待重启'
      return report
    }
    if (settings.idleOnly && runningSubagents(ctxRef.ctx).length > 0) {
      report.reload = { status: 'cancelled', reason: '安装期间有子任务开跑，这一次不换代码' }
      report.reason = '已安装 ' + okCount + ' 个，未热生效'
      return report
    }
    report.reload = await hotApply(ctxRef.ctx, requiredBefore)
    writeLog('hot apply -> ' + report.reload.status + (report.reload.reason ? ': ' + report.reload.reason : ''))
    report.reason = '已安装 ' + okCount + ' 个；' + (report.reload.reason ?? '')
    if (report.reload.status === 'failed') report.status = 'failed'
    else if (report.reload.status === 'blocked' || report.reload.status === 'restart') report.status = 'partial'
    return report
  } catch (error) {
    report.status = 'failed'
    report.reason = oneLine(error?.message ?? error, 400)
    writeLog('cycle failed: ' + report.reason)
    return report
  } finally {
    report.finishedAt = new Date().toISOString()
    lastRun = {
      status: report.status,
      at: report.finishedAt,
      checked: report.checked,
      updates: report.updates.map((item) => item.name + ' ' + (item.current ?? '?') + ' -> ' + item.target),
      installed: report.installed.map((item) => item.name + '@' + item.version + (item.ok ? '' : ' 失败')),
      reload: report.reload?.status ?? 'none',
      reason: report.reason,
    }
  }
}
/**
 * 回滚到某一次更新之前的版本。
 *
 * 只允许回滚「本插件自己装上去的那一次」：from 必须是历史上记下来的旧版本，
 * 否则就成了任意版本降级出口，风险比自动更新本身还大。
 */
async function rollbackOne(ctxRef, entryName) {
  const settings = settingsOf(ctxRef.config)
  const row = readHistory().find((item) => item.name === entryName && item.rolledBack !== true)
  if (row === undefined) return { ok: false, reason: '没有可回滚的记录：' + entryName }
  const profileDir = profileDirOf(ctxRef.ctx)
  const profileName = basename(profileDir)
  const runner = cliRunner()
  if (runner === null) return { ok: false, reason: '找不到 dsh 命令行入口' }
  const outcome = await installOne(runner, profileName, profileDir, row.name, row.from)
  writeLog('rollback ' + row.name + ' ' + row.to + ' -> ' + row.from + ' -> ' + (outcome.ok ? 'ok' : 'failed: ' + outcome.detail))
  if (!outcome.ok) return { ok: false, reason: outcome.detail }
  appendHistory({
    at: new Date().toISOString(),
    name: row.name,
    from: row.to,
    to: row.from,
    tag: 'rollback',
    profile: profileName,
    rolledBack: true,
  })
  let reload = { status: 'skipped', reason: '回滚完成，重启后生效' }
  if (settings.hotReload) reload = await hotApply(ctxRef.ctx, [])
  return { ok: true, name: row.name, to: row.from, reload: reload.status }
}

function registerTool(ctx, config) {
  const tools = serviceOf(ctx, 'tools')
  if (tools === null || typeof tools.register !== 'function') return false
  const effect = propOf(ctx, 'effect')
  if (typeof effect !== 'function') return false
  const empty = { status: 'busy', reason: '上一轮还没跑完', checked: 0, updates: [], installed: [], reload: 'none' }
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
        render: (_args, value) => [{ type: 'text', text: '插件更新 · ' + (value?.reason || value?.status || '') }],
      },
      execute: async (args) => {
        try {
          const action = args?.action === 'check' || args?.action === 'update' ? args.action : 'status'
          if (action === 'status') {
            const seen = lastRun
            if (seen === null) return { status: 'done', reason: '还没跑过', checked: 0, updates: [], installed: [], reload: 'none' }
            return {
              status: seen.status,
              reason: '上一次：' + seen.at + '；' + (seen.reason || seen.status),
              checked: seen.checked,
              updates: seen.updates,
              installed: seen.installed,
              reload: seen.reload,
            }
          }
          const report = await beginningRun(action, { ctx, config })
          if (report === null) return empty
          return {
            status: report.status,
            reason: report.reason || '',
            checked: report.checked,
            updates: report.updates.map((item) => item.name + ' ' + (item.current ?? '?') + ' -> ' + item.target),
            installed: report.installed.map((item) => item.name + '@' + item.version + (item.ok ? '' : ' 失败')),
            reload: report.reload?.status ?? 'none',
            skipped: report.skipped.map((item) => item.name + '：' + item.why),
          }
        } catch (error) {
          writeLog('tool failed: ' + oneLine(error?.message ?? error, 300))
          return { status: 'failed', reason: '没能完成，插件状态需要核对', checked: 0, updates: [], installed: [], reload: 'none' }
        }
      },
    }), 'auto-update: plugin_updater')
    return true
  } catch (error) {
    writeLog('cannot offer the tool: ' + oneLine(error?.message ?? error, 300))
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

function settingsSnapshot(config) {
  const settings = settingsOf(config)
  return {
    settings,
    overrides: readOverrides(),
    lastRun: lastRun === null ? null : {
      status: lastRun.status,
      reason: lastRun.reason,
      at: lastRun.at,
      checked: lastRun.checked,
      updates: lastRun.updates,
      installed: lastRun.installed,
      reload: lastRun.reload,
    },
    path: settingsPath(),
    history: readHistory().slice(0, 40),
    historyPath: historyPath(),
  }
}

function registerRoutes(ctx, ctxRef) {
  const webServer = serviceOf(ctx, 'webServer')
  if (webServer === null || typeof webServer.register !== 'function') {
    writeLog('webServer unavailable: settings page will report it')
    return false
  }
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const suffix = url.pathname.slice(ROUTE_PREFIX.length)
      const method = req.method ?? 'GET'
      if (method === 'GET' || method === 'HEAD') {
        if (suffix === '/state') {
          sendJson(res, 200, settingsSnapshot(ctxRef.config))
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
          writeLog('settings updated by page: ' + Object.keys(body).join(','))
          // 改完立刻按新设置重排，否则要等下一次触发才换节奏。
          try {
            if (typeof ctxRef.reschedule === 'function') ctxRef.reschedule()
          } catch (error) {
            writeLog('reschedule failed: ' + oneLine(error?.message ?? error, 200))
          }
          sendJson(res, 200, settingsSnapshot(ctxRef.config))
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
          writeLog('rollback request ' + target + ' -> ' + (outcome.ok ? 'ok' : 'failed: ' + outcome.reason))
          sendJson(res, outcome.ok ? 200 : 409, outcome)
          return
        }
        if (suffix === '/run') {
          const body = await readBody(req)
          const mode = body?.mode === 'check' ? 'check' : 'update'
          const report = await beginningRun(mode, ctxRef)
          if (report === null) {
            sendJson(res, 200, { started: false, reason: '已经有一轮在跑' })
            return
          }
          sendJson(res, 200, { started: true, status: report.status, reason: report.reason })
          return
        }
        sendJson(res, 404, { error: 'unknown endpoint' })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
    } catch (error) {
      writeLog('route failed: ' + oneLine(error?.message ?? error, 300))
      try { sendJson(res, 500, { error: 'internal' }) } catch {}
    }
  }
  try {
    const effect = propOf(ctx, 'effect')
    const register = () => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
    if (typeof effect === 'function') {
      effect.call(ctx, register, 'auto-update: settings routes')
      writeLog('settings route ready: ' + ROUTE_PREFIX)
      return true
    }
    register()
    writeLog('settings route ready (no effect scope): ' + ROUTE_PREFIX)
    return true
  } catch (error) {
    writeLog('cannot register settings route: ' + oneLine(error?.message ?? error, 300))
    return false
  }
}

export { compareVersions, distTagFor, cliRunner, dependencyList, installedVersion, registryTags, hotApply, runCycle, settingsOf, readOverrides, writeOverrides }

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
        writeLog('tool registered: false')
        return
      }
      if (toolService === tools) return
      toolService = tools
      const ok = registerTool(scope, config)
      writeLog('tool registered: ' + ok)
    } catch (error) {
      writeLog('tool registration threw: ' + oneLine(error?.message ?? error, 300))
    }
  }
  const inject = propOf(ctx, 'inject')
  if (typeof inject === 'function') {
    try {
      const fiber = inject.call(ctx, ['tools'], offerTool)
      Promise.resolve(fiber).catch((error) => {
        writeLog('tool scope ended: ' + oneLine(error?.message ?? error, 300))
      })
    } catch (error) {
      writeLog('cannot offer the tool: ' + oneLine(error?.message ?? error, 300))
      offerTool(ctx)
    }
  } else {
    offerTool(ctx)
  }

  const runSafely = (mode) => {
    const go = async () => {
      try {
        const report = await beginningRun(mode, ctxRef)
        if (report !== null) writeLog('cycle ' + mode + ' -> ' + report.status + ': ' + report.reason)
      } catch (error) {
        writeLog('cycle threw: ' + oneLine(error?.message ?? error, 300))
      }
    }
    void go()
  }

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
      writeLog('settings say disabled; scheduler parked')
      return
    }
    // 第一次看 firstDelayMinutes，之后看 intervalMinutes。
    const minutes = firstPending && live.checkOnStart ? live.firstDelayMinutes : live.intervalMinutes
    firstPending = false
    const handle = setTimeout(() => {
      scheduled = null
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
  registerRoutes(ctx, ctxRef)
  if (!settings.enabled) writeLog('disabled by config; scheduler parked, settings page still live')

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

  writeLog('ready: every ' + settings.intervalMinutes + ' min, autoApply=' + settings.autoApply + ', hotReload=' + settings.hotReload)
}




