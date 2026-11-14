# LingMatch

LingMatch 是一个离线优先的中英单词配对应用。词库、游戏设置、主题偏好和练习记录都保存在当前浏览器的 IndexedDB 中；文件只在本机解析，不需要账号、后端或云端 API。

## 本地运行

需要 Node.js 22.12 或更新的 22.x 版本，以及 npm。依赖安装在项目的 `node_modules` 中；如需把 npm 下载缓存也留在项目目录，可使用：

```powershell
npm ci --cache .npm-cache --no-audit --no-fund
npm run dev
```

开发服务器启动后，打开终端显示的本地地址即可使用。生产构建与预览：

```powershell
npm run build
npm run preview
```

`npm run build` 会生成 `dist/` 静态站点和 Service Worker。应用没有后端，发布时只需把静态构建目录放到支持 HTTPS 的静态站点。

## 使用

1. 进入「导入词库」，选择 CSV、XLSX、XLS、JSON、TXT 或文本型 PDF。
2. 检查解析预览，确认工作表、表头和英文/中文列；修正或删除不完整词条，决定是否保留重复项。
3. 保存为新词库，或从词库详情替换现有词条。
4. 选择词库并开始配对。每轮可选 4、6、8、10 或 12 组；可用词条不足时会使用全部可用词条。

设置支持计时器、音效、设备震动和浅色/深色主题。练习记录按词库保留最近 100 轮。

## PWA 安装与离线使用

首次联网访问时，Service Worker 会缓存应用页面、样式、脚本、图标以及 XLSX、PDF.js 和 PDF Worker 资源。等待页面加载完成后，即可断网打开已安装的应用；本地词库仍可查看、导入文件和复习。

在 Android 上，将构建结果部署到 HTTPS 静态站点，用 Chrome 打开并选择「安装应用」或「添加到主屏幕」。安装图标包含 192×192、512×512 和适配裁切用的 maskable 512×512 版本。桌面 Chrome/Edge 也可从地址栏安装。

### 发布到 GitHub Pages

仓库配置了 GitHub Actions 自动发布。将项目推送到 `main` 后，工作流会运行测试、构建并发布 `dist/`；首次发布前，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。项目页地址为 `https://<GitHub用户名>.github.io/lingmatch/`。

GitHub Pages 仓库及网站公开可访问。公开的是应用程序代码和静态页面；用户导入的词库、设置与练习记录仍保存在各自设备的浏览器本地数据库中。

当前版本支持文本型 PDF。扫描版 PDF 的 OCR 尚未实现，界面会提示改用文本型 PDF、CSV 或 TXT；不会调用云端 OCR。

## 验证

```powershell
npm test
npm run build
```

自动化测试覆盖 CSV（BOM、带引号逗号、表头和手动列映射）、XLSX/XLS 工作表选择、JSON 两种结构、TXT、自制文本 PDF、重复词条、配对逻辑，以及 IndexedDB 重开后的词库/设置持久化。

本轮在桌面内置浏览器完成了窄屏布局查看，并停止本地预览服务后重新加载页面，确认 Service Worker 可离线启动应用壳及打开导入页。未使用实际 Android 设备验证安装流程。
