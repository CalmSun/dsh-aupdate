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

- 按 `intervalMinutes` 定时跑一轮，启动后 `firstDelayMinutes` 分钟先跑一次（`checkOnStart`）
- 每轮遍历 profile `package.json` 的依赖，只查 `/-/package/<name>/dist-tags`，不拉整份 packument
- `@deepseek-ai/dsh-*` 读 `next` 标签，其余读 `latest`
- `link:` / `file:` / `workspace:` / `portal:` 安装的包一律跳过
- 安装走 profile 自己的 `dsh plugin add`，串行执行；本插件自己排在最后
- 装完回读磁盘上的版本，只有真的换了版本才算成功
- 安装成功后按需 HMR 就地生效；有子任务在跑时这一轮不换代码

## 更新策略

| 设置 | 默认 | 说明 |
|---|---|---|
| `allow` | `[]` | 只更新这些包；留空表示全部 |
| `exclude` | `[]` | 不更新的包，优先级高于 `allow` |
| `allowMajor` | `true` | 关掉后只在同一主版本内升级 |
| `allowPrerelease` | `false` | 关掉后不装预发布；`next` 标签不受影响 |
| `idleOnly` | `true` | 有子任务在跑时不动代码 |
| `hotReload` | `true` | 装完就地生效，否则等重启 |

## 更新记录与回滚

每次成功安装都会记一条：包名、从哪个版本、到哪个版本、时间。历史存在
`~/.dsh/aupdate-history.json`，设置页里能直接看到，并对最近一次更新点「回滚」
把旧版本装回去。回滚只针对本插件自己装上去的那一次。

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

## 日志

`~/.dsh/aupdate.log`，写完即刷，超过上限自动轮转。设置覆盖存于 `~/.dsh/aupdate-settings.json`。

## 许可

MIT
