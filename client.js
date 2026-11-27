window.__ModuleLoader__.load({
  id: 'dsh-aupdate',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const NS = 'dsh-aupdate'
    const API = 'api/dsh-aupdate'

    /**
     * 「关于 aupdate」用到的项目链接集中一处。
     *
     * 外链一律 target=_blank + rel=noopener noreferrer：设置页可能跑在受限
     * webview 里，noopener 防止新页反向控制本页。
     */
    /**
     * 状态词本地化。
     *
     * 后端存的是数据（done / failed / blocked…），不该直接显示在界面上。
     * 只有拿不到已渲染的 reason 时的兜底路径会用到它，所以表不用很大。
     */
    const STATUS_LABELS = {
      zh: {
        done: '完成', failed: '失败', blocked: '已让开', partial: '部分完成', busy: '正在跑',
        skipped: '已跳过', none: '无', ok: '成功', cancelled: '已取消', restart: '需重启',
        applying: '生效中', unavailable: '不可用',
      },
      en: {
        done: 'done', failed: 'failed', blocked: 'held off', partial: 'partly done', busy: 'busy',
        skipped: 'skipped', none: 'none', ok: 'ok', cancelled: 'cancelled', restart: 'restart needed',
        applying: 'applying', unavailable: 'unavailable',
      },
    }

    function statusLabel(value) {
      const table = STATUS_LABELS[LANG] ?? STATUS_LABELS.zh
      return table[String(value ?? '')] ?? String(value ?? '')
    }

    /**
     * 状态徽标配色。
     *
     * 后端存的是机器词（done/failed/blocked…），直接铺成一行文字看不出轻重；
     * 这点颜色区分让「装完了」「失败了」「让开了」一眼能分开，文字本身仍走
     * statusLabel 本地化。
     */
    const BADGE_TONE = {
      ok: 'ok', done: 'ok',
      partial: 'warn', skipped: 'warn', blocked: 'warn', restart: 'warn',
      failed: 'err', error: 'err',
      busy: 'run', applying: 'run',
    }

    function badgeClass(status) {
      const tone = BADGE_TONE[String(status ?? '')]
      return tone ? S.badge + ' ' + tone : S.badge
    }

    const REPO_URL = 'https://github.com/CalmSun/dsh-aupdate'
    const CHANGELOG_URL = REPO_URL + '/releases'
    const ISSUES_URL = REPO_URL + '/issues/new'
    const STARS_URL = REPO_URL + '/stargazers'

    const COPY = {
      zh: {
        title: '插件自动更新',
        subtitle: '定时检查 registry，发现新版本就装好并就地生效',
        secGeneral: '基本设置',
        secSchedule: '调度与范围',
        lastChecked: '上次检查',
        lastUpdates: '可更新',
        lastUpdated: '已更新',
        unavailable: '读不到设置：后端路由没起来（插件仍会按默认设置自动更新）',
        retry: '重试',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        savedHint: '新设置立即生效，不用重启',
        failed: '保存失败',
        runNow: '立刻检查',
        running: '正在检查…',
        progressCheck: '正在检查更新…',
        progressInstall: '正在安装第 {n}/{m} 个：{name}',
        progressApply: '正在就地生效…',
        runDone: '检查完成',
        runFailed: '检查没能完成',
        off: '已关闭',
        lastRun: '上一次',
        never: '还没跑过',
        checked: '检查了',
        packages: '个包',
        updates: '个可更新',
        updatedUnit: '个已更新',
        updatedHint: '个插件',
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
        registry: '安装源',
        registryHint: '查版本和装包都走这个源。默认跟随 pnpm 自己的配置，一个字节都不改。',
        regPnpm: '跟随 pnpm',
        regNpmjs: '官方源',
        regMirror: '大陆镜像',
        regCustom: '自定义',
        regUrl: '自定义源地址',
        regUrlHint: 'http(s)://…；填的不是 http(s) 就退回「跟随 pnpm」',
        compatCheck: '装前检查 DSH 兼容性',
        compatCheckHint: '宿主是等插件卸下之后才拒绝装不上的版本的；提前拦下，快照不会白拍、也不会留下半装的样子',
        dshVersion: 'DSH 版本',
        lagTitle: '镜像落后',
        lagNote: '{n} 个插件的镜像还没同步，官方源已经有新版本',
        blockedNote: '{n} 个版本在这台 DSH 上装不了',
        versionsTab: '版本管理',
        versionsTitle: '版本管理',
        versionsSubtitle: '每个已装插件的全部已发布版本，点一下就切过去',
        versionsSearch: '搜索插件名',
        versionsCount: '{n} 个插件',
        versionsShow: '版本',
        versionsHide: '收起',
        versionsSwitch: '切到这一版',
        versionsCurrent: '当前',
        versionsLatest: '最新',
        versionsInstalled: '已装',
        versionsBlocked: '这台 DSH 装不了',
        versionsDeprecated: '已废弃',
        versionsNeed: '要求 DSH {r}',
        versionsLoading: '读取版本…',
        versionsFailed: '读不到版本列表',
        versionsEmpty: '没有匹配的插件',
        versionsDone: '已切到 {v}',
        versionsNoop: '已经是这一版',
        versionsFail: '切换失败',
        versionsTotal: '共 {n} 个版本',
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
        toastTitle: '{n} 个插件已更新',
        toastTitleFound: '{n} 个插件可更新',
        toastBadge: '已更新',
        toastBadgeFound: '可更新',
        toastBody: '装好就地生效，不用重启；下面是这一轮换掉的版本。',
        toastBodyFound: '下面是能升级到的新版本；自动安装关掉时只会检查，不会动手。',
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
        min: '分钟',
        scope: '这些设置只影响本机这个 profile',
        about: '关于 aupdate',
        aboutVersion: '版本',
        aboutChangelog: '更新日志',
        aboutChangelogLink: '查看更新日志',
        aboutRepo: '源码仓库',
        aboutFeedback: '反馈问题',
        aboutFeedbackLink: '提交问题',
        aboutStar: '点个星',
        aboutStarHint: '在 GitHub 上点 Star，让更多人看到',
        aboutShare: '分享',
        aboutShareHint: '复制项目地址，分享给朋友',
        aboutShareDone: '项目地址已复制',
        aboutShareFail: '复制失败，请手动复制项目地址',
        aboutProject: '项目地址',
      },
      en: {
        title: 'Plugin auto-update',
        subtitle: 'Checks the registry on a timer and applies new versions in place',
        secGeneral: 'Basics',
        secSchedule: 'Schedule and scope',
        lastChecked: 'Last check',
        lastUpdates: 'Updates',
        lastUpdated: 'Updated',
        unavailable: 'Cannot read settings: the backend route is not up (defaults still apply)',
        retry: 'Retry',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        savedHint: 'Takes effect immediately, no restart',
        failed: 'Save failed',
        runNow: 'Check now',
        running: 'Checking…',
        progressCheck: 'Checking for updates…',
        progressInstall: 'Installing {n}/{m}: {name}',
        progressApply: 'Applying in place…',
        runDone: 'Check finished',
        runFailed: 'Check could not finish',
        off: 'off',
        lastRun: 'Last run',
        never: 'never',
        checked: 'checked',
        packages: 'packages',
        updates: 'updates',
        updatedUnit: 'updated',
        updatedHint: 'plugins',
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
        registry: 'Registry',
        registryHint: 'Version lookups and installs both use this source. The default follows pnpm own config and changes nothing.',
        regPnpm: 'Follow pnpm',
        regNpmjs: 'Official',
        regMirror: 'China mirror',
        regCustom: 'Custom',
        regUrl: 'Custom registry URL',
        regUrlHint: 'http(s)://…; anything else falls back to Follow pnpm',
        compatCheck: 'Check DSH compatibility first',
        compatCheckHint: 'The host refuses unusable versions only after the bundle is gone; stopping earlier keeps the snapshot and the profile clean',
        dshVersion: 'DSH version',
        lagTitle: 'Mirror behind',
        lagNote: '{n} plugin(s) not synced to the mirror yet; upstream already has newer',
        blockedNote: '{n} version(s) cannot be installed on this DSH',
        versionsTab: 'Versions',
        versionsTitle: 'Version manager',
        versionsSubtitle: 'Every published version of every installed plugin; click one to switch',
        versionsSearch: 'Search plugin names',
        versionsCount: '{n} plugins',
        versionsShow: 'Versions',
        versionsHide: 'Hide',
        versionsSwitch: 'Switch to this',
        versionsCurrent: 'current',
        versionsLatest: 'latest',
        versionsInstalled: 'installed',
        versionsBlocked: 'not installable on this DSH',
        versionsDeprecated: 'deprecated',
        versionsNeed: 'needs DSH {r}',
        versionsLoading: 'Loading versions…',
        versionsFailed: 'Could not read the version list',
        versionsEmpty: 'Nothing matches',
        versionsDone: 'Switched to {v}',
        versionsNoop: 'Already on this version',
        versionsFail: 'Switch failed',
        versionsTotal: '{n} versions',
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
        toastTitle: '{n} plugin(s) updated',
        toastTitleFound: '{n} plugin(s) can update',
        toastBadge: 'Updated',
        toastBadgeFound: 'Update available',
        toastBody: 'Applied in place, no restart needed. Here is what changed this round.',
        toastBodyFound: 'Newer versions are available. With auto-install off this only checks; nothing is installed.',
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
        minutes: 'minutes',
        min: 'min',
        scope: 'These settings apply to this profile only',
        about: 'About aupdate',
        aboutVersion: 'Version',
        aboutChangelog: 'Changelog',
        aboutChangelogLink: 'View changelog',
        aboutRepo: 'Source code',
        aboutFeedback: 'Report an issue',
        aboutFeedbackLink: 'Open an issue',
        aboutStar: 'Star',
        aboutStarHint: 'Star on GitHub to help others find it',
        aboutShare: 'Share',
        aboutShareHint: 'Copy the project link to share',
        aboutShareDone: 'Project link copied',
        aboutShareFail: 'Could not copy; please copy the link manually',
        aboutProject: 'Project URL',
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
      // 26/11/26 12:38：两位年/月/日 + 时:分，秒不显示。
      // 「上一次检查」这类时间看到分就够，秒只会把统计卡挤窄；
      // 走本地时区取值，不用 Intl 的日期顺序（中文环境会排成 2026/11/26）。
      const pad = (n) => String(n).padStart(2, '0')
      return pad(when.getFullYear() % 100) + '/' + pad(when.getMonth() + 1) + '/' + pad(when.getDate()) +
        ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes())
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

    /* ── styles ─────────────────────────────────────────────────────────
     *
     * 视觉风格对齐 dsh-cost-meter 的设置页：分区卡片、小号分区标题、次级说明
     * 文字、主/次两级小按钮、右下角通知卡；颜色一律走 --dsw-alias-* 主题变量
     * 并带字面量回退，取不到变量也不会变成看不见的字。
     *
     * 原来每个节点都挂一坨内联 style，代价有三：
     * - hover / focus-visible / 动画做不了（内联样式没有伪类）；
     * - 每次渲染重建几十个样式对象，输入框每敲一个字符就重建一次；
     * - 颜色写死 rgba，亮色/暗色主题只能靠碰运气。
     *
     * 所以改成「一张只注入一次的样式表 + 类名」。选择器全部带 dsh-au- 前缀，
     * 只作用于本插件自己的节点，不碰宿主和其它插件的样式。
     */
    const CSS_ID = 'dsh-aupdate-styles'

    const CSS_TEXT = `
.dsh-au-wrap{display:flex;flex-direction:column;gap:16px;padding:2px 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2328)}
.dsh-au-head{display:flex;flex-direction:column;gap:3px}
.dsh-au-title{margin:0;font-size:15px;font-weight:600}
.dsh-au-sub{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}

.dsh-au-section{display:flex;flex-direction:column;gap:10px;padding:14px 15px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.03))}
.dsh-au-h{margin:0;font-size:12px;font-weight:600;letter-spacing:.01em;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dsh-au-note{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dsh-au-err{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#d9534f)}

.dsh-au-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsh-au-col{display:flex;flex-direction:column;gap:6px}
.dsh-au-line{display:flex;align-items:baseline;gap:8px}
.dsh-au-labelbox{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsh-au-label{font-weight:500}
.dsh-au-hint{font-size:11.5px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.85))}
.dsh-au-status{font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dsh-au-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dsh-au-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,inherit)}

.dsh-au-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:10px}
.dsh-au-stat{display:flex;flex-direction:column;gap:1px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05))}
.dsh-au-stat-k{font-size:11.5px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.85))}
.dsh-au-stat-v{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.dsh-au-badge{display:inline-flex;align-items:center;align-self:flex-start;gap:4px;padding:1px 8px;border-radius:999px;font-size:11px;line-height:1.6;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));color:var(--dsw-alias-label-secondary,inherit)}
.dsh-au-badge.ok{color:var(--dsw-alias-state-success-primary,#2f9e44);border-color:var(--dsw-alias-state-success-tertiary,rgba(47,158,68,.4));background:color-mix(in oklch,var(--dsw-alias-state-success-primary,#2f9e44),transparent 90%)}
.dsh-au-badge.warn{color:var(--dsw-alias-state-warn-primary,#b8860b);border-color:var(--dsw-alias-state-warn-tertiary,rgba(184,134,11,.4));background:color-mix(in oklch,var(--dsw-alias-state-warn-primary,#b8860b),transparent 90%)}
.dsh-au-badge.err{color:var(--dsw-alias-state-error-primary,#d9534f);border-color:color-mix(in oklch,var(--dsw-alias-state-error-primary,#d9534f),transparent 55%);background:color-mix(in oklch,var(--dsw-alias-state-error-primary,#d9534f),transparent 90%)}
.dsh-au-badge.run{color:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:color-mix(in oklch,var(--dsw-alias-state-business-primary,#4d6bfe),transparent 55%);background:color-mix(in oklch,var(--dsw-alias-state-business-primary,#4d6bfe),transparent 90%)}

.dsh-au-input{width:96px;padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;font-size:13px;text-align:right;transition:border-color .15s}
.dsh-au-select{padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;font-size:13px;min-width:132px;transition:border-color .15s}
.dsh-au-url{width:240px;max-width:100%;padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;font-size:12.5px;transition:border-color .15s}
.dsh-au-search{padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;font-size:12.5px;transition:border-color .15s}
.dsh-au-input:focus,.dsh-au-select:focus,.dsh-au-search:focus,.dsh-au-url:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsh-au-input:disabled,.dsh-au-select:disabled{opacity:.55}

.dsh-au-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-au-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.dsh-au-btn:hover:not(:disabled){background:var(--dsw-alias-bg-mask-2,rgba(128,128,128,.12))}
.dsh-au-btn:active:not(:disabled){background:var(--dsw-alias-bg-mask-3,rgba(128,128,128,.18))}
.dsh-au-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}
.dsh-au-btn:disabled{opacity:.5;cursor:default}
.dsh-au-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:500}
.dsh-au-primary:hover:not(:disabled){background:color-mix(in oklch,var(--dsw-alias-button-primary-fill,#4d6bfe),black 8%)}
.dsh-au-primary:active:not(:disabled){background:color-mix(in oklch,var(--dsw-alias-button-primary-fill,#4d6bfe),black 14%)}

.dsh-au-check{flex:0 0 auto;width:16px;height:16px;margin:2px 0 0;cursor:pointer;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsh-au-check:disabled{cursor:default;opacity:.5}

.dsh-au-scroll{display:flex;flex-direction:column;gap:6px;max-height:264px;overflow-y:auto;padding-right:4px}
.dsh-au-pkglist{display:flex;flex-direction:column;gap:1px;max-height:240px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:10px;padding:4px}
.dsh-au-pkgrow{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:6px;cursor:pointer}
.dsh-au-pkgrow:hover{background:var(--dsw-alias-bg-mask-1,rgba(128,128,128,.08))}
.dsh-au-pkgname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-au-pkgver{flex:0 0 auto;margin-left:auto;font-size:11px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.85));font-variant-numeric:tabular-nums}
.dsh-au-log{margin:0;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.6;max-height:288px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dsh-au-logtime{color:var(--dsw-alias-label-caption,rgba(128,128,128,.8));font-variant-numeric:tabular-nums}
.dsh-au-logtext{color:inherit}

/* 版本管理：一行版本 = 版本号 + 标记 + 右侧动作。 */
.dsh-au-vhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsh-au-vlist{display:flex;flex-direction:column;gap:2px;max-height:300px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:10px;padding:4px;margin-top:2px}
.dsh-au-vrow{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:6px;min-width:0}
.dsh-au-vrow:hover{background:var(--dsw-alias-bg-mask-1,rgba(128,128,128,.08))}
.dsh-au-vnum{flex:0 0 auto;min-width:92px;font-variant-numeric:tabular-nums;font-size:12.5px}
.dsh-au-vact{flex:0 0 auto;margin-left:auto}
.dsh-au-dim{color:var(--dsw-alias-label-caption,rgba(128,128,128,.85));font-size:11.5px}
.dsh-au-bad{color:var(--dsw-alias-state-error-primary,#d9534f);font-size:11.5px}
.dsh-au-pivot{flex:0 0 auto;font-size:11px;line-height:1.6;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));color:var(--dsw-alias-label-secondary,inherit)}
.dsh-au-link{color:inherit;text-decoration:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));padding-bottom:1px;transition:color .15s,border-color .15s}
.dsh-au-link:hover{color:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:currentColor}
.dsh-au-linkext{margin-left:3px;opacity:.5}

/* 通知卡：照 dsh-cost-meter 的「峰/谷切换提醒」做。
 * 那张卡是「圆点徽标 + 标题 + 正文 + 右对齐按钮」，并按事件换主色；
 * 这里同一结构用于「发现可更新」，主色取 business 蓝，边框和投影都走主题。 */
.dsh-au-toast{--au-toast-accent:var(--dsw-alias-state-business-primary,#4d6bfe);position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;gap:9px;box-sizing:border-box;width:340px;max-width:calc(100vw - 32px);padding:14px 16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-toast-bg,#f7f7f8));color:var(--dsw-alias-label-primary,#1f2328);box-shadow:0 14px 36px #00000038;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;animation:dsh-au-in .22s cubic-bezier(.2,.8,.2,1)}
.dsh-au-toast-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--au-toast-accent)}
.dsh-au-toast-badge:before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 16%,transparent);flex:0 0 auto}
.dsh-au-toast-head{display:flex;align-items:flex-start;gap:8px}
.dsh-au-toast-title{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);line-height:1.4}
.dsh-au-toast-x{flex:0 0 auto;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0;margin:-2px -4px 0 0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:16px;line-height:1;opacity:.6;cursor:pointer;transition:background .15s,opacity .15s}
.dsh-au-toast-x:hover{opacity:1;background:var(--dsw-alias-bg-mask-2,rgba(128,128,128,.14))}
.dsh-au-toast-body{color:var(--dsw-alias-label-secondary,rgba(128,128,128,1));line-height:1.55;font-size:12.5px}
.dsh-au-toast-list{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow:auto;margin:0 -4px}
.dsh-au-toast-item{display:flex;align-items:baseline;gap:8px;padding:3px 6px;border-radius:6px;background:var(--dsw-alias-bg-mask-1,rgba(128,128,128,.08))}
.dsh-au-toast-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit)}
.dsh-au-toast-ver{flex:0 0 auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-variant-numeric:tabular-nums}
.dsh-au-toast-more{font-size:11.5px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.85))}
.dsh-au-toast-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:2px}
@keyframes dsh-au-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dsh-au-toast{animation:none}}
`

    /** 只注入一次：id 存在就跳过，重复挂载/热更新都不会叠出第二份样式表。 */
    function installStyles() {
      try {
        const doc = typeof document === 'undefined' ? null : document
        if (doc === null || doc.head === null) return
        if (doc.getElementById(CSS_ID) !== null) return
        const tag = doc.createElement('style')
        tag.id = CSS_ID
        tag.setAttribute('data-dsh-aupdate', 'styles')
        tag.textContent = CSS_TEXT
        doc.head.appendChild(tag)
      } catch {}
    }

    /* 类名映射：组件里写 S.card 就等于挂上 dsh-au-section。 */
    const S = {
      wrap: 'dsh-au-wrap',
      head: 'dsh-au-head',
      title: 'dsh-au-title',
      sub: 'dsh-au-sub',
      card: 'dsh-au-section',
      h: 'dsh-au-h',
      note: 'dsh-au-note',
      row: 'dsh-au-row',
      labelBox: 'dsh-au-labelbox',
      label: 'dsh-au-label',
      hint: 'dsh-au-hint',
      input: 'dsh-au-input',
      select: 'dsh-au-select',
      search: 'dsh-au-search',
      url: 'dsh-au-url',
      vhead: 'dsh-au-vhead',
      vlist: 'dsh-au-vlist',
      vrow: 'dsh-au-vrow',
      vnum: 'dsh-au-vnum',
      vact: 'dsh-au-vact',
      dim: 'dsh-au-dim',
      bad: 'dsh-au-bad',
      pivot: 'dsh-au-pivot',
      actions: 'dsh-au-actions',
      btn: 'dsh-au-btn',
      btnPrimary: 'dsh-au-btn dsh-au-primary',
      status: 'dsh-au-status',
      err: 'dsh-au-err',
      meta: 'dsh-au-meta',
      cards: 'dsh-au-cards',
      stat: 'dsh-au-stat',
      statK: 'dsh-au-stat-k',
      statV: 'dsh-au-stat-v',
      check: 'dsh-au-check',
      logBox: 'dsh-au-log',
      logTime: 'dsh-au-logtime',
      logText: 'dsh-au-logtext',
      scrollList: 'dsh-au-scroll',
      pkgList: 'dsh-au-pkglist',
      pkgRow: 'dsh-au-pkgrow',
      pkgName: 'dsh-au-pkgname',
      pkgVer: 'dsh-au-pkgver',
      link: 'dsh-au-link',
      linkExt: 'dsh-au-linkext',
      ver: 'dsh-au-num',
    }
    function Toggle(props) {
      const { checked, onChange, disabled } = props
      return h('input', {
        type: 'checkbox',
        checked: checked === true,
        disabled: disabled === true,
        onChange: (event) => onChange(event.target.checked),
        className: S.check,
      })
    }

    function SwitchRow(props) {
      const { label, hint, value, onChange, disabled } = props
      return h('div', { className: S.row },
        h('div', { className: S.labelBox },
          h('span', { className: S.label }, label),
          hint ? h('span', { className: S.hint }, hint) : null,
        ),
        h(Toggle, { checked: value, onChange, disabled }),
      )
    }

    function NumberRow(props) {
      const { label, hint, value, onChange, min, max, disabled } = props
      return h('div', { className: S.row },
        h('div', { className: S.labelBox },
          h('span', { className: S.label }, label),
          hint ? h('span', { className: S.hint }, hint) : null,
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
          className: S.input,
        }),
      )
    }

    /**
     * HH:MM 输入。用 type="time" 而不是文本框：交给浏览器保证格式，
     * 后端也仍然会校验一次（写坏的设置不该让「每天几点」永远不触发）。
     */
    function ClockRow(props) {
      const { label, hint, value, onChange, disabled } = props
      return h('div', { className: S.row },
        h('div', { className: S.labelBox },
          h('span', { className: S.label }, label),
          hint ? h('span', { className: S.hint }, hint) : null,
        ),
        h('input', {
          type: 'time',
          value: typeof value === 'string' ? value : '03:00',
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.value),
          className: S.input,
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
      return h('div', { className: S.row },
        h('div', { className: S.labelBox },
          h('span', { className: S.label }, label),
          hint ? h('span', { className: S.hint }, hint) : null,
        ),
        h('select', {
          value,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.value),
          className: S.select,
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
      return h('div', { className: S.labelBox },
        h('span', { className: S.hint }, parts.join(' · ')),
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

      if (all.length === 0) return h('span', { className: S.status }, T.pkgsEmpty)

      return h('div', { className: 'dsh-au-col' },
        h('div', { className: S.actions },
          h('input', {
            type: 'search',
            value: query,
            placeholder: T.pkgsSearch,
            onChange: (event) => setQuery(event.target.value),
            className: S.search,
            style: { flex: '1 1 160px' },
          }),
          h('button', { type: 'button', className: S.btn, onClick: () => setVisible(true) }, T.pkgsAll),
          h('button', { type: 'button', className: S.btn, onClick: () => setVisible(false) }, T.pkgsNone),
          h('span', { className: S.hint }, T.pkgsCount.replace('{n}', String(chosen.size))),
        ),
        h('div', { className: S.pkgList },
          rows.length === 0
            ? h('span', { className: S.status, style: { padding: '4px' } }, T.pkgsNoMatch)
            : rows.map((item) => h('label', { key: item.name, className: S.pkgRow, title: item.name },
                h(Toggle, { checked: chosen.has(item.name), onChange: () => toggle(item.name) }),
                h('span', { className: S.pkgName }, item.name),
                item.version === ''
                  ? h('span', { className: S.pkgVer }, T.pkgsNotInstalled)
                  : h('span', { className: S.pkgVer }, item.version),
              )),
        ),
      )
    }

    /**
     * 「关于 aupdate」信息组。
     *
     * 照 Bloom 设置页的「关于 Bloom」做：版本、更新日志、仓库、反馈四行纯信息，
     * 再加「点个星 / 分享」。版本从 /state 读（随 package.json 变），不写死。
     *
     * 分享用 clipboard 复制项目地址：navigator.share 在桌面 webview 里多半不可用，
     * 而「复制地址」在任何环境都能工作；失败就让用户手动复制，不静默吞掉。
     */
    function AboutCard(props) {
      useLang()
      const [shareHint, setShareHint] = useState('')
      const version = props.version || ''

      const extLink = (href, label) => h('a', {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: S.link,
      }, label, h('span', { className: S.linkExt, 'aria-hidden': 'true' }, '↗'))

      const share = async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(REPO_URL)
            setShareHint(T.aboutShareDone)
            return
          }
          setShareHint(T.aboutShareFail)
        } catch {
          setShareHint(T.aboutShareFail)
        }
      }

      return h('div', { className: S.card },
        h('h3', { className: S.h }, T.about),
        h('div', { className: S.row },
          h('span', { className: S.label }, T.aboutVersion),
          h('span', { className: S.ver }, version === '' ? '…' : 'v' + version),
        ),
        h('div', { className: S.row },
          h('span', { className: S.label }, T.aboutChangelog),
          extLink(CHANGELOG_URL, T.aboutChangelogLink),
        ),
        h('div', { className: S.row },
          h('span', { className: S.label }, T.aboutRepo),
          extLink(REPO_URL, 'GitHub'),
        ),
        h('div', { className: S.row },
          h('span', { className: S.label }, T.aboutFeedback),
          extLink(ISSUES_URL, T.aboutFeedbackLink),
        ),
        h('div', { className: S.row },
          h('span', { className: S.labelBox },
            h('span', { className: S.label }, T.aboutStar),
            h('span', { className: S.hint }, T.aboutStarHint),
          ),
          extLink(STARS_URL, 'GitHub'),
        ),
        h('div', { className: S.row },
          h('span', { className: S.labelBox },
            h('span', { className: S.label }, T.aboutShare),
            h('span', { className: S.hint }, T.aboutShareHint),
          ),
          h('button', { type: 'button', className: S.btn, onClick: () => void share() }, T.aboutShare),
        ),
        // 项目地址可点开、可选中复制，失败时用户还有这一条路。
        h('div', { className: S.row },
          h('span', { className: S.label }, T.aboutProject),
          extLink(REPO_URL, REPO_URL.replace('https://', '')),
        ),
        shareHint ? h('span', { className: S.status }, shareHint) : null,
      )
    }

    function AutoUpdateCard() {
      useLang()
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState(null)
      const [phase, setPhase] = useState('loading') // loading | ready | error
      const [saveHint, setSaveHint] = useState('')
      const [running, setRunning] = useState(false)
      // 安装可能耗好几分钟（网络重试时更久），运行按钮旁边显示实时进度。
      const [progress, setProgress] = useState(null)
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

      // 进度轮询要常驻：更新多数是定时器自动触发的，若只在点「立刻检查」时轮询，
      // 自动跑的那一轮界面上什么也看不到——上次就是这个原因以为进度功能没生效。
      useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const next = await getState(LANG)
            if (alive) {
              setProgress(next?.progress ?? null)
              // 别人（定时器 / 另一个窗口）触发的轮次，也把 running 点亮。
              if (next?.progress) setRunning(true)
            }
          } catch {}
        }
        void tick()
        const timer = setInterval(() => { void tick() }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [LANG])

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


      /** 把后端进度翻成一行中文/英文；没进度就退回普通「正在检查」。 */
      const runningText = (() => {
        if (!progress) return ''
        if (progress.phase === 'installing' && progress.total > 0) {
          return T.progressInstall
            .replace('{n}', String(progress.index))
            .replace('{m}', String(progress.total))
            .replace('{name}', String(progress.name || ''))
        }
        if (progress.phase === 'applying') return T.progressApply
        if (progress.phase === 'checking') return T.progressCheck
        return T.running
      })()

      const fire = useCallback(async () => {
        if (running) return
        setRunning(true)
        setRunHint(T.running)
        try {
          // 进度由上面的常驻轮询统一负责，这里只发请求。
          const result = await runNow('update')
          if (result?.started === false) {
            // 「已经有一轮在跑」这类信息在「上一次」里没有，必须显示。
            setRunHint(result.reason || T.runFailed)
          } else {
            // 只给一句「检查完成」。原因和状态已经写进「上一次」那张卡，
            // 这里再拼一遍 reason + status 会和它逐字重复（还有英文 done）。
            setRunHint(T.runDone)
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
          // 不在这里清 progress：常驻轮询会在后端清掉后同步，手动作废会和它打架。
        }
      }, [running])

      // 结束提示只是一次性反馈：6 秒后自己收掉，免得它一直挂在卡片里，
      // 和下面「上一次」的原因并列成两段一样的文字。
      useEffect(() => {
        if (running || runHint === '') return undefined
        const timer = setTimeout(() => setRunHint(''), 6000)
        return () => clearTimeout(timer)
      }, [running, runHint])

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
        return h('div', { className: S.card },
          h('span', { className: S.err }, T.unavailable),
          h('div', { className: S.actions }, h('button', { type: 'button', className: S.btn, onClick: () => void load() }, T.retry)),
        )
      }

      if (phase === 'loading' || draft === null) {
        return h('div', { className: S.card }, h('span', { className: S.status }, '…'))
      }

      const last = state?.lastRun
      const applied = appliedCount(last)

      return h('div', { className: S.wrap },
        h('div', { className: S.head },
          h('h3', { className: S.title }, T.title),
          h('p', { className: S.sub }, T.subtitle),
        ),
        h('div', { className: S.card },
          h('h3', { className: S.h }, T.secGeneral),
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
        h('div', { className: S.card },
          h('h3', { className: S.h }, T.secSchedule),
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
          h('div', { className: S.labelBox },
            h('span', { className: S.label }, T.pkgsExclude),
            h('span', { className: S.hint }, T.pkgsExcludeHint),
          ),
          h(PackagePicker, {
            packages: state?.packages,
            selected: draft.exclude,
            onChange: (list) => patch('exclude', list),
          }),
        ),
        // 策略：预发布 / 跨大版本，决定「什么算可以装」。
        h('div', { className: S.card },
          h('h3', { className: S.h }, T.policy),
          h(SwitchRow, { label: T.allowMajor, hint: T.allowMajorHint, value: draft.allowMajor, onChange: (v) => patch('allowMajor', v) }),
          h(SwitchRow, { label: T.allowPrerelease, hint: T.allowPrereleaseHint, value: draft.allowPrerelease, onChange: (v) => patch('allowPrerelease', v) }),
        ),
        // 安装源 + 兼容性预检（0.8.0 借自 dsh-plugin-upgrader，见 docs/BORROWED-FROM-UPGRADER.md）。
        h('div', { className: S.card },
          h('h3', { className: S.h }, T.registry),
          h(SelectRow, {
            label: T.registry,
            hint: T.registryHint,
            value: draft.registryMode ?? 'pnpm',
            onChange: (v) => patch('registryMode', v),
            options: [
              { value: 'pnpm', label: T.regPnpm },
              { value: 'npmjs', label: T.regNpmjs },
              { value: 'mirror', label: T.regMirror },
              { value: 'custom', label: T.regCustom },
            ],
          }),
          (draft.registryMode ?? 'pnpm') === 'custom'
            ? h('div', { className: S.row },
                h('div', { className: S.labelBox },
                  h('span', { className: S.label }, T.regUrl),
                  h('span', { className: S.hint }, T.regUrlHint),
                ),
                h('input', {
                  type: 'url',
                  value: draft.registryUrl ?? '',
                  placeholder: 'https://registry.example.com',
                  onChange: (event) => patch('registryUrl', event.target.value),
                  className: S.url,
                }),
              )
            : null,
          h(SwitchRow, { label: T.compatCheck, hint: T.compatCheckHint, value: draft.compatCheck !== false, onChange: (v) => patch('compatCheck', v) }),
          // 这两项是只读的现场信息：出问题时第一句话就是「你的 DSH 是哪个版本、走的哪个源」。
          h('div', { className: S.meta },
            h('span', null, T.dshVersion + ': ' + (state?.dshVersion ?? '—')),
            h('span', null, T.registry + ': ' + (state?.registry === '' || !state?.registry ? T.regPnpm : state.registry)),
          ),
        ),
        h('div', { className: S.card },
          h('h3', { className: S.h }, T.keepTitle),
          h('p', { className: S.note }, T.keepHint),
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
          h('div', { className: S.actions },
            h('button', { type: 'button', className: S.btn, disabled: cleaning, onClick: () => void doCleanup() }, cleaning ? T.cleaning : T.cleanNow),
            cleanHint ? h('span', { className: S.status }, cleanHint) : null,
          ),
        ),
        h('div', { className: S.card },
          // 按钮和它动作的对象放在一起：读「上一次」的人最想做的事就是再跑一次。
          h('div', { className: S.row },
            h('div', { className: S.labelBox },
              h('h3', { className: S.h }, T.lastRun),
              last === null || last === undefined ? h('span', { className: S.hint }, T.never) : null,
            ),
            h('button', { type: 'button', className: S.btnPrimary, disabled: running, onClick: () => void fire() }, running ? T.running : T.runNow),
          ),
          // 进度单独占一行：安装要几分钟甚至更久，这里明确告诉用户在装第几个。
          progress ? h('span', { className: 'dsh-au-badge run' }, runningText) : null,
          // 三张统计卡，照 cost-meter 概览页的写法：一眼看到「什么时候查的、
          // 查了多少、几个能更」，而不是一串用 · 拼起来的句子。
          last === null || last === undefined ? null : h('div', { className: S.cards },
            h('div', { className: S.stat },
              h('span', { className: S.statK }, T.lastChecked),
              h('span', { className: S.statV, title: last.at || '' }, formatWhen(last.at) || '—'),
              relativeWhen(last.at) ? h('span', { className: S.hint }, relativeWhen(last.at)) : null,
            ),
            h('div', { className: S.stat },
              h('span', { className: S.statK }, T.checked),
              h('span', { className: S.statV }, String(last.checked ?? 0)),
              h('span', { className: S.hint }, T.packages),
            ),
            h('div', { className: S.stat },
              h('span', { className: S.statK }, applied > 0 ? T.lastUpdated : T.lastUpdates),
              h('span', { className: S.statV }, String(applied > 0 ? applied : (last.updates?.length ?? 0))),
              // 卡片里标题已经是「已更新」，副标题只补量词，不再重复一遍「已更新」。
              h('span', { className: S.hint }, applied > 0
                ? T.updatedHint
                : (last.updates?.length ?? 0) > 0 ? T.updates : T.upToDate),
            ),
          ),
          // 原因只说一遍：徽标承接状态词，正文承接句子，两者不重复同一句话。
          (() => {
            if (last === null || last === undefined) return null
            const reason = typeof last.reason === 'string' ? last.reason : ''
            const status = statusLabel(last.status)
            if (reason === '' && status === '') return null
            return h('div', { className: S.row },
              reason === '' ? null : h('span', { className: S.note }, reason),
              status === '' ? null : h('span', { className: badgeClass(last.status) }, status),
            )
          })(),
          // 只报「4 个可更新」不够：要看得出是哪几个、从哪版到哪版。
          // 列表封高度、内部滚动，30 个包也不会把这张卡拉成一屏多。
          (() => {
            const rows = (Array.isArray(last?.updates) ? last.updates : [])
              .map((item) => describeUpdate(item))
              .filter((row) => row !== null)
            if (rows.length === 0) return null
            return h('div', { className: S.scrollList },
              rows.map((row, index) => h('div', {
                key: row.name + ':' + index,
                className: 'dsh-au-line',
              },
                h('span', { className: S.pkgName, title: row.name }, row.name),
                row.versions === '' ? null : h('span', { className: S.pkgVer }, row.versions),
              )),
            )
          })(),
          // 镜像落后和「装不了」都要按名字说出来：只报「已是最新」或「一个没装上」，
          // 用户没法知道该换源还是该升 DSH。
          (last?.lagged?.length ?? 0) > 0
            ? h('p', { className: S.note }, T.lagNote.replace('{n}', String(last.lagged.length)) + ' · ' +
                last.lagged.slice(0, 3).map((row) => row.name + ' ' + (row.mirror ?? '?') + ' → ' + (row.upstream ?? '?')).join('，'))
            : null,
          (last?.blocked?.length ?? 0) > 0
            ? h('p', { className: S.note }, T.blockedNote.replace('{n}', String(last.blocked.length)) + ' · ' +
                last.blocked.slice(0, 3).map((row) => row.name + '@' + (row.target ?? '?')).join('，'))
            : null,
          runHint ? h('span', { className: S.status }, runHint) : null,
        ),
        // 更新记录：谁、从哪到哪、什么时候、成没成，以及回滚入口。
        h('div', { className: S.card },
          h('h3', { className: S.h }, T.history),
          (state?.history?.length ?? 0) === 0
            ? h('span', { className: S.status }, T.historyEmpty)
            : h('div', { className: S.scrollList },
                state.history.map((row, index) => h('div', {
                  key: row.name + '@' + row.at + ':' + index,
                  className: S.row,
                },
                  h('div', { className: S.labelBox },
                    h('span', null, row.name + '  ' + (row.from ?? '?') + ' → ' + (row.to ?? '?')),
                    h('span', { className: S.hint, title: row.at || '' },
                      formatWhen(row.at) + (relativeWhen(row.at) ? '（' + relativeWhen(row.at) + '）' : '') +
                      (row.rolledBack === true ? ' · ' + T.rolledBack : '')),
                  ),
                  row.rolledBack === true || typeof row.from !== 'string' || row.from === ''
                    ? null
                    : h('button', {
                        type: 'button',
                        className: confirming === row.name ? S.btnPrimary : S.btn,
                        disabled: rolling !== '' || running,
                        onClick: () => void doRollback(row.name),
                      }, rolling === row.name ? T.rollingBack : confirming === row.name ? T.rollback + '?' : T.rollback),
                )),
              ),
          rollHint ? h('span', { className: S.status }, rollHint) : null,
        ),
        h(LogCard, null),
        // 没有保存按钮：改动自己在 350ms 后落盘，这里只报它落没落成。
        saveHint ? h('span', { className: S.status }, saveHint) : null,
        h('span', { className: S.hint }, T.scope),
        h(AboutCard, { version: state?.version }),
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

      return h('div', { className: S.card },
        h('div', { className: S.row },
          h('div', { className: S.labelBox },
            h('h3', { className: S.h }, T.logs),
            h('span', { className: S.hint }, T.logsHint + ' · ' + T.logsNewest),
          ),
          h('div', { className: S.actions },
            h('select', {
              value: String(lines),
              onChange: (event) => setLines(Number(event.target.value)),
              className: S.select,
            }, [100, 200, 500, 1000].map((n) => h('option', { key: n, value: String(n) }, n + ' ' + T.logsLines))),
            h('button', { type: 'button', className: S.btn, onClick: () => setTick((n) => n + 1) }, T.logsRefresh),
          ),
        ),
        h(SwitchRow, { label: T.logsAuto, hint: T.logsAutoHint, value: auto, onChange: setAuto }),
        phase === 'loading' && data === null
          ? h('span', { className: S.status }, '…')
          : phase === 'missing' || (data !== null && data.exists === false)
            ? h('span', { className: S.status }, T.logsMissing)
            : rows.length === 0
              ? h('span', { className: S.status }, T.logsEmpty)
              : h('pre', { className: S.logBox, title: data?.path || '' },
                  rows.map((row, index) => h('div', { key: index },
                    row.at ? h('span', { className: S.logTime }, formatLogWhen(row.at) + '  ') : null,
                    h('span', { className: S.logText }, row.text),
                  )),
                ),
        data !== null && data.exists !== false
          ? h('div', { className: S.meta },
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
          ? (T.enabled + '：' + T.off)
          : last === null || last === undefined
            ? T.never
            : appliedCount(last) > 0
              ? appliedCount(last) + ' ' + T.updatedUnit
              : (last.updates?.length ?? 0) > 0
                ? (last.updates?.length ?? 0) + ' ' + T.updates
                : T.upToDate
        return h('span', { className: S.status }, text)
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

    /**
     * 把一条「可更新」记录归一成 { name, versions }。
     *
     * 后端 0.6.8 起存 { name, from, to }；更早的版本存的是成品句子
     * 「名字 1.0 -> 1.1」。两种都要能显示——旧数据不该因为升级就变成
     * undefined。之前正是只按对象读，句子条目全是 undefined ? → ?。
     */
    function describeUpdate(item) {
      if (typeof item === 'string') {
        const text = item.trim()
        if (text === '') return null
        const match = /^(.*) (\S+) -> (\S+)$/u.exec(text)
        if (match === null) return { name: text, versions: '' }
        return { name: match[1], versions: match[2] + ' → ' + match[3] }
      }
      if (item === null || typeof item !== 'object') return null
      const name = typeof item.name === 'string' ? item.name : ''
      if (name === '') return null
      const from = typeof item.from === 'string' && item.from !== '' ? item.from : '?'
      const to = typeof item.to === 'string' && item.to !== '' ? item.to : '?'
      return { name, versions: from + ' → ' + to }
    }

    /**
     * 这一轮「真的换掉了几个版本」。
     *
     * lastRun.updates 是「发现了哪些新版本」，安装被关掉、被让开、装失败时它照样有值。
     * 界面上说「已更新 N 个」就必须是装成了的，否则把「查到 4 个」写成「更新了 4 个」
     * 是在撒谎。installed 里失败的条目带 ' !failed'，要减掉。
     */
    function appliedCount(last) {
      if (last === null || last === undefined) return 0
      const rows = Array.isArray(last.installed) ? last.installed : []
      return rows.filter((row) => typeof row === 'string' && !row.endsWith('!failed')).length
    }

    function updateSignature(updates) {
      return (Array.isArray(updates) ? updates : [])
        .map((item) => describeUpdate(item))
        .filter((row) => row !== null)
        .map((row) => row.name + '@' + row.versions)
        .sort()
        .join('|')
    }

    function showUpdateToast(updates, applied) {
      if (toastOpen) return
      const doc = typeof document === 'undefined' ? null : document
      if (doc === null || doc.body === null) return
      const rows = (Array.isArray(updates) ? updates : []).map((item) => describeUpdate(item)).filter((row) => row !== null)
      if (rows.length === 0) return
      toastOpen = true
      // 提醒可能在设置页之外弹出来，样式表没装就先补上（幂等）。
      installStyles()
      const box = doc.createElement('div')
      box.setAttribute('data-dsh-aupdate', 'toast')
      box.className = 'dsh-au-toast'
      box.setAttribute('role', 'status')
      box.setAttribute('aria-live', 'polite')

      // 结构与 cost-meter 的「峰/谷切换提醒」一致：圆点徽标 → 标题行（含 ×）
      // → 一句正文 → 清单 → 右对齐按钮。徽标是那张卡最好认的一处，这里复用它。
      const badge = doc.createElement('div')
      badge.className = 'dsh-au-toast-badge'
      badge.textContent = applied > 0 ? T.toastBadge : T.toastBadgeFound
      box.appendChild(badge)

      const head = doc.createElement('div')
      head.className = 'dsh-au-toast-head'
      const title = doc.createElement('div')
      title.className = 'dsh-au-toast-title'
      // 真的装完了才说「已更新」；只查到、没动手时说「可更新」，别把「发现」说成「装了」。
      title.textContent = (applied > 0 ? T.toastTitle : T.toastTitleFound).replace('{n}', String(rows.length))
      const xBtn = doc.createElement('button')
      xBtn.type = 'button'
      xBtn.className = 'dsh-au-toast-x'
      xBtn.textContent = '×'
      xBtn.setAttribute('aria-label', T.toastDismiss)
      head.appendChild(title)
      head.appendChild(xBtn)
      box.appendChild(head)

      const body = doc.createElement('div')
      body.className = 'dsh-au-toast-body'
      body.textContent = applied > 0 ? T.toastBody : T.toastBodyFound
      box.appendChild(body)

      const list = doc.createElement('div')
      list.className = 'dsh-au-toast-list'
      // 超过 12 条就在框内滚动：提醒不该占掉半屏。
      for (const row of rows.slice(0, 12)) {
        const line = doc.createElement('div')
        line.className = 'dsh-au-toast-item'
        const nameEl = doc.createElement('span')
        nameEl.className = 'dsh-au-toast-name'
        nameEl.textContent = row.name
        // 包名可能很长（@scope/name），压缩它而不是压缩版本。
        line.appendChild(nameEl)
        if (row.versions !== '') {
          const verEl = doc.createElement('span')
          verEl.className = 'dsh-au-toast-ver'
          verEl.textContent = row.versions
          line.appendChild(verEl)
        }
        list.appendChild(line)
      }
      box.appendChild(list)

      if (rows.length > 12) {
        const more = doc.createElement('div')
        more.className = 'dsh-au-toast-more'
        more.textContent = T.toastMore.replace('{n}', String(rows.length - 12))
        box.appendChild(more)
      }

      const foot = doc.createElement('div')
      foot.className = 'dsh-au-toast-foot'
      const close = doc.createElement('button')
      close.type = 'button'
      close.className = 'dsh-au-btn dsh-au-primary'
      close.textContent = T.toastDismiss
      foot.appendChild(close)
      box.appendChild(foot)

      let closed = false
      const dismiss = () => {
        if (closed) return
        closed = true
        toastOpen = false
        try { doc.removeEventListener('keydown', onKey, true) } catch {}
        try { box.remove() } catch {}
      }
      // Esc 也能关：浮层挡住右下角时，键盘用户不该只能等它自己消失。
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          dismiss()
        }
      }
      close.addEventListener('click', dismiss)
      xBtn.addEventListener('click', dismiss)
      try { doc.addEventListener('keydown', onKey, true) } catch {}
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
              // 签名算的是「包名+版本变化」，旧格式也能算出来，不会重复弹。
              const sig = updateSignature(updates)
              if (sig !== notifiedMark()) {
                markNotified(sig)
                showUpdateToast(updates, appliedCount(state?.lastRun))
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

    /**
     * 「版本管理」标签页。
     *
     * 和设置页的分工：设置页管「什么时候自动升」，这一页管「现在就要某一版」。
     * 版本列表按包按需拉（一次一个包），不进首屏：整页一次拉一堆包的 packument
     * 在镜像上会慢到没法用。
     */
    function VersionsTab() {
      useLang()
      const [state, setState] = useState(null)
      const [query, setQuery] = useState('')
      const [openName, setOpenName] = useState('')
      const [lists, setLists] = useState({})
      const [loadError, setLoadError] = useState('')
      const [busy, setBusy] = useState('')
      const [hint, setHint] = useState('')

      const reload = useCallback(async () => {
        try {
          setState(await getState(LANG))
        } catch {}
      }, [])

      useEffect(() => { void reload() }, [reload])

      // 切版本可能要好几分钟（pnpm 要校验锁文件），期间才轮询；闲着时一个请求都不发。
      useEffect(() => {
        if (busy === '') return undefined
        const timer = setInterval(async () => {
          try {
            setState(await getState(LANG))
          } catch {}
        }, 3000)
        return () => clearInterval(timer)
      }, [busy])

      const openVersions = useCallback(async (name) => {
        if (openName === name) {
          setOpenName('')
          return
        }
        setOpenName(name)
        setLoadError('')
        if (lists[name] !== undefined) return
        try {
          const response = await fetch(endpoint('versions') + '?name=' + encodeURIComponent(name) + '&lang=' + (LANG === 'en' ? 'en' : 'zh'), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          if (!response.ok) throw new Error('versions ' + response.status)
          const payload = await response.json()
          setLists((prev) => ({ ...prev, [name]: payload }))
        } catch {
          setLoadError(T.versionsFailed)
        }
      }, [openName, lists])

      const doSwitch = useCallback(async (name, version) => {
        if (busy !== '') return
        setBusy(name + '@' + version)
        setHint('')
        try {
          const response = await fetch(endpoint('switch') + langQuery(), {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ name, version }),
          })
          const payload = await response.json().catch(() => null)
          if (response.ok) {
            setHint(payload?.unchanged === true ? T.versionsNoop : T.versionsDone.replace('{v}', version))
            // 版本变了，这个包的缓存列表要作废，否则「当前」标记还停在旧版本上。
            setLists((prev) => {
              const next = { ...prev }
              delete next[name]
              return next
            })
            await reload()
          } else {
            setHint(T.versionsFail + ' · ' + (payload?.reason || payload?.detail || ('HTTP ' + response.status)))
          }
        } catch {
          setHint(T.versionsFail)
        } finally {
          setBusy('')
        }
      }, [busy, reload])

      const packages = useMemo(() => {
        const all = Array.isArray(state?.packages) ? state.packages : []
        const text = query.trim().toLowerCase()
        return text === '' ? all : all.filter((item) => String(item.name).toLowerCase().includes(text))
      }, [state, query])

      const progress = state?.progress
      const runningText = (() => {
        if (!progress) return ''
        if (progress.phase === 'installing' && progress.total > 0) {
          return T.progressInstall
            .replace('{n}', String(progress.index))
            .replace('{m}', String(progress.total))
            .replace('{name}', String(progress.name || ''))
        }
        if (progress.phase === 'applying') return T.progressApply
        return T.running
      })()

      return h('div', { className: S.wrap },
        h('div', { className: S.head },
          h('h3', { className: S.title }, T.versionsTitle),
          h('p', { className: S.sub }, T.versionsSubtitle),
        ),
        h('div', { className: S.card },
          h('div', { className: S.vhead },
            h('input', {
              type: 'search',
              value: query,
              placeholder: T.versionsSearch,
              onChange: (event) => setQuery(event.target.value),
              className: S.search,
              style: { flex: '1 1 200px' },
            }),
            h('span', { className: S.hint }, T.versionsCount.replace('{n}', String(packages.length))),
          ),
          h('div', { className: S.meta },
            h('span', null, T.dshVersion + ': ' + (state?.dshVersion ?? '—')),
            h('span', null, T.registry + ': ' + (state?.registry === '' || !state?.registry ? T.regPnpm : state.registry)),
          ),
          progress ? h('span', { className: 'dsh-au-badge run' }, runningText) : null,
          hint ? h('span', { className: S.status }, hint) : null,
          loadError ? h('p', { className: S.err }, loadError) : null,
          packages.length === 0
            ? h('span', { className: S.status }, T.versionsEmpty)
            : h('div', { className: S.scrollList },
                packages.map((item) => {
                  const listed = lists[item.name]
                  const expanded = openName === item.name
                  return h('div', { key: item.name, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                    h('div', { className: S.row },
                      h('div', { className: S.labelBox },
                        h('span', { title: item.name }, item.name),
                        h('span', { className: S.hint },
                          T.versionsInstalled + ' ' + (item.version === '' ? '—' : item.version) +
                          (listed && listed.tagVersion !== '' ? ' · ' + T.versionsLatest + ' ' + listed.tagVersion : '')),
                      ),
                      h('button', {
                        type: 'button',
                        className: expanded ? S.btn : S.btn,
                        onClick: () => void openVersions(item.name),
                      }, expanded ? T.versionsHide : T.versionsShow),
                    ),
                    expanded
                      ? listed === undefined
                        ? h('span', { className: S.hint }, T.versionsLoading)
                        : h('div', { className: S.vlist },
                            h('span', { className: S.dim }, T.versionsTotal.replace('{n}', String(listed.total ?? 0)) +
                              (listed.latest !== '' ? ' · ' + T.versionsLatest + ' ' + listed.latest : '')),
                            (listed.versions ?? []).map((row) => {
                              const isCurrent = row.version === item.version
                              const blocked = row.ok === false
                              return h('div', { key: row.version, className: S.vrow },
                                h('span', { className: S.vnum }, row.version),
                                isCurrent ? h('span', { className: S.pivot }, T.versionsCurrent) : null,
                                row.version === listed.latest && !isCurrent ? h('span', { className: S.pivot }, T.versionsLatest) : null,
                                row.deprecated === true ? h('span', { className: S.dim }, T.versionsDeprecated) : null,
                                blocked
                                  ? h('span', { className: S.bad, title: T.versionsNeed.replace('{r}', row.need || '?') }, T.versionsBlocked)
                                  : null,
                                h('div', { className: S.vact },
                                  isCurrent
                                    ? null
                                    : h('button', {
                                        type: 'button',
                                        className: blocked ? S.btn : S.btnPrimary,
                                        disabled: blocked || busy !== '',
                                        title: blocked ? T.versionsNeed.replace('{r}', row.need || '?') : '',
                                        onClick: () => void doSwitch(item.name, row.version),
                                      }, busy === item.name + '@' + row.version ? T.running : T.versionsSwitch),
                                ),
                              )
                            }),
                          )
                      : null,
                  )
                }),
              ),
        ),
        h('span', { className: S.hint }, T.scope),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 样式表只注入一次；先把类挂上去，第一帧就是最终样子，不会闪一下。
        installStyles()
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

        // 插件页标签栏多一个「版本管理」：和设置页分工——设置页管「什么时候自动升」，
        // 这一页管「现在就要某一版」。order 2 排在「已安装/发现」(0) 和市场(1) 之后。
        ctx.slots.inject('plugins.tab', () => ctx.slots.register({
          name: 'plugins.tab',
          id: NS,
          order: 2,
          label: () => T.versionsTab,
        }, () => h(VersionsTab)))
      },
    }
  },
})
