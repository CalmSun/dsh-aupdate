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
| `allow` | `[]` | 只更新这些包；留空表示全部 |
| `exclude` | `[]` | 不更新的包，优先级高于 `allow` |
| `allowMajor` | `true` | 关掉后只在同一主版本内升级 |
| `allowPrerelease` | `false` | 关掉后不装预发布；`next` 标签不受影响 |
| `idleOnly` | `true` | 忙的时候不动手（见下节） |
| `hotReload` | `true` | 装完就地生效，否则等重启 |
| `maxPerCycle` | `0` | 一轮最多装几个，0 表示不限 |
| `sessionIdleMinutes` | `2` | 会话静默多少分钟才算闲，0 表示只看子任务 |

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
读写走 `/api/dsh-aupdate/{state,run,rollback}`。

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

## English

Scheduled updater for the DSH plugins installed in a profile. It checks npm on an
interval, installs one package at a time, and applies the result without restarting
DSH. A settings page lets you change the policy, read the update history, and roll
a bad version back.

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
| `allow` | `[]` | Only update these packages; empty means all |
| `exclude` | `[]` | Never update these; takes priority over `allow` |
| `allowMajor` | `true` | When off, stay within the same major version |
| `allowPrerelease` | `false` | When off, skip prereleases; the `next` tag is unaffected |
| `idleOnly` | `true` | Hold off while anything is busy (see below) |
| `hotReload` | `true` | Apply in place after install instead of waiting for a restart |
| `maxPerCycle` | `0` | Installs per cycle; 0 means no limit |
| `sessionIdleMinutes` | `2` | Session must be quiet this long to count as idle; 0 judges by subagents only |

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

Repeated rows for the same package with an identical `from → to`, where neither is
a rollback, collapse into the newest one. Otherwise a single failing version would
pile up one row per cycle and bury the entry you actually want to return to.
`1.0 → 1.1` and `1.0 → 1.2` are different events and stay separate.

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

## License

MIT
