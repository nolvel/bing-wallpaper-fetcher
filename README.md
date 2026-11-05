# Bing Wallpaper Fetcher

采集 Bing 每日壁纸的简体中文和美国英文版本，生成可供外部服务读取的 `data/latest.json`。仓库发布壁纸文案和图片 URL。

## 本地采集

使用 Node.js 24，无需安装依赖。在仓库根目录运行：

```bash
node scripts/fetch-wallpaper.mjs zh-CN
node scripts/fetch-wallpaper.mjs en-US
```

脚本通过 Bing 的 `/hp/api/model` 获取元数据，每次运行只更新指定市场。发布新记录前，脚本会完整下载三个尺寸的图片，检查 HTTP 状态为 200、Content-Type 为图片且内容非空，每次图片请求超时为 10 秒。任一图片验证失败、请求失败、返回的市场不符或文案缺失时，脚本以非零状态退出并保留已有数据。同一市场抓到相同的图片 ID 时，保留原记录和抓取时间。

添加 `--force` 可强制重新采集指定市场，即使图片 ID 相同也会重新验证三个图片地址并替换整条记录，刷新 `fetchedAt`。验证失败时保留已有数据。

```bash
node scripts/fetch-wallpaper.mjs zh-CN --force
node scripts/fetch-wallpaper.mjs en-US --force
```

Bing 的市场返回结果可能随网络出口而变化。部署前请在实际运行采集任务的机器上验证 `en-US` 能返回英文记录。

## 读取数据

将 `data/latest.json` 提交到公开仓库的 `main` 分支后，外部服务可通过 [GitHub Raw](https://raw.githubusercontent.com/nolvel/bing-wallpaper-fetcher/main/data/latest.json) 读取。首次采集后，`wallpapers` 可能只有一个市场。消费者应允许某个市场暂时缺失。

```json
{
  "schemaVersion": 1,
  "wallpapers": {
    "en-US": {
      "id": "OHR.AutumnChina_EN-US0467722422",
      "publishedAt": "2026-11-04T08:00:00.000Z",
      "fetchedAt": "2026-11-05T04:33:39.483Z",
      "title": "Paddling a painted forest",
      "description": "People rowing among colorful bald cypress, Xuancheng, Anhui, China",
      "copyright": "© Jackal Pan/Getty Images",
      "source": "Bing",
      "previewUrl": "https://www.bing.com/th?id=OHR.AutumnChina_EN-US0467722422_640x360.jpg",
      "fullHdUrl": "https://www.bing.com/th?id=OHR.AutumnChina_EN-US0467722422_1920x1080.jpg",
      "uhdUrl": "https://www.bing.com/th?id=OHR.AutumnChina_EN-US0467722422_UHD.jpg",
      "linkUrl": null
    }
  }
}
```

- `id` 是图片标识，可用于判断壁纸是否更新。
- `publishedAt` 表示约定的市场展示日期零点。将 `Ssd` 按 `zh-CN` 的 `Asia/Shanghai` 或 `en-US` 的 `America/Los_Angeles` 当地零点转换为 UTC，自动处理美国夏令时；该值不表示实际发布延迟。
- `fetchedAt` 是该条记录最近一次成功采集并写入时的 UTC 时间，采用 ISO 8601 格式。
- `previewUrl` 对应 640×360 预览，`fullHdUrl` 对应 1920×1080 背景，`uhdUrl` 用于高分屏。UHD 加载失败时可回退到 Full HD。
- `linkUrl` 取自 Bing 的 `BackstageUrl`，指向壁纸主题的搜索页面。相对路径会转成完整 URL，缺失或无效时返回 `null`。

## 自动采集

GitHub Actions 工作流 `Fetch daily wallpaper` 使用 GitHub 托管的 `ubuntu-latest` runner 和 Node.js 24。

| 市场 | 计划运行时间 |
| --- | --- |
| `zh-CN` | 北京时间每天 00:05 |
| `en-US` | 美国太平洋时间每天 00:06，对应北京时间夏令时 15:06、冬令时 16:06 |

定时任务从默认分支运行，实际触发时间可能因 GitHub Actions 排队而延迟。两个市场的任务串行执行，每次基于默认分支最新版本更新数据。采集和图片验证成功后，只在 `data/latest.json` 有变化时由 `github-actions[bot]` 提交并推送。采集失败会使任务失败，已有仓库数据保留。

首次发布时，先完成下方 GitHub Actions 推送环境配置，再将 workflow 推送到默认分支。在仓库的 **Actions → Fetch daily wallpaper → Run workflow** 中选择 `target_environment`，并分别选择 `zh-CN` 和 `en-US` 手动运行一次，验证市场数据并生成完整 JSON，同时向所选环境推送。手动运行时可勾选 `force`，强制重新验证并更新所选市场的记录；定时运行默认按图片 ID 去重。

工作流通过内置的 `GITHUB_TOKEN` 和 `contents: write` 权限提交。仓库或组织的 Actions 策略需要允许该权限，分支规则也需要允许工作流直接推送。公开仓库连续 60 天没有活动时，GitHub 可能禁用定时工作流，可在 Actions 页面重新启用。

## GitHub Actions 推送环境

在仓库 **Settings → Environments** 中创建 `test`（测试）和 `production`（生产）。在每个环境的 **Environment secrets** 中分别配置：

| Secret | 内容 |
| --- | --- |
| `WALLPAPER_PUSH_URL` | 对应环境的完整 HTTPS 接口地址 |
| `WALLPAPER_APP_ID` | 对应环境的 appid |
| `WALLPAPER_APP_SECRET` | 对应环境的 secret |

在每个环境的 **Environment variables** 中添加 `SCHEDULE_PUSH_ENABLED`，只有值为 `true` 时才启用该环境的定时推送；设为 `false` 或不配置均为关闭。开关修改不需要改动 YAML，也不影响另一个环境。

- 定时运行：采集并提交成功后，分别检查 `test` 和 `production` 的开关，只向已启用的环境推送。
- 手动运行：`target_environment` 可选 `test` 或 `production`，默认 `test`。采集成功后只向所选环境推送，不受定时开关影响。
- 两个环境都关闭定时推送时，仍按计划采集并更新仓库数据。

采集 job 成功后，通过 matrix 创建各环境的独立推送 job。各 job 使用对应环境的 Secrets，并检出采集 job 输出的准确 commit，保证同一次运行使用相同数据。数据没有变化时仍按上述规则推送。任一环境推送失败不会取消另一个环境的任务，但会使整次 workflow 显示失败。

定时开关在推送 job 启动后的步骤中读取；关闭时该 job 仍会出现，跳过检出、Node.js 设置和实际推送。环境配置的审批和分支限制仍然生效。整个 workflow 保持串行执行，避免同一环境交错推送新旧数据。

## 本地推送到测试环境

将示例配置复制为本地配置，并填写测试环境分配的 appid 和 secret：

```bash
cp .env.example .env.test
```

在 `.env.test` 中将 `WALLPAPER_PUSH_URL` 填为接收端提供的完整 HTTPS 地址。appid 和 secret 分别填入 `WALLPAPER_APP_ID`、`WALLPAPER_APP_SECRET`。已有同名环境变量会优先于 `--env-file` 的值，运行前请确认当前终端中的配置。

在仓库根目录先检查配置和 JSON，再实际推送：

```bash
node --env-file=.env.test scripts/push-wallpaper.mjs --dry-run
node --env-file=.env.test scripts/push-wallpaper.mjs
```

推送脚本读取整份 `data/latest.json`，按接口约定生成秒级时间戳和小写 MD5 签名，发送 `appid`、`timestamp`、`sign`、`data`。签名时保持中文原文，并按 PHP JSON 编码规则转义斜杠和 Unicode 行分隔符。`--dry-run` 仅执行配置和数据读取检查，不发送 HTTP 请求；实际推送成功以响应 `status: 1` 为准。脚本失败时以非零状态退出。

本地环境文件由 `.gitignore` 忽略，`.env.example` 可提交。GitHub Actions 通过 Secrets 注入 `WALLPAPER_PUSH_URL`、`WALLPAPER_APP_ID` 和 `WALLPAPER_APP_SECRET`，使用对应环境的配置运行推送脚本。

推送采用完整数据对象。每次推送都包含本地文件中已有的全部市场记录。接收端不比较图片 ID 或发布时间；同一环境的推送应串行执行，使用最新的完整数据文件。

推送最多尝试 3 次，重试间隔依次为 2 秒、5 秒。网络错误、超时、HTTP 429 和 5xx 会重试，每次请求重新生成时间戳和签名；其他 HTTP 错误和业务鉴权失败直接退出。
