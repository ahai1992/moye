# Development Guide

[简体中文](development.md)

## Requirements

- Node.js 22.12 or newer.
- Stable Rust and Cargo.
- Windows: MSVC C++ Build Tools, Windows SDK, and WebView2.
- macOS: Xcode Command Line Tools.
- Linux: Tauri system dependencies such as WebKitGTK 4.1.

Install dependencies and start the desktop development app:

```sh
npm install
npm run dev
```

Build a release executable without creating an installer:

```sh
npm run desktop:build -- --no-bundle
```

On Windows, the output is `src-tauri/target/release/moye.exe`. If the first `npm install` creates a `package-lock.json`, commit it with the project so future installs can be reproduced.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows desktop interaction and recovery checks:

```powershell
npm run test:desktop
npm run test:recovery
```

`test:browser` uses Chromium with a native API stub. Desktop checks require Windows, WebView2, and a built app. See the [verification log](verification.md) for the current release's verification scope.

## Repository Layout

```text
src/                 TypeScript UI, editors, notes, and file workflows
src-tauri/src/       Rust desktop commands, local file access, and persistence
tests/               Unit tests and Markdown examples
tools/               Browser, desktop, recovery, and development scripts
release/使用说明.md  Chinese user guide
docs/                Verification and development documentation
```

Source modules are split by responsibility, and hand-written files are kept under 1,000 lines where practical. Release executables and installers are excluded by `.gitignore`; distribute them separately through GitHub Releases.
