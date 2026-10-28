# Moye · Local Markdown Editor

[简体中文](README.md) · **English**

Moye is a lightweight Markdown editor for Windows desktop. It keeps source editing and rendered preview in one editable workspace, so you can work with Markdown without switching between separate panes.

> Current release: **0.9.0** · Windows x64 · approximately **5.51 MB**

## Features

- **Source and preview**: Switch between Markdown source and an editable rendered view in the same workspace.
- **Markdown support**: Headings, emphasis, blockquotes, lists, task lists, tables, links, images, and code blocks, plus math, Mermaid diagrams, footnotes, and GitHub-style alerts.
- **Navigation and search**: An automatically generated six-level heading outline, search and replace, undo, and redo.
- **Multiple tabs**: Open several local documents while keeping each tab's editing state and scroll position.
- **Desktop sticky notes**: Create multiple note windows, pin and resize them, change their colors, save automatically, and highlight every occurrence of configured keywords.
- **Local file protection**: Files are not held open with a persistent lock. Moye checks for external changes and asks whether to reload. Changes to existing files are never saved or overwritten automatically.
- **Reading controls**: Adjust text size and choose no wrapping, window-width wrapping, or A4-width wrapping.
- **Offline by design**: Documents are read and written locally. No account or remote service is required. Math fonts and diagram resources are bundled with the app.

## Download

The current build is a standalone Windows x64 executable of approximately 5.51 MB. Rust and Node.js are not needed to run it. The app uses the system WebView2 runtime, which is generally available on Windows 10 and 11.

This repository does not have a published GitHub Release yet. Once a release is published, download `moye.exe` from this repository's **Releases** page. File association, external-change checks, and native dialogs are currently implemented or verified only on Windows; other platforms have not been verified.

See the [Chinese user guide](release/使用说明.md) for detailed instructions.

See the [development guide](docs/development_en.md) for build prerequisites and checks.

## Build from source

Prerequisites: Node.js 22.12 or newer, stable Rust / Cargo, and the system build tools required by Tauri. Windows builds require MSVC C++ Build Tools, the Windows SDK, and WebView2.

```powershell
npm install
npm run desktop:build -- --no-bundle
```

The Windows executable is written to `src-tauri/target/release/moye.exe`. Local executables and build output are excluded from the repository; use GitHub Releases to distribute binaries.

## Technology

- [Tauri 2](https://v2.tauri.app/) and Rust for desktop windows, local file access, and platform integration.
- TypeScript and Vite for the interface and frontend build.
- CodeMirror, Marked, KaTeX, and Mermaid for source editing, Markdown rendering, math, and diagrams.

## License

This project is licensed under the [MIT License](LICENSE). You may use, modify, distribute, and commercially use the project, provided that copyright and license notices are retained when redistributing it. Third-party dependencies remain under their respective licenses.
