# 开发说明

[English](development_en.md)

## 环境要求

- Node.js 22.12 或更新版本。
- Rust stable 与 Cargo。
- Windows：MSVC C++ Build Tools、Windows SDK、WebView2。
- macOS：Xcode Command Line Tools。
- Linux：Tauri 所需的 WebKitGTK 4.1 等系统依赖。

首次准备依赖并启动桌面开发窗口：

```sh
npm install
npm run dev
```

构建不生成安装包的 release EXE：

```sh
npm run desktop:build -- --no-bundle
```

Windows 构建文件位于 `src-tauri/target/release/moye.exe`。如首次执行 `npm install` 生成了 `package-lock.json`，应将锁文件一并提交，确保后续依赖安装可复现。

## 常用检查

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows 桌面交互和恢复检查：

```powershell
npm run test:desktop
npm run test:recovery
```

`test:browser` 使用 Chromium 和原生接口替身；桌面检查需要 Windows WebView2 与已编译的应用。当前版本的验证范围见[验证记录](verification.md)。

## 目录结构

```text
src/                 TypeScript 用户界面、编辑器、便签和文件工作流
src-tauri/src/       Rust 桌面命令、本地文件访问与持久化
tests/               单元测试和 Markdown 示例
tools/               浏览器、桌面、恢复检查和开发辅助脚本
release/使用说明.md  中文用户操作说明
docs/                验证记录和开发文档
```

项目按职责拆分源码模块；手写文件尽量控制在 1000 行以内。发布 EXE 和安装包由 `.gitignore` 排除，应通过 GitHub Releases 单独分发。
