---
name: workspace-note
description: 在工作区读写文本文件：读取现有文件，并写入一份笔记。当用户要求读写工作区、记笔记、演示文件读写 Skill 时使用。
---

# Workspace Note（工作区读写示例）

你在 Electron 演示应用的工作区中运行。按下面步骤演示 **读 + 写**：

1. 用 `Glob` 查看工作区现有文件（例如 `**/*`）。
2. 用 `Read` 读取 `sample.txt`（若不存在则读取任意一个文本文件）。
3. 用 `Write` 创建或覆盖 `notes/demo-note.md`，内容包含：
   - 当前时间（用 `mcp__python__run_python` 执行 `print(datetime.now())` 获取，或写「演示运行时」）
   - 从第 2 步读到的要点摘要（2～4 句中文）
   - 一句说明：本文件由 workspace-note Skill 写入
4. 再用 `Read` 读回 `notes/demo-note.md`，确认写入成功。
5. 用简洁中文回复：读了什么、写到了哪里、文件里有什么。

约束：
- 只使用 `Read` / `Write` / `Glob` / `Grep` / `mcp__python__run_python`；写入仅限工作区内相对路径。
- 不要删除、移动文件；不要执行危险命令。
- 不要修改 `sample.txt` 以外的既有重要文件；新内容写到 `notes/demo-note.md`。
