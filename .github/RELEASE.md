# 发布指南

## 自动发布流程

本项目使用 GitHub Actions 自动发布到 npm。

### 发布步骤

1. **确保代码已合并到 main 分支**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **创建并推送版本 tag**
   ```bash
   # 例如发布 v0.1.1
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. **GitHub Actions 自动执行**
   - 构建 `@bucket-db/types` 和 `@bucket-db/core`
   - 更新 package.json 版本号
   - 发布到 npm
   - 创建 GitHub Release

### 首次配置

在 GitHub 仓库中添加 npm token：

1. **生成 npm token**
   ```bash
   npm login
   npm token create --type=automation
   ```

2. **添加到 GitHub Secrets**
   - 访问：https://github.com/holdbaby5483/bucket-db/settings/secrets/actions
   - 点击「New repository secret」
   - Name: `NPM_TOKEN`
   - Value: 粘贴刚生成的 token
   - 点击「Add secret」

### 版本号规范

遵循语义化版本（Semantic Versioning）：

- `v0.1.0` → `v0.1.1`：补丁版本（bug 修复）
- `v0.1.0` → `v0.2.0`：次版本（新功能，向后兼容）
- `v0.1.0` → `v1.0.0`：主版本（破坏性变更）

### 手动发布（备用方案）

如果 CI/CD 失败，可以手动发布：

```bash
# 1. 构建
cd packages/types && bun run build
cd ../core && bun run build

# 2. 更新版本号
cd packages/types
npm version 0.1.1 --no-git-tag-version

cd ../core
npm version 0.1.1 --no-git-tag-version
# 手动更新 package.json 中 @bucket-db/types 的版本

# 3. 发布
npm login
cd packages/types && npm publish --access public
cd ../core && npm publish --access public
```

### 验证发布

```bash
# 检查 npm 上的版本
npm view @bucket-db/core version
npm view @bucket-db/types version

# 测试安装
mkdir test-install && cd test-install
npm init -y
npm install @bucket-db/core
```

## 常见问题

**Q: 发布失败显示 401 Unauthorized**
A: NPM_TOKEN 过期或无效，重新生成并更新 GitHub Secret

**Q: 版本号冲突**
A: 该版本号已存在，需要使用新的版本号

**Q: 包依赖错误**
A: 确保 @bucket-db/types 先于 @bucket-db/core 发布
