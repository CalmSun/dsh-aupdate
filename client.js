window.__ModuleLoader__.load({
  id: 'dsh-aupdate',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
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
        allow: '只更新这些包',
        allowHint: '每行一个包名；留空表示全部包都参与',
        allowMajor: '允许跨大版本',
        allowMajorHint: '关闭后只在同一主版本内升级（0.x 插件多半会因此长期不动）',
        allowPrerelease: '允许预发布版本',
        allowPrereleaseHint: '关闭时只装正式版；走 next 标签的 DSH 本体不受影响',
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
        allow: 'Only update these',
        allowHint: 'one package name per line; empty means every package',
        allowMajor: 'Allow major upgrades',
        allowMajorHint: 'Off keeps upgrades inside one major; 0.x plugins would rarely move',
        allowPrerelease: 'Allow prereleases',
        allowPrereleaseHint: 'Off installs stable only; DSH itself on the next tag is unaffected',
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

    const IS_ZH = detectZh()
    const T = IS_ZH ? COPY.zh : COPY.en
    const LOCALE = IS_ZH ? 'zh-CN' : 'en-US'

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

    /** 「上一次」的光看绝对时间不好判断新鲜度，补一句相对时间。 */
    function relativeWhen(iso) {
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) return ''
      const minutes = Math.floor((Date.now() - when.getTime()) / 60000)
      if (minutes < 1) return IS_ZH ? '刚刚' : 'just now'
      if (minutes < 60) return IS_ZH ? minutes + ' 分钟前' : minutes + ' min ago'
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return IS_ZH ? hours + ' 小时前' : hours + ' h ago'
      const days = Math.floor(hours / 24)
      return IS_ZH ? days + ' 天前' : days + ' d ago'
    }

    function endpoint(name) {
      try {
        return new URL(API + '/' + name, document.baseURI).toString()
      } catch {
        return '/' + API + '/' + name
      }
    }

    async function getState() {
      const response = await fetch(endpoint('state'), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('state ' + response.status)
      return response.json()
    }

    async function saveState(patch) {
      const response = await fetch(endpoint('state'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error('save ' + response.status)
      return response.json()
    }

    async function rollback(name) {
      const response = await fetch(endpoint('rollback'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name }),
      })
      const payload = await response.json().catch(() => null)
      return { ok: response.ok, payload }
    }

    async function runNow(mode) {
      const response = await fetch(endpoint('run'), {
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

    function AutoUpdateCard() {
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState(null)
      const [phase, setPhase] = useState('loading') // loading | ready | error
      const [saving, setSaving] = useState(false)
      const [saveHint, setSaveHint] = useState('')
      const [running, setRunning] = useState(false)
      const [runHint, setRunHint] = useState('')
      const [rolling, setRolling] = useState('')
      const [rollHint, setRollHint] = useState('')
      const [confirming, setConfirming] = useState('')

      const load = useCallback(async () => {
        setPhase('loading')
        try {
          const next = await getState()
          setState(next)
          setDraft(next.settings)
          setPhase('ready')
        } catch {
          setPhase('error')
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const patch = useCallback((key, value) => {
        setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value }))
        setSaveHint('')
      }, [])

      const dirty = useMemo(() => {
        if (state === null || draft === null) return false
        const keys = ['enabled', 'autoApply', 'hotReload', 'checkOnStart', 'idleOnly', 'intervalMinutes', 'firstDelayMinutes', 'allowMajor', 'allowPrerelease', 'scheduleMode', 'dailyAt', 'everyHours', 'everyDays', 'suppressHours']
        for (const key of keys) {
          if (draft[key] !== state.settings[key]) return true
        }
        for (const listKey of ['exclude', 'allow']) {
          if (String((draft[listKey] || []).join('\n')) !== String((state.settings[listKey] || []).join('\n'))) return true
        }
        return false
      }, [state, draft])

      const save = useCallback(async () => {
        if (draft === null || saving) return
        setSaving(true)
        setSaveHint('')
        try {
          const next = await saveState({
            enabled: draft.enabled,
            autoApply: draft.autoApply,
            hotReload: draft.hotReload,
            checkOnStart: draft.checkOnStart,
            idleOnly: draft.idleOnly,
            intervalMinutes: draft.intervalMinutes,
            firstDelayMinutes: draft.firstDelayMinutes,
            exclude: draft.exclude,
            allow: draft.allow,
            allowMajor: draft.allowMajor,
            allowPrerelease: draft.allowPrerelease,
            scheduleMode: draft.scheduleMode,
            dailyAt: draft.dailyAt,
            everyHours: draft.everyHours,
            everyDays: draft.everyDays,
            suppressHours: draft.suppressHours,
          })
          setState(next)
          setDraft(next.settings)
          setSaveHint(T.saved + ' · ' + T.savedHint)
        } catch {
          setSaveHint(T.failed)
        } finally {
          setSaving(false)
        }
      }, [draft, saving])

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
            const next = await getState()
            setState(next)
            setDraft((prev) => (prev === null ? next.settings : prev))
          } catch {}
        } catch {
          setRunHint(T.runFailed)
        } finally {
          setRunning(false)
        }
      }, [running])

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
            const next = await getState()
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
          h('p', { style: S.sub }, T.sub),
        ),
        h('div', { style: S.card },
          h(SwitchRow, { label: T.enabled, hint: T.enabledHint, value: draft.enabled, onChange: (v) => patch('enabled', v) }),
          h(SwitchRow, { label: T.autoApply, hint: T.autoApplyHint, value: draft.autoApply, onChange: (v) => patch('autoApply', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.hotReload, hint: T.hotReloadHint, value: draft.hotReload, onChange: (v) => patch('hotReload', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.checkOnStart, value: draft.checkOnStart, onChange: (v) => patch('checkOnStart', v), disabled: !draft.enabled }),
          h(SwitchRow, { label: T.idleOnly, hint: T.idleOnlyHint, value: draft.idleOnly, onChange: (v) => patch('idleOnly', v), disabled: !draft.enabled }),
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
          h('div', { style: S.labelBox },
            h('span', { style: S.label }, T.exclude),
            h('span', { style: S.hint }, T.excludeHint),
          ),
          h('textarea', {
            value: (draft.exclude || []).join('\n'),
            disabled: !draft.enabled,
            onChange: (event) => patch('exclude', event.target.value.split('\n').map((line) => line.trim()).filter((line) => line !== '')),
            style: S.area,
            spellCheck: false,
          }),
        ),
        // 策略与范围：白名单 / 预发布 / 跨大版本，决定「什么算可以装」。
        h('div', { style: S.card },
          h('span', { style: S.label }, T.policy),
          h(SwitchRow, { label: T.allowMajor, hint: T.allowMajorHint, value: draft.allowMajor, onChange: (v) => patch('allowMajor', v) }),
          h(SwitchRow, { label: T.allowPrerelease, hint: T.allowPrereleaseHint, value: draft.allowPrerelease, onChange: (v) => patch('allowPrerelease', v) }),
          h('div', { style: S.labelBox },
            h('span', { style: S.label }, T.allow),
            h('span', { style: S.hint }, T.allowHint),
          ),
          h('textarea', {
            value: (draft.allow || []).join('\n'),
            onChange: (event) => patch('allow', event.target.value.split('\n').map((line) => line.trim()).filter((line) => line !== '')),
            style: S.area,
            spellCheck: false,
          }),
        ),
        h('div', { style: S.actions },
          h('button', { type: 'button', style: dirty ? S.btnPrimary : S.btn, disabled: !dirty || saving, onClick: () => void save() }, saving ? T.saving : T.save),
          h('button', { type: 'button', style: S.btn, disabled: running, onClick: () => void fire() }, running ? T.running : T.runNow),
          saveHint ? h('span', { style: S.status }, saveHint) : null,
          runHint ? h('span', { style: S.status }, runHint) : null,
        ),
        h('div', { style: S.card },
          h('span', { style: S.label }, T.lastRun),
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
        ),
        // 更新记录：谁、从哪到哪、什么时候、成没成，以及回滚入口。
        h('div', { style: S.card },
          h('span', { style: S.label }, T.history),
          (state?.history?.length ?? 0) === 0
            ? h('span', { style: S.status }, T.historyEmpty)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
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
        h('span', { style: S.hint }, T.scope),
      )
    }

    /**
     * 插件页里这一行有两个视图：收起时是 summary（一行摘要），展开后是整页。
     * summary 只报最关键的一件事——上次检查的结果，别把整页塞进一行。
     */
    function AutoUpdateSummary() {
      const [state, setState] = useState(null)
      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const next = await getState()
            if (alive) setState(next)
          } catch {}
        })()
        return () => { alive = false }
      }, [])
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

    return {
      inject: ['slots'],
      apply(ctx) {
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
      },
    }
  },
})
