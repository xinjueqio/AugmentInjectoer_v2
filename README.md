# Augment 注入增强版 v2 — 功能说明

本增强版在官方扩展基础上进行三重注入（拦截器 + Token 登录增强 + 余额增强），目标是提供更灵活的网络拦截与认证管理体验，并在状态栏显示账户余额信息。

## 核心功能

### 1. 拦截器 (Interceptor)
- **网络拦截**: 拦截所有网络 API 请求，防止封号
- **Session ID 替换**: 自动替换真实 Session ID 为伪造 UUID
- **Machine ID 欺骗**: 伪造硬件标识符 (macOS + Windows)
- **Feature Vector 替换**: 替换风控特征向量
- **Conversation ID 映射**: 维护伪造与真实对话 ID 的映射关系
- **Blob 数据保留**: 保留聊天上下文，不清除 Blob 数据
- **Git 输出隐藏**: 隐藏敏感的 Git 信息

### 2. Token 登录增强 (Token Login Enhanced)
- **Deep Link 登录**: 支持 `vscode://augment.vscode-augment/autoAuth/push-login` 深链接
- **ATM 导入**: 自动解析 `url`, `token`, `portal` 参数
- **别名参数**: 支持 `tenantURL`, `accessToken` 别名
- **Portal Token 提取**: 自动从 URL 中提取 Orb Portal Token
- **自动更新余额 Token**: 导入账号时自动更新余额监控配置
- **重载窗口提示**: 登录成功后提示重载窗口

### 3. 余额增强 (Balance Enhanced)
- **状态栏显示**: 在 VSCode 状态栏实时显示账户余额
- **Orb API 集成**: 直接调用 `portal.withorb.com` API 获取余额
- **24 小时缓存**: 缓存余额数据，减少 API 调用
- **自动刷新**: 可配置自动刷新间隔 (默认 10 分钟)
- **Token 提取**: 支持从 "View usage" 链接中自动提取 Token
- **手动刷新**: 提供手动刷新余额命令

## 配置说明

### Token 登录配置

无需配置，直接使用 Deep Link 导入账号即可。

### 余额监控配置

在 VSCode 设置中搜索 `augmentBalance`:

- **augmentBalance.token**: Orb Portal Token (必填)
  - 支持直接填入 Token
  - 支持填入完整的 "View usage" 链接 (自动提取 Token)

- **augmentBalance.updateInterval**: 余额更新间隔 (秒)
  - 默认值: `600` (10 分钟)
  - 最小值: `60` (1 分钟)
  - 最大值: `3600` (1 小时)

- **augmentBalance.enabled**: 是否在状态栏显示余额
  - 默认值: `true`

## 使用方法

### 导入账号 (Deep Link)

1. 获取 Deep Link (格式如下):
   ```
   vscode://augment.vscode-augment/autoAuth/push-login?url=https://api.augmentcode.com&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...&portal=https://portal.withorb.com/...?token=xxx
   ```

2. 点击链接或在浏览器地址栏粘贴

3. VSCode 自动打开并导入账号

4. 选择 "重载窗口" 使配置生效

### 查看余额

1. 在 VSCode 状态栏查看余额显示

2. 点击余额显示可打开设置页面

3. 使用命令面板 (`Ctrl+Shift+P`) 执行:
   - `Augment Balance: Refresh Balance` - 手动刷新余额
   - `Augment Balance: Open Balance Settings` - 打开设置
   - `Augment Balance: Toggle Balance Display` - 切换显示/隐藏

## 技术特点

- ✅ **完全明文代码**: 所有代码未混淆，方便修改和维护
- ✅ **保留聊天上下文**: 不清除 Blob 数据，保持对话连续性
- ✅ **GitHub Actions 自动化**: 支持自动构建和发布 VSIX
- ✅ **与 release1 兼容**: 配置和功能与 AugmentInjectoer_release1 完全一致

## 来源与发布

- 原项目: https://github.com/llpplplp/AugmentInjector
- 一键换号工具: https://github.com/zhaochengcube/augment-token-mng

