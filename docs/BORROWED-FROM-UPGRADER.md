# 从 dsh-plugin-upgrader 学什么（差距清单）

对照对象：[zuwenyin/dsh-plugin-upgrader](https://github.com/zuwenyin/dsh-plugin-upgrader) 1.10.0（MIT，npm 上有 provenance 证明）。
它和 dsh-aupdate 是同类：都在插件页补「一键升级」。区别是它手动触发、把精力放在**版本可见性和安装前后的边界**上，
aupdate 自动跑、把精力放在**调度和让开**上。

这份清单是 0.7.5 的施工依据：只有能落在 aupdate 现有架构里的项才做，做了的写明代价，没做的写明为什么。

## 可借鉴项

| 能力 | 它怎么做 | aupdate 0.7.5 | 代价 / 边界 |
| --- | --- | --- | --- |
| **按版本比 DSH 兼容性** | 装之前先查该版本 manifest 的 `engines.dsh`（没有才看 `@deepseek-ai/dsh(-*)` 的 peer），和宿主版本比 | ✅ 已实现（`compatOf`），不满足的版本不进安装队列 | 每个**候选**版本多一次几 KB 的 manifest 请求；只在「已经决定要升」时发生，不是每包每轮 |
| **DSH 版本从哪来** | 从 `process.argv` 的入口往上找 `@deepseek-ai/dsh-app-boot/package.json` | ✅ 已实现（`dshVersion`） | 读不到就返回 null 并**不拦**：宁可漏拦，也不按猜的版本误拦 |
| **安装源切换** | 顶部「注册表」对话框：自带源 / pluginManager 源 / 自建源，可测速 | ✅ 已实现（`registryMode` + `registryUrl`），三种预设 + 自定义 | 只用 `npm_config_registry` 传给子进程，**不写** `.npmrc`、不改 pnpm 配置；没选源时一个字节都不动 |
| **镜像落后单独标出** | 官方源已发布、镜像没同步时单独标一行 | ✅ 已实现（`mirrorLagOf`），写进 `lastRun.lagged`，界面按名字列出 | 只有用镜像时对每个包多一次官方源 dist-tags 请求；用官方源时零额外请求 |
| **重启指引** | 读宿主 pid 与启动方式，给出能完成重启的那一条命令 | ❌ 没做 | aupdate 的默认路径是热生效（hmr），需要重启时已经有「重启后生效」这句；再做一套 pid 追踪属于另一个功能面 |
| **插件页「版本」标签** | 顶栏多一个标签，展开插件看全部已发布版本，点一下切过去 | ✅ 已实现「版本管理」标签页（`plugins.tab`），复用同一条安装/预检/历史路径 | 按包按需拉缩略 packument；一次一个包，不进首屏 |
| **多选卸载** | 走宿主 `removeBundle`，先列清单再确认 | ❌ 没做 | 卸载是不可逆动作，和 aupdate「只负责升」的边界冲突；dsh 自带已安装页已经能卸 |
| **收紧 pnpm 重试等待** | 往 `pnpm-workspace.yaml` 追加 `fetchTimeout/fetchRetries/...` | ❌ 没做 | 它会改 profile 的共享配置文件，影响该 profile 里**所有** pnpm；这种横切改动该由用户决定，不该由自动更新插件在后台悄悄做 |
| **「需处理」可归零计数** | 只数用户能自己修的问题 | ⚠️ 部分：`lagged` / `blocked` 单独列 | 完整版的四项里，「构建待批准」aupdate 根本没有这条路径 |
| **一键复制诊断** | 纯客户端把版本、源、每行问题拼成 markdown | ❌ 没做 | 低价值；`/state` 已经把 `dshVersion`、`registry`、`lagged`、`blocked` 都吐出来了 |
| **按版本列表回滚** | 展开插件看全部已发布版本 | ❌ 没做 | 要读整份 packument（最大单包 26 MB）；aupdate 滚回的是**自己装过**的版本，记录在本地，不需要联网 |

## 刻意不照搬的

- **整份 packument 换版本列表**：它为了版本历史和兼容性标记读 packument，aupdate 一直只用 `dist-tags` 那个几百字节的端点（24 个包 2.88 MB → 655 B）。按包按需读单个版本 manifest 是更便宜的等价做法。
- **in-place 替换（先摘 manifest 再装）**：它靠临时改 profile 的 `package.json` 做到「不卸载换版本」，配了 journal 和写入锁。aupdate 走 `dsh plugin add pkg@version`，这条命令本身就会换版本；再自己动 manifest 等于和 plugin-manager 抢同一份文件，风险大于收益。
- **自动写 pnpm 配置**：见上表。

## 0.7.5 的验收点

1. 没选安装源时：`/state.registry === ''`，dist-tags 仍走官方源，安装命令环境变量不变。
2. 选镜像时：`lastRun.lagged` 能列出「镜像 x.y.z、官方 a.b.c」。
3. 目标版本要求 `DSH >=0.3.0` 而宿主是 0.2.x：该版本不进 `updates`，`lastRun.blocked` 有它，日志一行 `compatBlocked`。
4. 服务器读不到 DSH 版本：`/state.dshVersion === null`，兼容性预检不拦任何包（回到改造前行为）。
