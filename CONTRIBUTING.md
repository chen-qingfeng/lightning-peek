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

## Where to start

Issues labelled [good first issue](https://github.com/chen-qingfeng/lightning-peek/labels/good%20first%20issue) are small and self-contained; [help wanted](https://github.com/chen-qingfeng/lightning-peek/labels/help%20wanted) issues are bigger. Comment on an issue before you start so two people do not work on the same thing. You can also help without code: report drawings that display wrongly, or share opening times on your Windows computer (issue #6).

## License of contributions

There is no CLA. By opening a pull request you agree that your contribution is licensed under the project's license, GPL-3.0-or-later. You keep the copyright in your work. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

---

# 参与贡献

欢迎参与。闪电看图希望保持小而快，最欢迎能让日常看图、测量、对比更好用的改动。

- **报告问题**：请使用 Issue 模板，写明版本、Windows 版本、图纸格式与版本（打开后状态栏会显示，如「AutoCAD 2007」）、期望结果和实际结果，最好附截图。请不要上传含保密或个人信息的图纸。
- **修改代码**：`npm install` 后用 `npm start` 运行、`npm test` 测试；保持现有结构（原生 JS 模块，不引入打包工具，新增运行时依赖请先在 Issue 讨论）；界面文字用 `tr('中文原文')`，并在 `app/renderer/core/i18n.js` 补英文；改动解析或测量代码时请补测试。
- **从哪里开始**：标了 good first issue 的 Issue 比较小、适合第一次参与；help wanted 的工作量大一些。动手前先在 Issue 下留言，避免撞车。不写代码也能帮忙：反馈显示不对的图纸，或在 Issue #6 分享你电脑上的打开速度。
- **贡献的许可**：不签 CLA。提交 Pull Request 即表示你的贡献按本项目的许可证 GPL-3.0-or-later 发布，版权仍归你本人。请遵守[行为准则](CODE_OF_CONDUCT.md)。
