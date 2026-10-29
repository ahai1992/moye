# Moye

[简体中文](README.md) · **English**

## Download

The current release is for Windows x64. Visit [Releases to download the latest version](https://github.com/ahai1992/moye/releases/latest), then run `moye.exe` or associate `.md` files with Moye. Version 0.9.4 is approximately 5.54 MB and uses the system WebView2 runtime.

## What I Want to Get Right

- **Writing in one workspace**: Switch between Markdown source and an editable preview without juggling two panes.
- **Preserving the original document**: Content I have not edited keeps its original Markdown. I save changes to existing files manually; the app never overwrites them automatically.
- **Opening local files with confidence**: Moye does not keep files locked. If another app changes a document, I can reload it or keep working with my current content.
- **Working with several documents**: Open files in separate tabs, each with its own editing state and scroll position.
- **Finding what I need to change**: The sidebar builds an outline from document headings, and search and replace are available from the editor.
- **Reading my way**: Adjust the text size and choose no wrapping, window-width wrapping, or A4-width wrapping.
- **Keeping notes on the desktop**: Create multiple sticky notes, change their colors and window sizes, and keep them on top. Highlight a keyword to show every occurrence in red with white text, including matches added later.

Moye supports common Markdown syntax, as well as tables, task lists, code highlighting, math, Mermaid diagrams, footnotes, and GitHub-style alerts. See the [Chinese user guide](release/使用说明.md) for more details.

## Run from Source

I build Moye with Tauri 2, Rust, and TypeScript. Building requires Node.js 22.12 or newer, stable Rust / Cargo, and the Tauri build tools for your platform. Windows also requires MSVC C++ Build Tools and the Windows SDK.

```powershell
npm install
npm run dev
```

Build a Windows executable without creating an installer:

```powershell
npm run desktop:build -- --no-bundle
```

The executable is written to `src-tauri/target/release/moye.exe`. I distribute releases through GitHub Releases; the source repository does not include executables or installers.

## Platforms and License

I currently release and verify the Windows version. macOS and Linux have not been verified.

I release this project under the [MIT License](LICENSE).
