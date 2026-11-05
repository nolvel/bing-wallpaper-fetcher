# Bing Wallpaper Fetcher

采集 Bing 每日壁纸的简体中文和美国英文版本，生成可供外部服务读取的 `data/latest.json`。仓库发布壁纸文案和图片 URL。

## 本地采集

使用 Node.js 24，无需安装依赖。在仓库根目录运行：

```bash
node scripts/fetch-wallpaper.mjs zh-CN
node scripts/fetch-wallpaper.mjs en-US
```

每次运行只更新指定市场。发布新记录前，脚本会完整下载三个尺寸的图片，检查 HTTP 状态为 200、Content-Type 为图片且内容非空，每次图片请求超时为 10 秒。任一图片验证失败、请求失败、返回的市场不符或文案缺失时，脚本以非零状态退出并保留已有数据。同一市场抓到相同的图片 ID 时，保留原记录和抓取时间。

Bing 的市场返回结果可能随网络出口而变化。部署前请在实际运行采集任务的机器上验证 `en-US` 能返回英文记录。

## 读取数据

将 `data/latest.json` 提交到公开仓库的 `main` 分支后，外部服务可通过 [GitHub Raw](https://raw.githubusercontent.com/nolvel/bing-wallpaper-fetcher/main/data/latest.json) 读取。首次采集后，`wallpapers` 可能只有一个市场。消费者应允许某个市场暂时缺失。

```json
{
  "schemaVersion": 1,
  "wallpapers": {
    "en-US": {
      "id": "OHR.AutumnChina_EN-US0467722422",
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
- `fetchedAt` 是该条记录首次采集成功时的 UTC 时间，采用 ISO 8601 格式。
- `previewUrl` 对应 640×360 预览，`fullHdUrl` 对应 1920×1080 背景，`uhdUrl` 用于高分屏。UHD 加载失败时可回退到 Full HD。
- `linkUrl` 取自 Bing 的 `BackstageUrl`，指向壁纸主题的搜索页面。相对路径会转成完整 URL，缺失或无效时返回 `null`。

## 自动采集

GitHub Actions 工作流 `Fetch daily wallpaper` 使用 GitHub 托管的 `ubuntu-latest` runner 和 Node.js 24。

| 市场 | 计划运行时间 |
| --- | --- |
| `zh-CN` | 北京时间每天 00:07 |
| `en-US` | 美国太平洋时间每天 00:12，对应北京时间夏令时 15:12、冬令时 16:12 |

定时任务从默认分支运行，实际触发时间可能因 GitHub Actions 排队而延迟。两个市场的任务串行执行，每次基于默认分支最新版本更新数据。采集和图片验证成功后，只在 `data/latest.json` 有变化时由 `github-actions[bot]` 提交并推送。采集失败会使任务失败，已有仓库数据保留。

首次发布时，将 workflow 推送到默认分支，然后在仓库的 **Actions → Fetch daily wallpaper → Run workflow** 中分别选择 `zh-CN` 和 `en-US` 手动运行一次，验证市场数据并生成完整 JSON。

工作流通过内置的 `GITHUB_TOKEN` 和 `contents: write` 权限提交。仓库或组织的 Actions 策略需要允许该权限，分支规则也需要允许工作流直接推送。公开仓库连续 60 天没有活动时，GitHub 可能禁用定时工作流，可在 Actions 页面重新启用。
