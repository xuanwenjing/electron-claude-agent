---
name: workspace-summary
description: 分析当前工作区文件结构并给出简短中文摘要。当用户要求查看工作区、总结目录内容、或演示 Skill 时使用。
---

# Workspace Summary

你在 Electron 演示应用的工作区中运行。请按下面步骤操作：

1. 用 `Glob` 列出工作区文件（例如 `**/*`）。
2. 必要时用 `Grep` / `Read` 查看关键文本文件。
3. 用 `mcp__python__run_python`（`code` 参数）打印当前目录与顶层文件大小，例如 `os.getcwd()` + `os.scandir(".")`。不要用 Bash / PowerShell，Windows 上它们不可用。
4. 输出简洁中文结论：文件数量、主要文件用途、一条可执行的下一步建议。

约束：
- 不要删除、移动文件，不要执行危险命令。
- 只在当前工作区内操作。
