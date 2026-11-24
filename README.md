# dsh-aupdate

定时检查已装插件的 npm 新版本，串行安装、就地生效，不重启 DSH。带一个设置页：能改策略、看更新记录、把装坏的版本退回去。

## 安装

插件页 → 安装 → 填 GitHub 地址：

```
https://github.com/CalmSun/dsh-aupdate
```

装完重启 DSH（宿主半边需要新一世代才加载）。之后在插件页的 `dsh-aupdate` 一行里改设置。

本插件在安装队列里把自己排到最后，避免在更新自己的过程中把自己换掉。

## 行为

- 按 `scheduleMode` 定时跑一轮，启动后 `firstDelayMinutes` 分钟先跑一次（`checkOnStart`）
- 每轮遍历 profile `package.json` 的依赖，只查 `/-/package/<name>/dist-tags`，不拉整份 packument
- `@deepseek-ai/dsh-*` 读 `next` 标签，其余读 `latest`
- `link:` / `file:` / `workspace:` / `portal:` 安装的包一律跳过
- 安装走 profile 自己的 `dsh plugin add`，串行执行；本插件自己排在最后
- 装完回读磁盘上的版本，只有真的换了版本才算成功
- 安装成功后按需 HMR 就地生效；有子任务在跑时这一轮不换代码

## 调度方式

`scheduleMode` 选一种节奏，四种模式的参数互相独立，切换不丢值：

| 模式 | 参数 | 说明 |
|---|---|---|
| `minutes` | `intervalMinutes` | 每 N 分钟（默认，1440 即一天） |
| `hours` | `everyHours` | 每 N 小时，1 到 168 |
| `days` | `everyDays` | 每 N 天，1 到 30 |
| `daily` | `dailyAt` | 每天固定时刻，24 小时制 `HH:MM` |

定时器是「这一轮跑完再排下一次」，不是固定间隔触发：一轮检查可能跑几分钟，
固定间隔会让两次执行叠在一起。设成「每天 03:00」时，若 03:00 刚好在跑或已过，
就顺延到次日 03:00，不会留下 0 分钟的空转。

非法值不会写进去：`25:00`、`abc` 这类时刻会被拒绝、保留原来的值；
模式名不认识就退回 `minutes`。写坏的设置不该让定时检查悄悄停掉。

## 失败抑制

装失败的 `包名@版本` 会被记下来，`suppressHours`（默认 6 小时，0 表示不抑制）
之内不再重试同一个版本。键是「包名 + 版本」而不是包名：升到新版本仍会重新试一次，
那是新的事实。

没有这一条时，一个坏版本会让每一轮都去装一次、失败一次——日志刷满、pnpm 被占着，
而结果注定。设置页能直接看到当前在抑制中的条目和解除时间。成功装上后记录自动清掉。

## 更新策略

| 设置 | 默认 | 说明 |
|---|---|---|
| `exclude` | `[]` | 不更新的包；填了就一直不参与自动更新 |
| `allowMajor` | `true` | 关掉后只在同一主版本内升级 |
| `allowPrerelease` | `false` | 关掉后不装预发布；`next` 标签不受影响 |
| `idleOnly` | `true` | 忙的时候不动手（见下节） |
| `hotReload` | `true` | 装完就地生效，否则等重启 |
| `maxPerCycle` | `0` | 一轮最多装几个，0 表示不限 |
| `sessionIdleMinutes` | `2` | 会话静默多少分钟才算闲，0 表示只看子任务 |
| `notify` | `true` | 发现可更新版本时在右下角提醒，列出插件与版本 |

## 什么时候动手

「现在忙不忙」有两个独立信号，任一命中都跳过这一轮，下一轮再来：

- **有子任务在跑**：换代码会把它们一并中止，所以只要探到就等。
- **会话刚被写过**：`sessionIdleMinutes` 分钟内 `$DSH_HOME/sessions` 下有写入，
  说明正有人在用。装包会长时间占住 pnpm 并让界面变卡，不如等他停手。

光看 `agent.status` 不够——实测 turn 结束后 status 可能长时间停在 `running`。
真按它判，自动更新会永远不落地，而界面上看不出原因。所以第二条以会话文件的
mtime 为准：那是磁盘事实。会话目录整个读不到时返回「不知道」，此时**不拦**
更新——宁可照常跑，也不因为一个读不了的文件把更新永久停掉。

设置页把「最近一次会话写入在几分钟前」和当前锁的持有者直接显示出来，
不用翻日志猜为什么没更新。

## 更新记录与回滚

每次成功安装都会记一条：包名、从哪个版本、到哪个版本、时间。历史存在
`~/.dsh/aupdate-history.json`，设置页里能直接看到，并对最近一次更新点「回滚」
把旧版本装回去。回滚只针对本插件自己装上去的那一次。

记录栏固定高度、在自己的框里滚动：堆到上百条也只是这一栏变长，不会把整页顶到几屏
之外，按钮也不会被挤到看不见的地方。

同一个包的 `from → to` 完全相同、且都不是回滚记录时只留最新一条：
否则同一行失败记录会一轮一条堆满历史，真正要回的那个点反而找不到了。
`1.0 → 1.1` 和 `1.0 → 1.2` 是两件事，不会合并。

## 同时只装一个

`dsh-aupdate` 自己不会同时跑两轮，但管不住别人：另一个窗口、另一个进程里
手动 `dsh plugin add`、插件市场点安装，都会和定时轮次撞上，而 pnpm 的锁是
按 profile 目录算的，撞上就是 `EPERM`。

所以安装期间会在 profile 目录放一个 `.aupdate-install.lock`（进程号 + 时间），
拿不到就让开并说明「另一个进程正在装」。锁超过 30 分钟视为持有者已崩，
自动接管——否则一次崩溃会把更新永久堵死。回滚走同一把锁。

## 动手前留一份现场

真要安装时，先把 profile 的 `package.json`、`pnpm-lock.yaml`、
`pnpm-workspace.yaml`、`cordis.patch.yml` 复制到
`~/.dsh/aupdate-snapshots/<时间>/`，只留最近 3 份。

这里**故意不做自动还原**。把旧 manifest 盖回去再让 pnpm 重装，等于用一次
更长的高风险操作去修一次可能的失败，判错的代价比原问题还大。留底只是留证据，
要不要用它由人决定。这也保证它和下面「按包回滚」不重叠：那个是「我要旧版本」，
这个是「留个现场」。

## 工具

`plugin_updater`：一个动作入口，参数 `action`（`check` / `update` / `state` / `history`）。

## 设置页

插件页里的这一行有摘要和整页两种视图，保存后立刻按新节奏重排，不用重启。
同一份界面还挂在**设置 → 插件更新**里，是独立的一页，不用先去插件页翻这张卡。
读写走 `/api/dsh-aupdate/{state,run,rollback,logs}`。

### 勾选插件，而不是手写包名

`exclude` 原来要一行一个包名地敲。现在整页里是一张勾选清单，直接列出这个 profile
实际装着的插件和各自的已装版本：

- **不自动更新的包**：勾上的永远不参与自动更新
- 能按名字搜索，`/state` 里带着 `packages`（名字、版本、当前是否被排除）
- 「全选 / 清空」只作用于当前筛选出来的行——搜完再点全选，意思是把搜到的都勾上
- 这个 profile 里装着的插件都会列出来，列表本身就是「能勾什么」的全部答案

### 「上一次」不会再被重启清空

最近一轮的结果（时间、查了多少个、几个可更新、装成几个、失败原因）现在落在
`~/.dsh/aupdate-lastrun.json`，DSH 重启后照旧显示。以前它是纯内存的，重启一次就回到
「还没跑过」，看着像这一轮根本没跑过。读的时候逐字段校验，坏文件只会让这张卡缺席，
不会让插件加载失败。

整页最下面是**运行日志**卡片，直接看插件最近写了什么，不用再去翻文件。日志正文用中文写，
一行一件事（检查了多少个、装哪个、为什么跳过），状态词也翻成人话；

- 可选显示最近 100 / 200 / 500 / 1000 行，默认 200
- **最新的在最上面**：按时间倒序渲染，刚装了什么不用滚到底
- 时间只到「月-日 时:分:秒」并等宽对齐，省下的宽度留给正文
- 打开「自动刷新」后每 5 秒拉一次，正在排查时开着；关掉就完全不动
- 读之前会先把待写队列刷下去，所以刚点完检查，那几行马上就在里面
- 时间戳按本地时区显示，文件超过 1MB 轮转给一句提示，另附总行数

日志只经由 `GET /api/dsh-aupdate/logs?lines=N` 读，参数夹在 1 到 1000 之间，
不提供写入口——面板能看，但改不了日志。

四个接口都要先过宿主的连接准入（`connection.admit` / 旧宿主的
`requestRejection`），没通过就回 401/403，拿不到 `connection` 服务或它抛错时
一律 503。不用「只认回环地址」这种判据：浏览器里任何网页都能向 127.0.0.1 发请求。
`/state` 和 `/logs` 也照样要过，因为它们分别会吐全量设置和读磁盘上的日志文件。

## 更新提醒

发现可更新版本时，界面右下角浮一条提醒，列出插件名和「当前 → 新」版本；超过 8 条
时余下给一句「还有 N 个」，15 秒后自动消失。

同一批更新只提醒一次：这批更新的签名记在 `localStorage` 里，刷新页面不会重复弹。
关掉「发现更新时提醒我」就完全不弹，日志和设置页照常记录——提醒只是别让它装完你
还不知道，不是唯一的告知渠道。

提醒用的是原生 DOM 浮层，不是新的槽位：槽位只在宿主页挂载时才渲染，而提醒要能在
会话、插件页、设置页都出现。

## 效率

- 只取 dist-tags：24 个包从 2.88 MB 降到 655 B
- 已装版本按 `package.json` 的 mtime+size 缓存，不再每轮同步读 24 次盘
- dist-tags 带 10 分钟 TTL；批量之间让出事件循环，界面不掉帧
- 实测一轮 24 个包耗时 3.7 s（全部命中缓存、无需安装时）
- 会话空闲探测限深四层、逐层只 `readdir` 一次：实测本机 251 个会话文件扫一遍 36 ms
- `maxPerCycle` 给单次占用封顶：装包期间 pnpm 锁一直握着，一轮装 20 个能把
  profile 占住几十分钟；限个数之后剩下的下一轮接着装
- 历史与失败表都按 `mtime+size` 判新旧，不再「读到一次就永久缓存」——
  这两个文件在 `~/.dsh` 下跨 profile 共用，另一个进程刚写的记录必须马上能看见

## 日志

`~/.dsh/aupdate.log`，写完即刷，超过上限自动轮转。设置覆盖存于 `~/.dsh/aupdate-settings.json`。

这个文件可以在设置页里直接看，见上一节。路径可用 `DSH_AUTO_UPDATE_LOG` 改。

## English

Scheduled updater for the DSH plugins installed in a profile. It checks npm on an
interval, installs one package at a time, and applies the result without restarting
DSH. A settings page lets you change the policy, read the update history, roll
a bad version back, and watch the run log without leaving the page.

The full-page view ends with a **run log** card, so you never have to go open the
file: pick the last 100 / 200 / 500 / 1000 lines (200 by default), and turn on
auto-refresh to poll every 5 seconds while you are debugging. The pending write
queue is flushed before reading, so lines from the check you just triggered are
already there. Timestamps render in local time, rotation past 1 MB is called out,
and the total line count is shown.

All four routes go through the host's connection admission (`connection.admit`, or
`requestRejection` on older hosts) first: a rejection answers 401/403, and a missing
or throwing `connection` service answers 503. Checking only the loopback address is
not an admission decision — any web page in the browser can reach 127.0.0.1.
`/state` and `/logs` are gated too; they expose the whole settings object and read
the log file off disk.

The log is read through `GET /api/dsh-aupdate/logs?lines=N` only, with the count
clamped between 1 and 1000. There is no write path: the page can look, not edit.

### Install

Plugins page → Install → paste the repository URL:

```
https://github.com/CalmSun/dsh-aupdate
```

Restart DSH afterwards (the host half loads on the next generation). The plugin
installs itself last in the queue so it cannot swap itself out mid-update.

### Behaviour

- Runs a cycle according to `scheduleMode`, first after `firstDelayMinutes` when `checkOnStart` is on
- Reads only `/-/package/<name>/dist-tags` per dependency, never a full packument
- `@deepseek-ai/dsh-*` packages follow the `next` tag; everything else follows `latest`
- Packages installed via `link:` / `file:` / `workspace:` / `portal:` are skipped
- Installs go through the profile's own `dsh plugin add`, one at a time
- After each install the version is re-read from disk; a no-op is not reported as an update
- Successful installs are applied in place via HMR, deferred while subagents are running

### Schedule

`scheduleMode` picks one rhythm; each mode keeps its own value, so switching back
and forth never loses a setting.

| Mode | Setting | Meaning |
|---|---|---|
| `minutes` | `intervalMinutes` | Every N minutes (default, 1440 means daily) |
| `hours` | `everyHours` | Every N hours, 1 to 168 |
| `days` | `everyDays` | Every N days, 1 to 30 |
| `daily` | `dailyAt` | A fixed time each day, 24-hour `HH:MM` |

The timer is "schedule the next run after this one finishes", not a fixed tick: a
cycle can take minutes, and a fixed interval would overlap two of them. With a
`dailyAt` time that has already passed or is currently running, the next run goes
to the same clock time tomorrow instead of busy-looping on zero minutes.

Invalid values are never stored: a malformed time such as `25:00` or `abc` is
rejected and the previous value is kept, and an unknown mode falls back to
`minutes`. A typo should not silently stop the scheduler.

### Failure suppression

A `name@version` that failed to install is recorded and not retried for
`suppressHours` (default 6, 0 disables). The key includes the version, so a newer
release is still attempted — that is a new fact.

Without this, one broken version makes every cycle install it again and fail
again: the log fills up, pnpm stays busy, and the outcome is already decided. The
settings page shows which entries are currently suppressed and when they expire.
A successful install clears the record.

### Policy

| Setting | Default | Meaning |
|---|---|---|
| `exclude` | `[]` | Never update these; whatever is listed stays out of auto-updates |
| `allowMajor` | `true` | When off, stay within the same major version |
| `allowPrerelease` | `false` | When off, skip prereleases; the `next` tag is unaffected |
| `idleOnly` | `true` | Hold off while anything is busy (see below) |
| `hotReload` | `true` | Apply in place after install instead of waiting for a restart |
| `maxPerCycle` | `0` | Installs per cycle; 0 means no limit |
| `sessionIdleMinutes` | `2` | Session must be quiet this long to count as idle; 0 judges by subagents only |
| `notify` | `true` | Announce available updates in the bottom-right corner, with plugin names and versions |

### When it acts

Two independent signals mean "busy". Either one skips the cycle and the next one
tries again:

- **A subagent is running**: swapping code would abort it, so it waits.
- **A session was just written**: any write under `$DSH_HOME/sessions` within
  `sessionIdleMinutes` means someone is working. Installing holds the pnpm lock
  for a long time and makes the UI sluggish, so it waits for a pause.

`agent.status` alone is not enough — measured behaviour is that status can stay
`running` long after a turn ends. Judging by it, updates would never land and the
UI would show no reason why. So the second signal uses session file mtimes: those
are disk facts. If the session directory cannot be read at all the answer is
"unknown", and an unknown result **does not** hold the update back — running on
schedule is better than stopping forever because one file was unreadable.

The settings page shows how long ago the last session write was and who holds the
lock, so "why has it not updated" needs no log reading.

### One install at a time

`dsh-aupdate` never runs two cycles at once, but it cannot control anyone else: a
manual `dsh plugin add`, the plugin UI in another window, or a second host process
all collide with a cycle, and pnpm's lock is per profile directory — the collision
is an `EPERM`.

So an install takes a `.aupdate-install.lock` in the profile directory (pid plus
timestamp) and yields with a clear "another process is installing" message when it
cannot have it. A lock older than 30 minutes is treated as a crashed holder and
taken over — otherwise one crash would block updating forever. Rollback uses the
same lock.

### Snapshot before touching anything

Before installing, the profile's `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml` and `cordis.patch.yml` are copied to
`~/.dsh/aupdate-snapshots/<timestamp>/`, keeping the newest 3.

There is deliberately **no automatic restore**. Putting an old manifest back and
letting pnpm reinstall is a longer, riskier operation used to repair a possible
failure, and guessing wrong costs more than the original problem. The snapshot is
evidence; whether to use it is a human decision. It also keeps this feature
distinct from the per-package rollback below: that one is "I want the old
version", this one is "keep the scene".

### History and rollback

Every successful install is recorded with the package name, the previous version,
the new version, and a timestamp, in `~/.dsh/aupdate-history.json`. The settings
page lists them and can roll the most recent update back to its previous version.
A rollback applies once: the same downgrade cannot be replayed.

The list keeps a fixed height and scrolls inside its own box, so a hundred entries make
that one card longer instead of pushing the whole page down.

Repeated rows for the same package with an identical `from → to`, where neither is
a rollback, collapse into the newest one. Otherwise a single failing version would
pile up one row per cycle and bury the entry you actually want to return to.
`1.0 → 1.1` and `1.0 → 1.2` are different events and stay separate.

### Settings page

The row in the plugins page shows a summary and a full page; saving re-schedules
immediately without a restart. The same UI is also its own page under
**Settings → Plugin updates**, so it is not buried in the plugins page.

`exclude` is a checkbox list of the plugins actually installed in this profile, with
their installed versions, instead of a textarea you had to type package names into.
Search narrows the list; Select all / Clear only touch the rows currently shown, so
"search, then select all" means what you expect.

The last run's outcome (when, how many checked, how many updatable, how many installed,
why it failed) is persisted to `~/.dsh/aupdate-lastrun.json` and survives a restart. It
used to live in memory only, so every restart reset the card to "never run" and looked
like nothing had happened.

### Update notices

When a check finds updates, a notice appears in the bottom-right corner listing each
plugin and its current → new version; past eight it adds "and N more", and it closes
itself after 15 seconds. Each batch is announced once — the signature is kept in
`localStorage` — and turning "Tell me when updates are found" off silences it entirely
while the log and settings page keep recording.

### Tool

`plugin_updater` with an `action` argument: `check`, `update`, `state`, or `history`.

### Why it is cheap

- dist-tags only: 24 packages went from 2.88 MB to 655 B of traffic
- Installed versions are cached by `package.json` mtime and size, so a cycle does not re-read 24 files every run
- dist-tags carry a 10-minute TTL, and batches yield to the event loop
- Measured: 3.7 s for a 24-package cycle with everything cached and nothing to install
- The idle probe walks at most four levels with one `readdir` per level: 36 ms over 251 session files here
- `maxPerCycle` caps a single occupancy: pnpm holds its lock for the whole install, so 20 packages could keep a profile busy for tens of minutes; a cap lets the rest wait for the next cycle
- History and failure tables are both stamped by `mtime+size` instead of being cached forever — these files live in `~/.dsh` and are shared across profiles, so a record another process just wrote must be visible immediately

### Logs

`~/.dsh/aupdate.log`, flushed on write and rotated when it grows. Setting overrides
live in `~/.dsh/aupdate-settings.json`.

The page renders the log newest first, so whatever just happened is at the top of the
box instead of at the bottom of a scroll.

You can read this file straight from the settings page (see above). Point it
elsewhere with `DSH_AUTO_UPDATE_LOG`.

## License

MIT
