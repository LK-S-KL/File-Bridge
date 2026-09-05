# 参与 Rove 开发

Rove 使用小步提交。一次分支只处理一个功能或一个问题，`main` 始终保持可运行。

## 日常流程

1. 从最新的 `main` 创建分支，例如 `feature/search-filter` 或 `fix/import-path`。
2. 只修改与当前目标有关的文件。
3. 运行 `npm test`。
4. 在 Premiere Pro 中手工验证受影响的流程；涉及 AE 时也要在 After Effects 验证。
5. 提交清晰的变更说明，再合并到 `main`。

## 提交说明

建议使用下面的前缀：

- `feat:` 新功能
- `fix:` 问题修复
- `docs:` 文档
- `test:` 测试
- `chore:` 构建或维护

示例：`fix: handle offline NAS folders`

## 合并条件

- 自动检查通过。
- 没有提交密码、令牌、证书、NAS 登录信息或用户素材。
- `package.json`、CEP manifest 与宿主脚本中的版本号一致。
- 用户可见变化已经写入 `CHANGELOG.md`。
