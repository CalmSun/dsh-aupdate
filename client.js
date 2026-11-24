window.__ModuleLoader__.load({
  id: 'dsh-aupdate',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const NS = 'dsh-aupdate'
    const API = 'api/dsh-aupdate'

    const COPY = {
      zh: {
        title: '插件自动更新',
        subtitle: '定时检查 registry，发现新版本就装好并就地生效',
        unavailable: '读不到设置：后端路由没起来（插件仍会按默认设置自动更新）',
        retry: '重试',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        savedHint: '新设置立即生效，不用重启',
        failed: '保存失败',
        runNow: '立刻检查',
        running: '正在检查…',
        runDone: '检查完成',
        runFailed: '检查没能完成',
        lastRun: '上一次',
        never: '还没跑过',
        checked: '检查了',
        packages: '个包',
        updates: '个可更新',
        upToDate: '全部都是最新的',
        enabled: '启用定时检查',
        enabledHint: '关掉之后不再自动跑，设置页仍然可用',
        autoApply: '自动安装新版本',
        autoApplyHint: '关闭则只检查、不安装',
        hotReload: '装完就地生效',
        hotReloadHint: '关闭则需要手动重启才用上新版本',
        checkOnStart: '启动后先查一次',
        idleOnly: '有子任务时不换代码',
        idleOnlyHint: '避免在别的任务跑到一半时替换模块',
        interval: '检查间隔',
        intervalHint: '分钟，10 到 10080（一周）',
        schedule: '调度方式',
        scheduleHint: '选一种节奏；各模式参数互相独立，切换不丢值',
        modeMinutes: '每 N 分钟',
        modeHours: '每 N 小时',
        modeDays: '每 N 天',
        modeDaily: '每天固定时刻',
        dailyAt: '每天几点',
        dailyAtHint: '24 小时制 HH:MM，按本机时区',
        everyHours: '间隔小时数',
        everyHoursHint: '1 到 168（一周）',
        everyDays: '间隔天数',
        everyDaysHint: '1 到 30',
        nextRun: '下一轮',
        suppress: '失败后暂停重试',
        suppressHint: '小时；同一版本装失败后这段时间不再试，0 表示每轮都试',
        suppressOn: '抑制中',
        firstDelay: '启动后延迟',
        firstDelayHint: '分钟，0 表示立刻',
        exclude: '不自动更新的包',
        excludeHint: '每行一个包名',
        allowHint: '每行一个包名；留空表示全部包都参与',
        allowMajor: '允许跨大版本',
        allowMajorHint: '关闭后只在同一主版本内升级（0.x 插件多半会因此长期不动）',
      maxPerCycle: '一轮最多装几个',
      maxPerCycleHint: '0 表示不限。装包会一直占着 pnpm 锁，限一个数就把单次占用封顶，剩下的下一轮接着装',
      sessionIdle: '会话静默（分钟）',
      sessionIdleHint: '会话文件这么多分钟没写入才算闲。0 表示只看有没有子任务在跑',
      gateUnknown: '看不到会话目录，只按子任务判断',
      gateSessionAge: '最近一次会话写入在 {n} 分钟前',
      gateLocked: '另一个进程正在装：{who}',
        allowPrerelease: '允许预发布版本',
        allowPrereleaseHint: '关闭时只装正式版；走 next 标签的 DSH 本体不受影响',
        logs: '运行日志',
        logsHint: '插件最近写了什么。装完包、查到新版本、失败原因都在这里',
        logsEmpty: '还没有日志；这个 profile 下这次启动还没跑过检查',
        logsMissing: '日志文件不存在（还没跑过，或被删了）',
        logsLines: '显示行数',
        logsRefresh: '刷新',
        logsAuto: '自动刷新',
        logsAutoHint: '每 5 秒拉一次，正在排查时开着',
        logsRotated: '日志已超过 1MB，旧内容在 .old 里',
        logsTotal: '共 {n} 行',
        logsNewest: '最新的在最上面',
        notify: '发现更新时提醒我',
        notifyHint: '在界面右下角弹一条提醒，列出可更新的插件和「当前 → 新」版本；同一批更新只提醒一次',
        pkgsExclude: '不自动更新的包',
        pkgsExcludeHint: '勾上的插件永远不自动更新；一个都不勾表示全部参与自动更新',
        pkgsSearch: '搜索插件名',
        pkgsAll: '全选',
        pkgsNone: '清空',
        pkgsEmpty: '这个 profile 里没有可自动更新的插件',
        pkgsCount: '已勾选 {n} 个',
        pkgsNotInstalled: '未安装',
        pkgsNoMatch: '没有匹配的插件',
        pageLabel: '插件更新',
        language: '显示语言',
        languageHint: '只换这个设置页和提醒的文案，不改插件的更新行为',
        langAuto: '跟随系统',
        langZh: '中文',
        langEn: 'English',
        toastTitle: '{n} 个插件可以更新',
        toastMore: '还有 {n} 个',
        toastDismiss: '知道了',
        keepTitle: '保留期限',
        keepHint: '到期自动清掉旧的更新记录与运行日志；0 表示一直保留。回滚记录会和对应更新一起保留',
        keepHistory: '更新记录保留',
        keepLog: '运行日志保留',
        keepDay: '天',
        keepForever: '永久保留',
        cleanNow: '立即清理',
        cleaning: '清理中…',
        cleanDone: '已清理 {n} 条',
        cleanNothing: '没有需要清理的',
        cleanFail: '清理失败',
        history: '更新记录',
        historyEmpty: '还没有安装过任何更新',
        rollback: '回滚',
        rollingBack: '回滚中…',
        rollbackDone: '已回滚',
        rollbackFailed: '回滚失败',
        rolledBack: '已回滚',
        policy: '更新策略',
        minutes: '分钟',
        scope: '这些设置只影响本机这个 profile',
      },
      en: {
        title: 'Plugin auto-update',
        subtitle: 'Checks the registry on a timer and applies new versions in place',
        unavailable: 'Cannot read settings: the backend route is not up (defaults still apply)',
        retry: 'Retry',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        savedHint: 'Takes effect immediately, no restart',
        failed: 'Save failed',
        runNow: 'Check now',
        running: 'Checking…',
        runDone: 'Check finished',
        runFailed: 'Check could not finish',
        lastRun: 'Last run',
        never: 'never',
        checked: 'checked',
        packages: 'packages',
        updates: 'updates',
        upToDate: 'everything is current',
        enabled: 'Scheduled checks',
        enabledHint: 'Turn off to stop automatic runs; this page keeps working',
        autoApply: 'Install new versions',
        autoApplyHint: 'Off means check only, never install',
        hotReload: 'Apply in place',
        hotReloadHint: 'Off needs a manual restart to use new versions',
        checkOnStart: 'Check shortly after start',
        idleOnly: 'Skip while subagents run',
        idleOnlyHint: 'Avoids swapping modules mid-task',
        interval: 'Interval',
        intervalHint: 'minutes, 10 to 10080 (one week)',
        schedule: 'Schedule',
        scheduleHint: 'Pick one rhythm; each mode keeps its own value',
        modeMinutes: 'Every N minutes',
        modeHours: 'Every N hours',
        modeDays: 'Every N days',
        modeDaily: 'Daily at a fixed time',
        dailyAt: 'Time of day',
        dailyAtHint: '24-hour HH:MM in local time',
        everyHours: 'Hours between runs',
        everyHoursHint: '1 to 168 (one week)',
        everyDays: 'Days between runs',
        everyDaysHint: '1 to 30',
        nextRun: 'Next run',
        suppress: 'Pause retries after a failure',
        suppressHint: 'hours; a failed version is skipped this long, 0 retries every cycle',
        suppressOn: 'suppressed',
        firstDelay: 'First delay',
        firstDelayHint: 'minutes, 0 means immediately',
        exclude: 'Never auto-update',
        excludeHint: 'one package name per line',
        allowHint: 'one package name per line; empty means every package',
        allowMajor: 'Allow major upgrades',
        allowMajorHint: 'Off keeps upgrades inside one major; 0.x plugins would rarely move',
      maxPerCycle: 'Installs per cycle',
      maxPerCycleHint: '0 means no limit. pnpm holds a lock for the whole install, so a cap bounds how long the profile stays busy; the rest wait for the next cycle',
      sessionIdle: 'Session quiet window (minutes)',
      sessionIdleHint: 'Session files must be untouched this long to count as idle. 0 judges by running subagents only',
      gateUnknown: 'session directory not readable; judging by subagents only',
      gateSessionAge: 'last session write {n} min ago',
      gateLocked: 'another process is installing: {who}',
        allowPrerelease: 'Allow prereleases',
        allowPrereleaseHint: 'Off installs stable only; DSH itself on the next tag is unaffected',
        logs: 'Run log',
        logsHint: 'What the plugin has been doing: installs, new versions found, failure reasons',
        logsEmpty: 'No log lines yet; no check has run in this profile since it started',
        logsMissing: 'Log file does not exist (never ran, or it was deleted)',
        logsLines: 'Lines',
        logsRefresh: 'Refresh',
        logsAuto: 'Auto refresh',
        logsAutoHint: 'Polls every 5s; turn it on while debugging',
        logsRotated: 'Log passed 1MB; older content is in .old',
        logsTotal: '{n} lines',
        logsNewest: 'newest first',
        notify: 'Tell me when updates are found',
        notifyHint: 'Pops a notice in the bottom-right corner listing the plugins that can update and their current → new versions; each batch is announced once',
        pkgsExclude: 'Never auto-update',
        pkgsExcludeHint: 'Checked plugins are never updated automatically; nothing checked means everything takes part',
        pkgsSearch: 'Search plugin names',
        pkgsAll: 'All',
        pkgsNone: 'None',
        pkgsEmpty: 'This profile has no plugins that can auto-update',
        pkgsCount: '{n} selected',
        pkgsNotInstalled: 'not installed',
        pkgsNoMatch: 'Nothing matches',
        pageLabel: 'Plugin updates',
        language: 'Display language',
        languageHint: 'Changes the wording of this page and its notices, not what the plugin updates',
        langAuto: 'Follow the system',
        langZh: '中文',
        langEn: 'English',
        toastTitle: '{n} plugin(s) can update',
        toastMore: 'and {n} more',
        toastDismiss: 'Got it',
        keepTitle: 'Retention',
        keepHint: 'Older update records and log lines are removed automatically; 0 means keep forever. A rollback is kept together with the update it reverses',
        keepHistory: 'History retention',
        keepLog: 'Log retention',
        keepDay: 'days',
        keepForever: 'Keep forever',
        cleanNow: 'Clean now',
        cleaning: 'Cleaning…',
        cleanDone: 'Removed {n} entries',
        cleanNothing: 'Nothing to clean',
        cleanFail: 'Cleanup failed',
        history: 'Update history',
        historyEmpty: 'No update has been installed yet',
        rollback: 'Roll back',
        rollingBack: 'Rolling back…',
        rollbackDone: 'Rolled back',
        rollbackFailed: 'Rollback failed',
        rolledBack: 'rolled back',
        policy: 'Update policy',
        min: 'min',
        scope: 'These settings apply to this profile only',
      },
    }

    function detectZh() {
      try {
        const lang = window.navigator?.language || ''
        if (/^zh/iu.test(lang)) return true
        const html = document.documentElement?.lang || ''
        return /^zh/iu.test(html)
      } catch {
        return true
      }
    }

    /**
     * 显示语言。
     *
     * 原来在模块加载时算一次就定死了：中文系统永远中文、英文系统永远英文，用户在
     * 设置页里改不了。现在语言是可变状态——applyLang 换掉 T 并通知所有订阅者重渲染，
     * 选择本身存进设置覆盖层（settings.lang），换个浏览器打开也还是这个选择。
     */
    const AUTOLANG = detectZh() ? 'zh' : 'en'
    const LANG_CHOICES = ['auto', 'zh', 'en']
    let LANG = AUTOLANG
    let LOCALE = LANG === 'zh' ? 'zh-CN' : 'en-US'
    let T = COPY[LANG]
    const langListeners = new Set()

    /** 把 auto / zh / en 落成实际语言；认不出的值一律当 auto。 */
    function resolveLang(choice) {
      return choice === 'zh' || choice === 'en' ? choice : AUTOLANG
    }

    function applyLang(choice) {
      const next = resolveLang(choice)
      if (next === LANG) return
      LANG = next
      LOCALE = LANG === 'zh' ? 'zh-CN' : 'en-US'
      T = COPY[LANG]
      for (const listener of langListeners) {
        try { listener() } catch {}
      }
    }

    /**
     * 订阅语言变化。
     *
     * 每个直接渲染 T 的组件都要调一次：否则切换时只有拿到新状态的组件更新，其余部分
     * 停在旧语言上——一页里中英混排，比不支持切换更难看。
     */
    function useLang() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((n) => n + 1)
        langListeners.add(listener)
        return () => { langListeners.delete(listener) }
      }, [])
    }

    /**
     * 时间必须先转成浏览器本地时区再显示。
     *
     * 后端存的是 ISO UTC（…Z）。之前直接 replace('T',' ').slice(0,19) 拿到的是 UTC 字面量，
     * 在东八区就整整差了 8 小时——用户看到的「14:30」其实是本地 22:30。
     * 用 Intl 按本地时区格式化，跨时区都不会错。
     */
    function formatWhen(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) return iso
      try {
        return new Intl.DateTimeFormat(LOCALE, {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).format(when)
      } catch {
        const pad = (n) => String(n).padStart(2, '0')
        return when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) +
          ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes()) + ':' + pad(when.getSeconds())
      }
    }

    /**
     * 日志行的时间只到 月-日 时:分:秒。
     *
     * 整条「2026-11-24 09:14:13」占掉一行近四分之一宽度，而日志的重点是内容，
     * 年份在同一个文件里几乎不可能变。缩成短格式后一行能放进更多正文。
     */
    function formatLogWhen(iso) {
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) return String(iso ?? '')
      const pad = (n) => String(n).padStart(2, '0')
      return pad(when.getMonth() + 1) + '-' + pad(when.getDate()) +
        ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes()) + ':' + pad(when.getSeconds())
    }

    /** 「上一次」的光看绝对时间不好判断新鲜度，补一句相对时间。 */
    function relativeWhen(iso) {
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) return ''
      const minutes = Math.floor((Date.now() - when.getTime()) / 60000)
      if (minutes < 1) return LANG === 'zh' ? '刚刚' : 'just now'
      if (minutes < 60) return LANG === 'zh' ? minutes + ' 分钟前' : minutes + ' min ago'
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return LANG === 'zh' ? hours + ' 小时前' : hours + ' h ago'
      const days = Math.floor(hours / 24)
      return LANG === 'zh' ? days + ' 天前' : days + ' d ago'
    }

    function endpoint(name) {
      try {
        return new URL(API + '/' + name, document.baseURI).toString()
      } catch {
        return '/' + API + '/' + name
      }
    }

    /** 后端按这个参数渲染原因文本（lastRun.reason 等），所以每个请求都要带上。 */
    function langQuery() {
      return '?lang=' + (LANG === 'en' ? 'en' : 'zh')
    }

    async function getState(lang) {
      const wanted = lang === 'en' ? 'en' : 'zh'
      const response = await fetch(endpoint('state') + '?lang=' + wanted, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('state ' + response.status)
      return response.json()
    }

    async function getLogs(lines, lang) {
      // 日志在磁盘上存的是 code + 参数，正文由后端按这里要的语言渲染。
      const wanted = lang === 'en' ? 'en' : 'zh'
      const response = await fetch(endpoint('logs') + '?lines=' + encodeURIComponent(String(lines)) + '&lang=' + wanted, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('logs ' + response.status)
      return response.json()
    }

    async function saveState(patch) {
      const response = await fetch(endpoint('state') + langQuery(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error('save ' + response.status)
      return response.json()
    }

    /** 手动清理：服务端按当前保留期限删，回报删了多少。 */
    async function cleanup() {
      const response = await fetch(endpoint('cleanup') + langQuery(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('cleanup ' + response.status)
      return response.json()
    }

    async function rollback(name) {
      const response = await fetch(endpoint('rollback') + langQuery(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name }),
      })
      const payload = await response.json().catch(() => null)
      return { ok: response.ok, payload }
    }

    async function runNow(mode) {
      const response = await fetch(endpoint('run') + langQuery(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!response.ok) throw new Error('run ' + response.status)
      return response.json()
    }

    /* ── styles: kept inline so the page needs no build step ───────────── */
    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 2px', fontSize: '13px', lineHeight: 1.5 },
      head: { display: 'flex', flexDirection: 'column', gap: '2px' },
      title: { fontSize: '14px', fontWeight: 600, margin: 0 },
      sub: { opacity: 0.62, fontSize: '12px', margin: 0 },
      card: { border: '1px solid rgba(128,128,128,0.22)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' },
      row: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
      labelBox: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
      label: { fontWeight: 500 },
      hint: { opacity: 0.55, fontSize: '11.5px' },
      input: { width: '96px', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.32)', background: 'transparent', color: 'inherit', fontSize: '13px', textAlign: 'right' },
      area: { width: '100%', minHeight: '58px', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.32)', background: 'transparent', color: 'inherit', fontSize: '12.5px', fontFamily: 'inherit', resize: 'vertical' },
      // select 的宽度比数字框宽：四种模式的中文标签最长「每天固定时刻」。
      select: { padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.32)', background: 'transparent', color: 'inherit', fontSize: '13px', minWidth: '132px' },
      actions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      btn: { padding: '5px 12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.32)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px' },
      btnPrimary: { padding: '5px 12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.32)', background: 'rgba(128,128,128,0.16)', color: 'inherit', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
      status: { fontSize: '12px', opacity: 0.7 },
      err: { fontSize: '12px', color: '#d9534f' },
      meta: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', opacity: 0.7 },
      // 等宽 + 可滚动：日志要能对齐看时间戳，也不能把整页顶长。
      logBox: { margin: 0, padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.22)', background: 'rgba(128,128,128,0.06)', fontSize: '11.5px', lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', maxHeight: '260px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      logTime: { opacity: 0.5, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
      logText: {},
      // 勾选清单：包名可能很长（@scope/name），要能截断，版本靠右对齐。
      // 更新记录可能上百条，不封高度会把整页顶到几屏之外，滚动条交还给这一栏。
      scrollList: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto', paddingRight: '4px' },
      pkgList: { display: 'flex', flexDirection: 'column', gap: '1px', maxHeight: '240px', overflow: 'auto', border: '1px solid rgba(128,128,128,0.22)', borderRadius: '6px', padding: '4px' },
      pkgRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 4px', borderRadius: '4px', cursor: 'pointer' },
      pkgName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      pkgVer: { opacity: 0.5, fontSize: '11px', marginLeft: 'auto', flexShrink: 0 },
      search: { padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.32)', background: 'transparent', color: 'inherit', fontSize: '12.5px' },
    }

    function Toggle(props) {
      const { checked, onChange, disabled } = props
      return h('input', {
        type: 'checkbox',
        checked: checked === true,
        disabled: disabled === true,
        onChange: (event) => onChange(event.target.checked),
        style: { width: '16px', height: '16px', cursor: disabled === true ? 'default' : 'pointer', accentColor: 'currentColor', marginTop: '2px' },
      })
    }

    function SwitchRow(props) {
      const { label, hint, value, onChange, disabled } = props
      return h('div', { style: S.row },
        h('div', { style: S.labelBox },
          h('span', { style: S.label }, label),
          hint ? h('span', { style: S.hint }, hint) : null,
        ),
        h(Toggle, { checked: value, onChange, disabled }),
      )
    }

    function NumberRow(props) {
      const { label, hint, value, onChange, min, max, disabled } = props
      return h('div', { style: S.row },
        h('div', { style: S.labelBox },
          h('span', { style: S.label }, label),
          hint ? h('span', { style: S.hint }, hint) : null,
        ),
        h('input', {
          type: 'number',
          value: value === undefined || value === null ? '' : String(value),
          min: String(min ?? 0),
          max: String(max ?? 100000),
          disabled: disabled === true,
          onChange: (event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          },
          style: S.input,
        }),
      )
    }

    /**
     * HH:MM 输入。用 type="time" 而不是文本框：交给浏览器保证格式，
     * 后端也仍然会校验一次（写坏的设置不该让「每天几点」永远不触发）。
     */
    function ClockRow(props) {
      const { label, hint, value, onChange, disabled } = props
      return h('div', { style: S.row },
        h('div', { style: S.labelBox },
          h('span', { style: S.label }, label),
          hint ? h('span', { style: S.hint }, hint) : null,
        ),
        h('input', {
          type: 'time',
          value: typeof value === 'string' ? value : '03:00',
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.value),
          style: S.input,
        }),
      )
    }

    /**
     * 调度模式选择器。
     *
     * 用原生 select 而不是按钮组：设置页是没有构建步骤的裸客户端脚本，
     * select 在暗色/亮色主题下都由系统负责，比自己画的按钮组更不容易出错。
     */
    function SelectRow(props) {
      const { label, hint, value, options, onChange, disabled } = props
      return h('div', { style: S.row },
        h('div', { style: S.labelBox },
          h('span', { style: S.label }, label),
          hint ? h('span', { style: S.hint }, hint) : null,
        ),
        h('select', {
          value,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.value),
          style: S.select,
        }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
      )
    }

    /**
     * 「现在算不算闲」这一行。
     *
     * 光给两个数字（静默阈值、单轮上限）用户没法判断插件到底在等什么：
     * 明明没在开会话，为什么一直不更新？把服务端算出来的会话年龄和锁持有者
     * 直接摆出来，就不用去翻日志猜。读不到就整行不渲染，不占位置。
     */
    function gateLine(state) {
      const gate = state?.gate
      if (gate === null || gate === undefined) return null
      const parts = []
      if (gate.sessionAgeMinutes === null || gate.sessionAgeMinutes === undefined) {
        parts.push(T.gateUnknown)
      } else {
        parts.push(T.gateSessionAge.replace('{n}', String(gate.sessionAgeMinutes)))
      }
      if (typeof gate.lock === 'string' && gate.lock !== '') {
        parts.push(T.gateLocked.replace('{who}', gate.lock))
      }
      return h('div', { style: S.labelBox },
        h('span', { style: S.hint }, parts.join(' · ')),
      )
    }

    /**
     * 勾选清单。
     *
     * 原来是两个 textarea，让用户一行一个包名敲进去。难用在两处：包名得照着
     * node_modules 手抄，抄错一个字符这条规则就永远不生效、也不会报错；而且看不出
     * 自己填的到底是不是想排除的那个。改成从 /state 拿到的已装清单直接勾。
     */
    function PackagePicker(props) {
      useLang()
      const { packages, selected, onChange } = props
      const [query, setQuery] = useState('')
      const chosen = useMemo(() => new Set(Array.isArray(selected) ? selected : []), [selected])
      const all = useMemo(() => (Array.isArray(packages) ? packages : []), [packages])
      const rows = useMemo(() => {
        const text = query.trim().toLowerCase()
        if (text === '') return all
        return all.filter((item) => String(item.name).toLowerCase().includes(text))
      }, [all, query])

      const commit = (next) => onChange(Array.from(next).sort())

      const toggle = (name) => {
        const next = new Set(chosen)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        commit(next)
      }

      // 全选/清空只作用于当前筛选出来的行：搜索之后再点「全选」，
      // 用户的意思是「把搜到的都勾上」，不是把看不见的也一并改掉。
      const setVisible = (on) => {
        const next = new Set(chosen)
        for (const item of rows) {
          if (on) next.add(item.name)
          else next.delete(item.name)
        }
        commit(next)
      }

      if (all.length === 0) return h('span', { style: S.status }, T.pkgsEmpty)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: S.actions },
          h('input', {
            type: 'search',
            value: query,
            placeholder: T.pkgsSearch,
            onChange: (event) => setQuery(event.target.value),
            style: { ...S.search, flex: '1 1 160px' },
          }),
          h('button', { type: 'button', style: S.btn, onClick: () => setVisible(true) }, T.pkgsAll),
          h('button', { type: 'button', style: S.btn, onClick: () => setVisible(false) }, T.pkgsNone),
          h('span', { style: S.hint }, T.pkgsCount.replace('{n}', String(chosen.size))),
        ),
        h('div', { style: S.pkgList },
          rows.length === 0
            ? h('span', { style: { ...S.status, padding: '4px' } }, T.pkgsNoMatch)
            : rows.map((item) => h('label', { key: item.name, style: S.pkgRow, title: item.name },
                h(Toggle, { checked: chosen.has(item.name), onChange: () => toggle(item.name) }),
                h('span', { style: S.pkgName }, item.name),
                item.version === ''
                  ? h('span', { style: S.pkgVer }, T.pkgsNotInstalled)
                  : h('span', { style: S.pkgVer }, item.version),
              )),
        ),
      )
    }

    function AutoUpdateCard() {
      useLang()
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState(null)
      const [phase, setPhase] = useState('loading') // loading | ready | error
      const [saveHint, setSaveHint] = useState('')
      const [running, setRunning] = useState(false)
      const [runHint, setRunHint] = useState('')
      const [rolling, setRolling] = useState('')
      const [rollHint, setRollHint] = useState('')
      const [confirming, setConfirming] = useState('')
      const [cleaning, setCleaning] = useState(false)
      const [cleanHint, setCleanHint] = useState('')

      const load = useCallback(async () => {
        setPhase('loading')
        try {
          const next = await getState(LANG)
          // 语言先落地再渲染：否则第一屏会先按系统语言画一次，再跳成用户选的。
          applyLang(next?.settings?.lang)
          setState(next)
          setDraft(next.settings)
          setPhase('ready')
        } catch {
          setPhase('error')
        }
        // 这里故意不依赖 LANG。曾经把 LANG 放进依赖，结果是：切到 English 时 load 重跑，
        // 而服务端此刻还存着旧值 auto，于是 applyLang('auto') 把它改回跟随系统、
        // setDraft 又把下拉重置——用户看到的就是「选了 English 自己跳回去」。
      }, [])

      useEffect(() => { void load() }, [load])

      /**
       * 立即保存。
       *
       * 原来是「改一堆 → 点保存」：改完直接关掉页面，改动就全丢了；显示语言这种偏好
       * 尤其容易忘。现在每个改动就地落盘，没有保存按钮。
       *
       * 两件事必须处理对：
       * - 数字框每敲一个字符就触发一次改动，所以攒 350ms 合成一个请求；
       * - 请求还在飞的时候又来了新改动，就等它回来再补一次，绝不并发写——
       *   服务端是「读当前 + 合并 + 写」，两个请求同时进来会丢掉一个。
       */
      const pendingRef = useRef({})
      const timerRef = useRef(null)
      const inflightRef = useRef(false)

      const flush = useCallback(async () => {
        if (inflightRef.current) return
        const batch = pendingRef.current
        if (Object.keys(batch).length === 0) return
        pendingRef.current = {}
        inflightRef.current = true
        setSaveHint(T.saving)
        try {
          const next = await saveState(batch)
          // 只换 state（lastRun、history 这些由服务端算），不回灌草稿：
          // 草稿里可能已经有比这份响应更新的输入。
          setState(next)
          setSaveHint(T.saved + ' · ' + T.savedHint)
        } catch {
          // 失败的键补回队列，下次改动会一起重试，不静默吞掉用户的设置。
          pendingRef.current = { ...batch, ...pendingRef.current }
          setSaveHint(T.failed)
        } finally {
          inflightRef.current = false
          if (Object.keys(pendingRef.current).length > 0 && timerRef.current === null) {
            timerRef.current = setTimeout(() => { timerRef.current = null; void flush() }, 350)
          }
        }
      }, [])

      const patch = useCallback((key, value) => {
        setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value }))
        setSaveHint('')
        pendingRef.current[key] = value
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { timerRef.current = null; void flush() }, 350)
      }, [flush])

      // 卸载时别把定时器留下，否则会对已经卸载的组件 setState。
      useEffect(() => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current)
      }, [])


      const fire = useCallback(async () => {
        if (running) return
        setRunning(true)
        setRunHint(T.running)
        try {
          const result = await runNow('update')
          if (result?.started === false) {
            setRunHint(result.reason || T.runFailed)
          } else {
            setRunHint((result?.reason || T.runDone) + ' · ' + (result?.status ?? ''))
          }
          // 跑完把状态刷一遍，页面上看到的就是最新结果。
          try {
            const next = await getState(LANG)
            setState(next)
            setDraft((prev) => (prev === null ? next.settings : prev))
          } catch {}
        } catch {
          setRunHint(T.runFailed)
        } finally {
          setRunning(false)
        }
      }, [running])

      const doCleanup = useCallback(async () => {
        if (cleaning) return
        setCleaning(true)
        setCleanHint('')
        try {
          const result = await cleanup()
          const total = Number(result?.history ?? 0) + Number(result?.log ?? 0)
          setCleanHint(total > 0 ? T.cleanDone.replace('{n}', String(total)) : T.cleanNothing)
          try {
            const next = await getState(LANG)
            setState(next)
          } catch {}
        } catch {
          setCleanHint(T.cleanFail)
        } finally {
          setCleaning(false)
        }
      }, [cleaning])

      const doRollback = useCallback(async (target) => {
        if (rolling !== '' || running) return
        // 回滚会换掉正在跑的代码，属于不可轻点的操作，先要一次确认。
        if (confirming !== target) {
          setConfirming(target)
          setRollHint('')
          return
        }
        setConfirming('')
        setRolling(target)
        setRollHint(T.rollingBack)
        try {
          const result = await rollback(target)
          setRollHint(result.ok ? T.rollbackDone + ' · ' + target : T.rollbackFailed + ' · ' + (result.payload?.reason ?? ''))
          try {
            const next = await getState(LANG)
            setState(next)
            setDraft((prev) => (prev === null ? next.settings : prev))
          } catch {}
        } catch {
          setRollHint(T.rollbackFailed)
        } finally {
          setRolling('')
        }
      }, [rolling, running, confirming])

      if (phase === 'error') {
        return h('div', { style: S.card },
          h('span', { style: S.err }, T.unavailable),
          h('div', { style: S.actions }, h('button', { type: 'button', style: S.btn, onClick: () => void load() }, T.retry)),
        )
      }

      if (phase === 'loading' || draft === null) {
        return h('div', { style: S.card }, h('span', { style: S.status }, '…'))
      }

      const last = state?.lastRun

      return h('div', { style: S.wrap },
        h('div', { style: S.head },
          h('h3', { style: S.title }, T.title),
          h('p', { style: S.sub }, T.subtitle),
        ),
        h('div', { style: S.card },
          h(SelectRow, {
            label: T.language,
            hint: T.languageHint,
            value: draft.lang ?? 'auto',
            // 先切文案再落盘：切换要立刻看得见，不能等保存往返。
            // 顺序很重要：applyLang 换完 LANG，后面的取数才会带新语言。
            onChange: (v) => {
              // 先切文案（applyLang 会立刻换 T 并重渲染），落盘交给自动保存队列。
              patch('lang', v)
              applyLang(v)
            },
            options: [
              { value: 'auto', label: T.langAuto },
              { value: 'zh', label: T.langZh },
              { value: 'en', label: T.langEn },
            ],
          }),
          h(SwitchRow, { label: T.enabled, hint: T.enabledHint, value: draft.enabled, onChange: (v) => patch('enabled', v) }),
          h(SwitchRow, { label: T.autoApply, hint: T.autoApplyHint, value: draft.autoApply, onChange: (v) => patch('autoApply', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.hotReload, hint: T.hotReloadHint, value: draft.hotReload, onChange: (v) => patch('hotReload', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.checkOnStart, value: draft.checkOnStart, onChange: (v) => patch('checkOnStart', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.idleOnly, hint: T.idleOnlyHint, value: draft.idleOnly, onChange: (v) => patch('idleOnly', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.notify, hint: T.notifyHint, value: draft.notify, onChange: (v) => patch('notify', v) }),
        ),
        h('div', { style: S.card },
          h(SelectRow, {
            label: T.schedule,
            hint: T.scheduleHint,
            value: draft.scheduleMode,
            disabled: !draft.enabled,
            onChange: (v) => patch('scheduleMode', v),
            options: [
              { value: 'minutes', label: T.modeMinutes },
              { value: 'hours', label: T.modeHours },
              { value: 'days', label: T.modeDays },
              { value: 'daily', label: T.modeDaily },
            ],
          }),
          // 只渲染当前模式对应的那个参数：四种都摆出来会让面板变成一排用不上的数字。
          draft.scheduleMode === 'minutes'
            ? h(NumberRow, { label: T.interval, hint: T.intervalHint, value: draft.intervalMinutes, min: 10, max: 10080, onChange: (v) => patch('intervalMinutes', v), disabled: !draft.enabled })
            : null,
          draft.scheduleMode === 'hours'
            ? h(NumberRow, { label: T.everyHours, hint: T.everyHoursHint, value: draft.everyHours, min: 1, max: 168, onChange: (v) => patch('everyHours', v), disabled: !draft.enabled })
            : null,
          draft.scheduleMode === 'days'
            ? h(NumberRow, { label: T.everyDays, hint: T.everyDaysHint, value: draft.everyDays, min: 1, max: 30, onChange: (v) => patch('everyDays', v), disabled: !draft.enabled })
            : null,
          draft.scheduleMode === 'daily'
            ? h(ClockRow, { label: T.dailyAt, hint: T.dailyAtHint, value: draft.dailyAt, onChange: (v) => patch('dailyAt', v), disabled: !draft.enabled })
            : null,
          h(NumberRow, { label: T.firstDelay, hint: T.firstDelayHint, value: draft.firstDelayMinutes, min: 0, max: 1440, onChange: (v) => patch('firstDelayMinutes', v), disabled: !draft.enabled }),
          h(NumberRow, { label: T.suppress, hint: T.suppressHint, value: draft.suppressHours, min: 0, max: 720, onChange: (v) => patch('suppressHours', v), disabled: !draft.enabled }),
          h(NumberRow, { label: T.maxPerCycle, hint: T.maxPerCycleHint, value: draft.maxPerCycle, min: 0, max: 50, onChange: (v) => patch('maxPerCycle', v), disabled: !draft.enabled }),
          h(NumberRow, { label: T.sessionIdle, hint: T.sessionIdleHint, value: draft.sessionIdleMinutes, min: 0, max: 120, onChange: (v) => patch('sessionIdleMinutes', v), disabled: !draft.enabled || !draft.idleOnly }),
          gateLine(state),
          h('div', { style: S.labelBox },
            h('span', { style: S.label }, T.pkgsExclude),
            h('span', { style: S.hint }, T.pkgsExcludeHint),
          ),
          h(PackagePicker, {
            packages: state?.packages,
            selected: draft.exclude,
            onChange: (list) => patch('exclude', list),
          }),
        ),
        // 策略：预发布 / 跨大版本，决定「什么算可以装」。
        h('div', { style: S.card },
          h('span', { style: S.label }, T.policy),
          h(SwitchRow, { label: T.allowMajor, hint: T.allowMajorHint, value: draft.allowMajor, onChange: (v) => patch('allowMajor', v) }),
          h(SwitchRow, { label: T.allowPrerelease, hint: T.allowPrereleaseHint, value: draft.allowPrerelease, onChange: (v) => patch('allowPrerelease', v) }),
        ),
        h('div', { style: S.card },
          h('span', { style: S.label }, T.keepTitle),
          h('span', { style: S.hint }, T.keepHint),
          h(SelectRow, {
            label: T.keepHistory,
            value: String(draft.historyRetentionDays ?? 3),
            onChange: (v) => patch('historyRetentionDays', Number(v)),
            options: [
              { value: '1', label: '1 ' + T.keepDay },
              { value: '3', label: '3 ' + T.keepDay },
              { value: '7', label: '7 ' + T.keepDay },
              { value: '30', label: '30 ' + T.keepDay },
              { value: '90', label: '90 ' + T.keepDay },
              { value: '0', label: T.keepForever },
            ],
          }),
          h(SelectRow, {
            label: T.keepLog,
            value: String(draft.logRetentionDays ?? 3),
            onChange: (v) => patch('logRetentionDays', Number(v)),
            options: [
              { value: '1', label: '1 ' + T.keepDay },
              { value: '3', label: '3 ' + T.keepDay },
              { value: '7', label: '7 ' + T.keepDay },
              { value: '30', label: '30 ' + T.keepDay },
              { value: '90', label: '90 ' + T.keepDay },
              { value: '0', label: T.keepForever },
            ],
          }),
          h('div', { style: S.actions },
            h('button', { type: 'button', style: S.btn, disabled: cleaning, onClick: () => void doCleanup() }, cleaning ? T.cleaning : T.cleanNow),
            cleanHint ? h('span', { style: S.status }, cleanHint) : null,
          ),
        ),
        h('div', { style: S.card },
          // 按钮和它动作的对象放在一起：读「上一次」的人最想做的事就是再跑一次。
          h('div', { style: S.row },
            h('span', { style: S.label }, T.lastRun),
            h('button', { type: 'button', style: S.btn, disabled: running, onClick: () => void fire() }, running ? T.running : T.runNow),
          ),
          last === null || last === undefined
            ? h('span', { style: S.status }, T.never)
            : h('div', { style: S.meta },
                h('span', { title: last.at || '' }, formatWhen(last.at) + (relativeWhen(last.at) ? '（' + relativeWhen(last.at) + '）' : '')),
                h('span', null, T.checked + ' ' + (last.checked ?? 0) + ' ' + T.packages),
                h('span', null, (last.updates?.length ?? 0) > 0
                  ? (last.updates?.length ?? 0) + ' ' + T.updates
                  : T.upToDate),
                h('span', null, last.reason || last.status || ''),
              ),
          runHint ? h('span', { style: S.status }, runHint) : null,
        ),
        // 更新记录：谁、从哪到哪、什么时候、成没成，以及回滚入口。
        h('div', { style: S.card },
          h('span', { style: S.label }, T.history),
          (state?.history?.length ?? 0) === 0
            ? h('span', { style: S.status }, T.historyEmpty)
            : h('div', { style: S.scrollList },
                state.history.map((row, index) => h('div', {
                  key: row.name + '@' + row.at + ':' + index,
                  style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' },
                },
                  h('div', { style: S.labelBox },
                    h('span', null, row.name + '  ' + (row.from ?? '?') + ' → ' + (row.to ?? '?')),
                    h('span', { style: S.hint, title: row.at || '' },
                      formatWhen(row.at) + (relativeWhen(row.at) ? '（' + relativeWhen(row.at) + '）' : '') +
                      (row.rolledBack === true ? ' · ' + T.rolledBack : '')),
                  ),
                  row.rolledBack === true || typeof row.from !== 'string' || row.from === ''
                    ? null
                    : h('button', {
                        type: 'button',
                        style: confirming === row.name ? S.btnPrimary : S.btn,
                        disabled: rolling !== '' || running,
                        onClick: () => void doRollback(row.name),
                      }, rolling === row.name ? T.rollingBack : confirming === row.name ? T.rollback + '?' : T.rollback),
                )),
              ),
          rollHint ? h('span', { style: S.status }, rollHint) : null,
        ),
        h(LogCard, null),
        // 没有保存按钮：改动自己在 350ms 后落盘，这里只报它落没落成。
        saveHint ? h('span', { style: S.status }, saveHint) : null,
        h('span', { style: S.hint }, T.scope),
      )
    }

    /**
     * 日志卡片。
     *
     * 单独成一个组件，而不是塞进 AutoUpdateCard：日志要能在「自动刷新」开着时
     * 每 5 秒重渲染自己，不该把整张设置卡片连同输入框一起重渲染——那样光标会跳。
     */
    function LogCard() {
      useLang()
      const [lines, setLines] = useState(200)
      const [data, setData] = useState(null)
      const [phase, setPhase] = useState('loading') // loading | ready | missing
      const [auto, setAuto] = useState(false)
      const [tick, setTick] = useState(0)

      const refresh = useCallback(async () => {
        try {
          // LANG 进依赖：切换显示语言时这一栏要重新取，否则日志正文还是旧语言。
          const next = await getLogs(lines, LANG)
          setData(next)
          setPhase(next?.exists === false ? 'missing' : 'ready')
        } catch {
          setPhase('missing')
        }
      }, [lines, LANG])

      // lines 或语言变了要立刻重取；tick 是自动刷新用来触发同一段逻辑的。
      useEffect(() => { void refresh() }, [refresh, tick])

      useEffect(() => {
        if (!auto) return undefined
        const timer = setInterval(() => setTick((n) => n + 1), 5000)
        return () => clearInterval(timer)
      }, [auto])

      // 后端按追加顺序给（老的在前面），这里渲染时倒过来：最近发生的事在最上面，
      // 打开这一栏先看到的应该是刚才装了什么，而不是要滚到底才看见。
      const rows = (data?.rows ?? []).slice().reverse()
      const total = data?.total ?? 0

      return h('div', { style: S.card },
        h('div', { style: S.row },
          h('div', { style: S.labelBox },
            h('span', { style: S.label }, T.logs),
            h('span', { style: S.hint }, T.logsHint + ' · ' + T.logsNewest),
          ),
          h('div', { style: S.actions },
            h('select', {
              value: String(lines),
              onChange: (event) => setLines(Number(event.target.value)),
              style: S.select,
            }, [100, 200, 500, 1000].map((n) => h('option', { key: n, value: String(n) }, n + ' ' + T.logsLines))),
            h('button', { type: 'button', style: S.btn, onClick: () => setTick((n) => n + 1) }, T.logsRefresh),
          ),
        ),
        h(SwitchRow, { label: T.logsAuto, hint: T.logsAutoHint, value: auto, onChange: setAuto }),
        phase === 'loading' && data === null
          ? h('span', { style: S.status }, '…')
          : phase === 'missing' || (data !== null && data.exists === false)
            ? h('span', { style: S.status }, T.logsMissing)
            : rows.length === 0
              ? h('span', { style: S.status }, T.logsEmpty)
              : h('pre', { style: S.logBox, title: data?.path || '' },
                  rows.map((row, index) => h('div', { key: index },
                    row.at ? h('span', { style: S.logTime }, formatLogWhen(row.at) + '  ') : null,
                    h('span', { style: S.logText }, row.text),
                  )),
                ),
        data !== null && data.exists !== false
          ? h('div', { style: S.meta },
              h('span', { title: data.path || '' }, T.logsTotal.replace('{n}', String(total))),
              data.rotated === true ? h('span', null, T.logsRotated) : null,
            )
          : null,
      )
    }

    /**
     * 插件页里这一行有两个视图：收起时是 summary（一行摘要），展开后是整页。
     * summary 只报最关键的一件事——上次检查的结果，别把整页塞进一行。
     */
    function AutoUpdateSummary() {
      useLang()
      const [state, setState] = useState(null)
      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const next = await getState(LANG)
            if (alive) setState(next)
          } catch {}
        })()
        return () => { alive = false }
      }, [LANG])
      const last = state?.lastRun
      const text = state === null
        ? '…'
        : state.settings?.enabled === false
          ? (T.enabled + '：' + 'off')
          : last === null || last === undefined
            ? T.never
            : (last.updates?.length ?? 0) > 0
              ? (last.updates?.length ?? 0) + ' ' + T.updates
              : T.upToDate
      return h('span', { style: { fontSize: '12px', opacity: 0.68 } }, text)
    }

    /* ── 更新提醒 ────────────────────────────────────────────────────────
     *
     * 定时更新最容易出的事，是它在后台悄悄装完，用户根本不知道装了什么。
     * 这里轮询 /state，发现 lastRun 里有可更新项就在右下角浮一条提醒。
     *
     * 用原生 DOM 而不是再注册一个槽位：提醒要能在任何页面出现（会话、插件页、
     * 设置页），而槽位只在宿主页挂载时才渲染。浮层还得幂等——同一批更新重复弹
     * 三次比不弹更烦，所以把「已提醒过的批次」签名记进 localStorage。
     */
    const NOTIFIED_KEY = 'dsh-aupdate:notified'

    function notifiedMark() {
      try { return window.localStorage.getItem(NOTIFIED_KEY) || '' } catch { return '' }
    }

    function markNotified(sig) {
      try { window.localStorage.setItem(NOTIFIED_KEY, sig) } catch {}
    }

    let toastOpen = false

    function showUpdateToast(updates) {
      if (toastOpen) return
      const doc = typeof document === 'undefined' ? null : document
      if (doc === null || doc.body === null) return
      toastOpen = true
      const box = doc.createElement('div')
      box.setAttribute('data-dsh-aupdate', 'toast')
      box.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
        'max-width:340px', 'padding:12px 14px', 'border-radius:10px',
        'background:rgba(28,28,30,0.97)', 'color:#f4f4f5',
        'box-shadow:0 8px 28px rgba(0,0,0,0.38)', 'border:1px solid rgba(255,255,255,0.14)',
        'font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
        'display:flex', 'flex-direction:column', 'gap:8px',
      ].join(';')

      const title = doc.createElement('div')
      title.textContent = T.toastTitle.replace('{n}', String(updates.length))
      title.style.cssText = 'font-weight:600'
      box.appendChild(title)

      const list = doc.createElement('div')
      list.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:180px;overflow:auto'
      for (const item of updates.slice(0, 8)) {
        const row = doc.createElement('div')
        row.textContent = item.name + '  ' + (item.current || '?') + ' → ' + (item.target || '?')
        row.style.cssText = 'font-size:12px;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
        list.appendChild(row)
      }
      box.appendChild(list)

      if (updates.length > 8) {
        const more = doc.createElement('div')
        more.textContent = T.toastMore.replace('{n}', String(updates.length - 8))
        more.style.cssText = 'font-size:11.5px;opacity:0.6'
        box.appendChild(more)
      }

      const close = doc.createElement('button')
      close.type = 'button'
      close.textContent = T.toastDismiss
      close.style.cssText = 'align-self:flex-end;padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.25);background:transparent;color:inherit;cursor:pointer;font-size:12px'
      const dismiss = () => {
        toastOpen = false
        try { box.remove() } catch {}
      }
      close.addEventListener('click', dismiss)
      box.appendChild(close)
      doc.body.appendChild(box)
      // 不点也不会一直挂着：15 秒后自己消失，省得挡住下面的界面。
      setTimeout(dismiss, 15000)
    }

    function startUpdateNotifier() {
      let stopped = false
      let timer = null
      const tick = async () => {
        if (stopped) return
        try {
          const state = await getState(LANG)
          if (state?.settings?.notify !== false) {
            const updates = Array.isArray(state?.lastRun?.updates) ? state.lastRun.updates : []
            if (updates.length > 0) {
              const sig = updates.map((item) => item.name + '@' + (item.target || '')).sort().join('|')
              if (sig !== notifiedMark()) {
                markNotified(sig)
                showUpdateToast(updates)
              }
            }
          }
        } catch {
          // 读不到就等下一轮，提醒失败不该写日志也不该报错。
        }
        if (!stopped) timer = setTimeout(() => void tick(), 60000)
      }
      void tick()
      return () => {
        stopped = true
        if (timer !== null) clearTimeout(timer)
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 提醒跟着插件一起上、一起卸：ctx.effect 收的是清理函数。
        if (typeof ctx.effect === 'function') ctx.effect(startUpdateNotifier, 'dsh-aupdate: update notices')
        // key 的格式是「包名#条目id」：本插件在 cordis.patch.yml 里的条目 id 就是包名本身，
        // 和 dsh-ops 的 dsh-ops#dsh-ops 一样。写成 #auto-update 之类是挂不上的。
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: NS + '#' + NS,
        }, (props) => (props && props.view === 'summary' ? h(AutoUpdateSummary) : h(AutoUpdateCard))))

        // bundle 级配置页用包名做 key，和 free-search 的写法一致。
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: NS,
        }, (props) => (props && props.view === 'summary' ? h(AutoUpdateSummary) : h(AutoUpdateCard))))

        // 设置 → 插件更新：挂成独立的一页，写法照抄 dsh-our-free-model-balance-zxp
        // 的「渠道余额」。原来只有插件页里那张卡，想改策略得先去插件页翻它。
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: NS,
          order: 36,
          label: () => T.pageLabel,
        }, () => h(AutoUpdateCard)))
      },
    }
  },
})
