# 墨页 · 本地 Markdown 编辑器

**中文** · [English](README_EN.md)

墨页是一款轻量的 Windows 桌面 Markdown 编辑器。它把源码编辑和可视化预览放在同一编辑区，适合希望专注写作、同时保留 Markdown 原文控制的用户。

> 当前发布版本：**0.9.0** · Windows x64 · 主程序约 **5.51 MB**

## 功能一览

- **源码与预览**：在同一页面切换 Markdown 源码或可编辑预览，不使用并排分栏。
- **常见 Markdown**：支持标题、文本格式、引用、列表、任务列表、表格、链接、图片和代码块，并支持数学公式、Mermaid 图表、脚注及 GitHub 风格提示块。
- **文档导航**：自动生成六级标题目录，点击即可跳转；支持搜索、替换、撤销和重做。
- **多标签编辑**：同时打开多份本地文档，各标签保留自己的编辑状态和滚动位置。
- **桌面便签**：创建多个便签窗口，支持置顶、调整窗口大小和颜色、自动保存，以及关键词持续高亮。
- **本地文件保护**：不持续锁定文件；检测到外部修改时询问是否重新加载。已有文件的修改不会被自动保存或自动覆盖。
- **阅读设置**：支持字号调整，以及不换行、按窗口换行和按 A4 页面宽度换行。
- **离线使用**：文档在本机读写，不需要登录或远程服务。公式字体和图表资源随应用提供。

## 下载

当前程序为 Windows x64 的独立 EXE，约 5.51 MB，无需安装 Rust 或 Node.js。程序使用系统 WebView2；通常 Windows 10 / 11 已提供该运行环境。

本项目尚未发布 GitHub Release。维护者发布版本后，可在本仓库的 **Releases** 页面下载 `moye.exe`。文件关联、外部修改检查和系统对话框等功能目前只在 Windows 版本中实现或验证；其他平台尚未验证。

详细操作说明见[中文使用说明](release/使用说明.md)。

开发环境、构建和检查命令见[开发说明](docs/development.md)。

## 从源码构建

需要 Node.js 22.12 或更新版本、Rust stable / Cargo，以及 Tauri 所需的系统构建工具。Windows 构建需要 MSVC C++ Build Tools、Windows SDK 和 WebView2。

```powershell
npm install
npm run desktop:build -- --no-bundle
```

Windows EXE 输出到 `src-tauri/target/release/moye.exe`。仓库忽略本地构建 EXE 和打包产物；发布二进制建议通过 GitHub Releases 提供。

## 技术栈

- [Tauri 2](https://v2.tauri.app/) 与 Rust：桌面窗口、本地文件访问和平台集成。
- TypeScript、Vite：界面和前端构建。
- CodeMirror、Marked、KaTeX、Mermaid：源码编辑、Markdown 渲染、数学公式和图表。

## 许可证

本项目采用 [MIT License](LICENSE)。你可以使用、修改、分发本项目并用于商业用途；再分发时须保留版权声明和许可证文本。第三方依赖仍遵循各自的许可证。
