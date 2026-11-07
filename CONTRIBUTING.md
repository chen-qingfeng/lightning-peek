# Contributing

Thanks for helping. Lightning Peek aims to stay a small, fast viewer, so changes that make everyday viewing, measuring or comparing better are the most welcome.

## Reporting a problem

Use the issue templates. For a drawing that does not open or looks wrong, include:

- the Lightning Peek version and Windows version,
- the drawing format and version (shown in the status bar after opening, for example “AutoCAD 2007”),
- what you expected and what you saw, ideally with a screenshot.

Do not attach drawings that contain confidential or personal information. If you can, reproduce the problem with a small drawing made for the purpose.

## Changing code

1. Fork and create a branch.
2. `npm install`, then `npm start` to run and `npm test` to test.
3. Keep the existing structure: plain JavaScript modules, no bundler, no new runtime dependencies without discussion in an issue first.
4. User-facing text goes through `tr('中文原文')` in `app.js`, with the English text added to `app/renderer/core/i18n.js`.
5. Add or update a test in `test/` when you change parsing or measurement code.
6. Describe what you changed and how you checked it in the pull request.

## Contributor License Agreement

Before a pull request can be merged, you need to agree to the [Contributor License Agreement](CLA.md) by ticking the box in the pull request template. You keep the copyright in your work; the agreement lets the maintainer also offer Lightning Peek under other terms, such as a future commercial edition. Code released in this repository stays available under GPL-3.0-or-later.

---

# 参与贡献

欢迎参与。闪电看图希望保持小而快，最欢迎能让日常看图、测量、对比更好用的改动。

- **报告问题**：请使用 Issue 模板，写明版本、Windows 版本、图纸格式与版本（打开后状态栏会显示，如「AutoCAD 2007」）、期望结果和实际结果，最好附截图。请不要上传含保密或个人信息的图纸。
- **修改代码**：`npm install` 后用 `npm start` 运行、`npm test` 测试；保持现有结构（原生 JS 模块，不引入打包工具，新增运行时依赖请先在 Issue 讨论）；界面文字用 `tr('中文原文')`，并在 `app/renderer/core/i18n.js` 补英文；改动解析或测量代码时请补测试。
- **贡献者许可协议**：Pull Request 合并前需同意 [CLA.md](CLA.md)（在 PR 模板中勾选即可）。你的贡献版权仍归你所有；协议允许维护者以其他条款（例如将来的商业版本）提供闪电看图。已在本仓库发布的代码继续以 GPL-3.0-or-later 开源。
