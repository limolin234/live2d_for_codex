# Codex Live2D

给 Codex 用的本地 Live2D 状态侧边车。

Codex 正常工作时，项目级 hooks 会把状态事件写入本地队列；bridge 进程读取这些事件，把它们转换成展示状态，再推给浏览器 Live2D viewer 或 Windows 上的 Live2DViewerEX。

```text
Codex hooks
  -> .codex-live2d/events.jsonl
  -> bridge
  -> browser Live2D viewer / Live2DViewerEX
```

## 功能

- 项目级 Codex hook 配置：`.codex/`
- 本地 bridge：`scripts/codex-live2d.mjs bridge`
- 浏览器 Live2D viewer：Vite + Pixi + `pixi-live2d-display`
- 内置 Mao 示例模型：`public/models/sample/Mao/`
- 可选接入 Windows Live2DViewerEX ExAPI
- 可选接入 OpenAI-compatible 小模型，用来润色气泡文案

## 安装

```bash
npm install
```

项目使用 `pixi-live2d-display@0.4.x`，它依赖 Pixi v6。不要直接升级到 Pixi v7，除非同步改 Live2D 集成代码。

Cubism 3/4 模型需要本地运行时：

```text
public/live2d-core/live2dcubismcore.min.js
```

这个文件被 git 忽略，需要你在本地自行放置。

## 快速启动

启动 bridge 和浏览器 viewer：

```bash
npm run app
```

使用 Chrome/Chromium app 模式打开窗口：

```bash
npm run window
```

分开启动，便于调试：

```bash
npm run dev:bridge
npm run dev:viewer -- --port 5173
```

手动打开示例模型：

```text
http://127.0.0.1:5173/?model=/models/sample/Mao/Mao.model3.json
```

## 接入 Windows Live2DViewerEX

Live2DViewerEX 通过 ExAPI 暴露 WebSocket。默认地址通常是：

```text
ws://127.0.0.1:10086/api
```

如果端口被占用，Live2DViewerEX 会顺延到后续端口。先在 Windows 侧确认 Live2DViewerEX 已开启 ExAPI，然后在 WSL 中探测：

```bash
node -e "const net=require('net'); for (const port of [10086,10087,10088,10089,10090]) { const s=net.connect({host:'127.0.0.1',port,timeout:800},()=>{console.log('open',port); s.destroy();}); s.on('timeout',()=>s.destroy()); s.on('error',()=>{}); } setTimeout(()=>{},1200);"
```

如果显示 `open 10086`，启动 relay：

```bash
LIVE2D_VIEWEREX_ENABLED=1 \
LIVE2D_VIEWEREX_WS=ws://127.0.0.1:10086/api \
npm run dev:bridge
```

如果 WSL 无法通过 `127.0.0.1` 连到 Windows，改用 Windows 宿主机地址：

```bash
WIN_HOST=$(awk '/nameserver/ {print $2; exit}' /etc/resolv.conf)

LIVE2D_VIEWEREX_ENABLED=1 \
LIVE2D_VIEWEREX_WS="ws://$WIN_HOST:10086/api" \
npm run dev:bridge
```

常用 relay 配置：

```text
LIVE2D_VIEWEREX_WS=ws://127.0.0.1:10086/api
LIVE2D_VIEWEREX_MODEL_ID=0
LIVE2D_VIEWEREX_BUBBLE_MS=3500
LIVE2D_VIEWEREX_BUBBLE_FRAME=0x000000
LIVE2D_VIEWEREX_BUBBLE_TEXT=0xFFFFFF
```

## 接入 Yunwu 小模型

小模型只用于展示层：根据粗粒度状态润色表情、动作和气泡文案。它不会把内容反馈给 Codex。

WSL 环境中设置 API key：

```bash
export YUNWU_API_KEY='你的 API key'
```

启动带 Live2DViewerEX relay 和 Yunwu 小模型的 bridge：

```bash
LIVE2D_VIEWEREX_ENABLED=1 \
LIVE2D_VIEWEREX_WS=ws://127.0.0.1:10086/api \
LIVE2D_LLM_ENABLED=1 \
LIVE2D_LLM_BASE_URL=https://yunwu.ai/v1 \
LIVE2D_LLM_MODEL=deepseek-v4-flash \
npm run dev:bridge
```

也可以使用通用变量：

```bash
LIVE2D_LLM_API_KEY='你的 API key'
```

当 `LIVE2D_LLM_API_KEY` 未设置时，bridge 会自动读取 `YUNWU_API_KEY`。

小模型只会收到类似下面的粗粒度状态：

```json
{
  "state": "running",
  "eventType": "PreToolUse",
  "tool": "bash",
  "currentBubble": "正在执行命令。"
}
```

超时、请求失败或返回格式不正确时，会自动回退到内置状态映射。

## Codex Hook

本仓库已经包含项目级 hook 配置：

```text
.codex/config.toml
.codex/hooks.json
```

hook 会调用统一入口，例如：

```bash
node $(git rev-parse --show-toplevel)/scripts/codex-live2d.mjs hook PreToolUse
```

事件会写入：

```text
.codex-live2d/events.jsonl
```

bridge 会轮询这个队列。这样即使 Codex 沙箱不能直接访问本地端口，状态事件也不会丢。

## 状态映射

```text
SessionStart       -> idle
UserPromptSubmit   -> listening
PreToolUse read    -> reading
PreToolUse edit    -> coding
PreToolUse shell   -> running
PermissionRequest  -> asking
PostToolUse ok     -> succeeded
PostToolUse failed -> failed
Stop               -> idle
```

Mao 示例模型的默认映射：

```text
idle       -> exp_01 + Idle[0]
listening  -> exp_02 + TapBody[0]
reading    -> exp_03 + Idle[1]
coding     -> exp_04 + TapBody[1]
running    -> exp_04 + TapBody[2]
asking     -> exp_06 + TapBody[3]
succeeded  -> exp_08 + TapBody[4]
failed     -> exp_07 + TapBody[5]
```

## 测试

发送一组模拟 Codex 事件：

```bash
npm run hook:test
```

检查 bridge 当前状态：

```bash
curl --noproxy '*' -s http://127.0.0.1:47771/state
```

手动发送单个 hook 事件：

```bash
printf '%s' '{"type":"PreToolUse","tool_name":"bash","command":"npm test"}' \
  | node scripts/codex-live2d-hook.mjs
```

构建检查：

```bash
npm run build
```

## 本地模型资源

把自己的 Live2D 模型放在：

```text
public/models/plana-local/
```

如果是 Cubism 模型，推荐路径：

```text
public/models/plana-local/plana.model3.json
```

打开：

```text
http://127.0.0.1:5173/?model=/models/plana-local/plana.model3.json
```

如果没有 Live2D 模型，也可以放一张本地静态图作为 fallback：

```text
public/models/plana-local/plana.png
```

打开：

```text
http://127.0.0.1:5173/?image=/models/plana-local/plana.png
```

不要把受版权保护的模型、图片或游戏资源提交到仓库。

## 敏感信息

不要把真实 API key 写进 README、脚本或 `.env` 后提交。

推荐把 key 放在 WSL shell 环境里：

```bash
export YUNWU_API_KEY='你的 API key'
```

如果你写入了本地 shell 配置，例如 `~/.bashrc` 或 `~/.zshrc`，确认这些文件不属于本仓库。

## 故障排查

页面是灰色：

```bash
curl -I http://127.0.0.1:5173/models/sample/Mao/Mao.model3.json
curl -I http://127.0.0.1:5173/live2d-core/live2dcubismcore.min.js
npm ls pixi.js
```

状态不变化：

```bash
ls -la .codex-live2d
curl --noproxy '*' -s http://127.0.0.1:47771/health
```

端口被占用：

```bash
ss -ltnp 'sport = :47771'
ss -ltnp 'sport = :5173'
```

Live2DViewerEX 没有气泡：

1. 确认 ExAPI 已开启。
2. 确认 WSL 能探测到 `10086` 或后续端口。
3. 确认 Windows 防火墙允许 Live2DViewerEX。
4. 如果只能 Windows 本机访问，尝试使用 `$WIN_HOST` 或 Windows 端口转发。

小模型没有生效：

1. 确认 `LIVE2D_LLM_ENABLED=1`。
2. 确认 `YUNWU_API_KEY` 或 `LIVE2D_LLM_API_KEY` 已在启动 bridge 的 shell 中设置。
3. 确认 `LIVE2D_LLM_BASE_URL=https://yunwu.ai/v1`。
4. 网络或模型失败时会自动回退到内置气泡，不会中断 bridge。
