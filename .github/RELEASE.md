# 发布指南

`@hold-baby/bucket-db` 由 GitHub Actions（`.github/workflows/publish.yml`）发布到 npm，推送版本 tag 即触发。

## 发布步骤

1. **在 `main` 上准备版本**
   - `packages/core/package.json` 的 `version` 改为新版本号。
   - `CHANGELOG.md` 新增 `## [x.y.z] - YYYY-MM-DD` 一节，这一节会原样成为 GitHub Release 的说明。
   - 推送到 `main`，等 Test 工作流通过。

2. **打 tag 并推送**
   ```bash
   git tag -a vX.Y.Z -m vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **工作流自动执行**
   - 构建、运行全部测试、检查体积和依赖门禁（`packages/core/scripts/check-budget.sh`）
   - 按 tag 设置版本号并发布到 npm，附带 provenance
   - 用 CHANGELOG 中该版本的一节创建 GitHub Release

预发布版本（tag 中带 `-`，例如 `v0.6.0-beta.0`）以 `next` dist-tag 发布并标记为 prerelease，不会成为 `latest`。

## 认证：npm trusted publishing

发布不使用 npm 令牌。npm 上为本包配置了 trusted publisher，只接受 `holdbaby5483/bucket-db` 仓库中 `publish.yml` 发起的发布，认证通过 GitHub OIDC 完成（工作流需要 `id-token: write`，npm CLI ≥ 11.5.1，Node ≥ 22.14）。

查看或修改配置（需要 npm 账号两步验证）：

```bash
npx npm@11 trust list @hold-baby/bucket-db
npx npm@11 trust github @hold-baby/bucket-db --file publish.yml --repo holdbaby5483/bucket-db --allow-publish
```

工作流文件改名时必须同步更新这里的配置，否则发布会以 E404 失败。

## 验证发布

```bash
npm view @hold-baby/bucket-db dist-tags
npx -y @hold-baby/bucket-db --help
```

## 常见问题

**Q: `npm publish` 报 E404 Not Found**
A: npm 对认证失败的 scoped 包写入返回 404。检查 trusted publisher 配置是否指向当前仓库和 `publish.yml`，以及工作流是否仍有 `id-token: write`。

**Q: 版本号冲突**
A: npm 上已存在该版本，换一个新版本号；已发布的版本不能覆盖。

**Q: 弃用旧版本**
A: `npm deprecate "@hold-baby/bucket-db@<range>" "<说明>"`，需要 npm 登录和两步验证。
