# dsh-synapse

[English](README.md) | 中文

![version](https://img.shields.io/badge/version-0.3.4-3478f6?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)
![platform](https://img.shields.io/badge/platform-web-7c3aed?style=flat-square)
![node](https://img.shields.io/badge/node-%3E%3D22.19-334155?style=flat-square)

> **Fork 说明**：本仓库是 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse)（MIT，上游 v0.3.0）的维护分支。相对上游的变更：
> - `client.js` 声明了加载器传入的 `require` 参数（`factory: (require) => ...`），使客户端模块能在 dsh 0.1.0-rc.6 的模块加载器上启动（否则报 `ReferenceError: require is not defined`）。
> - 移除了悬浮气泡视图切换器（`.dsh-synapse-switch`）及其旧版覆盖层入口。会话地图画布注册为原生会话视图标签页（`conversation.view` slot，id `synapse`，order 15）——出现在主标签栏中，与对话/轨迹/记忆并列。

把同一工作区里的会话、追问与分支变成一张可浏览、可拖拽、可放大的对话地图，同时保留 DSH 原生的对话能力。

![Synapse workspace canvas](docs/images/synapse-ui.png)

## 简介

`dsh-synapse` 是一个独立的 DeepSeek Harness Web 插件。它不替代 DSH 的模型、工具、会话或权限逻辑，而是在原生对话界面上增加一个可视化工作台，将同一工作区内的会话、追问和分支呈现为可浏览的对话地图。

复杂任务往往不是一条直线：你需要保留某个方案、回到第二轮问题尝试另一条路径，或在多个会话之间快速定位上下文。Synapse 让这些关系留在同一张画布上，同时继续使用 DSH 原有的会话能力。

## 功能特性

| | 功能 | 说明 |
|---|---|---|
| 🗺️ | 会话地图 | 在 DSH 原生对话与可视化画布之间切换 |
| 🌿 | 分支可见 | 通过 DSH 原生 session fork 创建分支，并按真实分叉点连接节点 |
| 📁 | 工作区映射 | 读取 DSH 工作区与目录归属，便于在正确的项目上下文中创建会话 |
| 📥 | 持续投影 | 用户消息和助手回复投影到对应卡片；流式回复在详情中持续更新 |
| 🔧 | 工具过程折叠 | 工具调用与结果按 `callId` 配对，折叠进对应助手回复卡，不再单独成卡 |
| ⚡ | 会话同步 | 原生对话与会话地图双向同步当前会话——任一侧切换，另一侧跟随高亮 |
| 🎨 | 画布交互 | 拖动画布、缩放视图（最高 4×）、移动卡片（位置自动保存）、一键定位当前会话，卡片内平滑滚动 |
| 🔒 | 原生会话不变 | 打开、追问、创建和归档仍由 DSH 会话系统完成；Synapse 只提供另一种查看与组织方式 |

![Native dialogue and Synapse toggle](docs/images/native-webui.png)

## 快速开始

```powershell
corepack pnpm dsh plugin --profile web add github:liangmianya/dsh-synapse
corepack pnpm dsh web
```

打开 `http://127.0.0.1:3080/`，点击顶部"会话地图"即可进入。

## 安装

前提：已安装支持 `dsh plugin` profile 插件机制的 DeepSeek Harness（2026-08 及之后版本），且 Node.js 版本不低于 `22.19`。

> [!NOTE]
> 本插件**仅支持 `web` profile**：它的 patch 只向 Web 组合插入自身，复用 DSH 现有 Web 服务，不启动第二个应用进程。

### 从 GitHub 安装

```powershell
corepack pnpm dsh plugin --profile web add github:liangmianya/dsh-synapse
```

GitHub 安装会执行本项目的 `prepare` 脚本（`node --check` 语法校验）。

> [!IMPORTANT]
> pnpm ≥10 默认阻止 git 依赖的构建脚本。若安装被拦截，请把 **pnpm 打印的确切键**（包名加其拉取的 tarball 地址，内含 commit，**不是裸包名**）复制进 DSH profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  "dsh-synapse@https://codeload.github.com/liangmianya/dsh-synapse/tar.gz/<commit>": true
```

然后重新执行安装命令。在 pnpm 10.x 上裸包名匹配不到 git 依赖；上游推送新 commit 后该键会变化，届时复制 pnpm 新打印的键即可。

### 本地开发安装

```powershell
corepack pnpm dsh plugin --profile web add link:E:\path\to\dsh-synapse
```

`link:` 形式会直接链接你的本地 checkout，改代码即时生效。

### 启动

```powershell
corepack pnpm dsh web                # 默认 http://127.0.0.1:3080
corepack pnpm dsh web --port 0       # 3080 被占用时，自动分配空闲端口
```

## 卸载

```powershell
corepack pnpm dsh plugin --profile web remove dsh-synapse
```

> [!NOTE]
> `remove` 只移除插件依赖与 profile 激活层，**不会删除画布数据**（`$DSH_HOME\synapse\workspaces.json`）。重装后旧数据会自动迁移恢复。
>
> 彻底清理：手动删除 `$DSH_HOME\synapse\` 目录；`pnpm-workspace.yaml` 中残留的 allowBuilds 键无害，可一并删掉。

## 配置

插件通过 profile 的 `cordis.patch.yml` 注入，以下键可在你自己的 patch 中按行 id `synapse` 覆盖（整体替换 `config`）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `dataFile` | `$DSH_HOME/synapse/workspaces.json` | 画布元数据持久化路径 |
| `autoProjection` | `true` | 是否自动把已提交的 DSH 会话事件投影为画布卡片 |
| `projectionWorkspaceTitle` | `DSH 任务` | 投影工作区的标题 |
| `trustedHosts` | `[]` | 额外放行的 Host（主机名或 主机:端口）；`localhost` 与 `127.0.0.1` 始终放行。局域网访问需在此加入你的主机 |

```yaml
# 在 profile 的 cordis.patch.yml 中覆盖（需重述全部键）
- id: synapse
  config:
    dataFile: !!js dshHomePath('synapse/my-workspaces.json')
    autoProjection: true
    projectionWorkspaceTitle: 我的任务
```

## 使用方式

1. 在 DSH 中选择工作目录，或打开一个已有会话。
2. 点击顶部"会话地图"进入画布。
3. 浏览画布卡片：点击卡片或侧边栏会话即可切换当前会话（原生页同步跟随）；"分支"操作保留一条替代路径。
4. 点击卡片底部"详情"查看完整对话记录；点击顶部"对话"切换或卡片"在 DSH 中打开"，回到原生对话。

## 数据与边界

- 画布元数据保存在 DSH Home 的 `synapse/workspaces.json`（当前 schema v4，自动迁移旧版数据）。
- 会话内容仍由 DSH session log 保存和管理。
- 本插件不启动第二个 Web 服务、不创建第二套 Agent，也不改变 DSH 的模型或工具执行行为。

## 模型影响

无直接模型影响：插件只读取**已提交**的会话事件并渲染成画布，不向任何模型请求添加系统提示、工具 schema 或请求上下文，也不影响 KV 缓存复用。

### KV 缓存影响

不会使缓存失效。插件从不更改请求头、系统提示或工具注册表，因此已可复用的 KV 前缀保持可复用；画布投影只在会话事件提交之后消费 session log。

## 已知限制与后续

- 仅支持 `web` profile。
- 画布元数据与会话日志分离：删除 `workspaces.json` 会丢失画布布局与分支锚点，但不会丢失会话。
- 两个 `dsh web` 实例共享同一 profile 时会写同一个 `workspaces.json`：运行时已加跨进程写锁与外部修改警告，但最后写入覆盖的风险仍在——请只运行单个实例。
- 旧版（v3）数据迁移时工具卡片按**顺序**配对（每条调用配下一条结果）；实时事件按 `callId` 配对。

## 开发

```powershell
corepack pnpm install
corepack pnpm run build
corepack pnpm test
corepack pnpm pack
```

`npm pack --dry-run --json` 可用于在发布前检查将要打包的文件。

## 许可证

[MIT](LICENSE)