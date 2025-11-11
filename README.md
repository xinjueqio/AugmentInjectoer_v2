# AugmentInjectoer v2

基于官方 Augment v0.633.0 分析 + AugmentInjectoer_release1 解密的完整增强注入脚本

## 功能特性

### 1. 风控绕过 (interceptor.js) ✅ 完整实现

#### 核心拦截功能
- ✅ **Session ID 替换** - 所有请求中的 Session ID 自动替换为伪造 ID
- ✅ **Machine ID 伪造** - 拦截 vscode.env.machineId 并返回伪造 ID
- ✅ **Feature Vector 替换** - 递归替换所有 64 字符 hex Feature Vector
- ✅ **Conversation ID 替换** - 维护映射表,替换所有对话 ID
- ✅ **保留聊天上下文** - 不清除 Blob 数据,保持完整对话历史

#### 网络拦截
- ✅ **HTTP/HTTPS 拦截** - 拦截 require('http') 和 require('https')
- ✅ **Axios 拦截** - 拦截 axios.interceptors.request
- ✅ **Fetch 拦截** - 拦截 global.fetch
- ✅ **XMLHttpRequest 拦截** - 拦截 XMLHttpRequest.send()

#### 硬件标识符伪造
- ✅ **macOS 伪造**: IOPlatformUUID, IOPlatformSerialNumber, board-id
- ✅ **Windows 伪造**: MachineGuid, ProductId, SerialNumber
- ✅ **Git 输出隐藏** - 所有 git 命令返回空字符串

#### 拦截的端点
- ✅ chat-stream - 聊天流式响应 (保留 Blob 数据)
- ✅ record-request-events - 请求事件记录 (替换 Conversation ID)
- ✅ report-feature-vector - Feature Vector 上报 (替换 Vector)

### 2. Token 登录 (token-login-enhanced.js) ✅ 完整实现
- ✅ **输入框直接登录** (ATM 风格,非 Webview)
- ✅ **Deep Link 自动登录**
- ✅ **Token 管理命令** - 导入/导出/切换账号
- ✅ **Session ID 更新机制** - 登录后自动更新伪造 Session ID

### 3. 余额监控 (balance-enhanced.js) ✅ 完整实现
- ✅ **Orb API 集成** - 直接调用 portal.withorb.com API
- ✅ **状态栏显示** - 实时显示余额和套餐信息
- ✅ **24小时缓存** - 减少 API 调用频率
- ✅ **正确的字段路径** - account.custom_pricing_units

## 使用方法

### 1. 注入到 Augment 扩展

```bash
node inject.js
```

### 2. 重启 VSCode

关闭所有 VSCode 窗口并重新打开

### 3. 使用 Token 登录

1. 打开命令面板 (Ctrl+Shift+P 或 Cmd+Shift+P)
2. 输入 Augment: Token 管理
3. 选择 导入新账号
4. 输入 Token 和 Portal URL

### 4. 查看余额

- **自动显示**: 状态栏右下角自动显示余额
- **手动刷新**: 命令 Augment: 刷新余额
- **查看详情**: 命令 Augment: 显示余额详情

## 对比 AugmentInjectoer_release1

| 功能 | release1 | v2 | 说明 |
|------|---------|----|----|
| Session ID 替换 | ✅ | ✅ | 相同 |
| Machine ID 伪造 | ✅ | ✅ | 相同 |
| Feature Vector 替换 | ✅ | ✅ | 相同 |
| Conversation ID 替换 | ✅ | ✅ | 相同 |
| 硬件标识符伪造 | ✅ | ✅ | 相同 |
| Git 输出隐藏 | ✅ | ✅ | 相同 |
| HTTP/HTTPS 拦截 | ✅ | ✅ | 相同 |
| Axios 拦截 | ✅ | ✅ | 相同 |
| Fetch 拦截 | ✅ | ✅ | 相同 |
| XMLHttpRequest 拦截 | ✅ | ✅ | 相同 |
| **Blob 数据处理** | ❌ 清除 | ✅ **保留** | **主要区别** |
| **代码可读性** | ❌ 混淆 | ✅ **明文** | **主要区别** |
| Token 登录方式 | Webview | 输入框 | v2 更简洁 |
| 余额监控 | ✅ | ✅ | 相同 |

## 注意事项

### ⚠️ 重要提示

1. **Blob 数据保留**:
   - ✅ 优点: 保留完整聊天上下文,AI 回复更准确
   - ⚠️ 缺点: 可能上传文件数据到 Augment 服务器
   - 💡 建议: 不要在聊天中包含敏感文件

2. **代码未混淆**:
   - ✅ 优点: 方便阅读和修改
   - ⚠️ 缺点: 容易被检测
   - 💡 建议: 仅供学习研究使用

3. **风控检测**:
   - ⚠️ 虽然替换了所有已知的风控数据,但 Augment 可能有其他检测机制
   - 💡 建议: 不要滥用,保持正常使用频率

4. **账号安全**:
   - ⚠️ Token 和 Portal URL 存储在 VSCode 配置中
   - 💡 建议: 不要分享你的 VSCode 配置文件

## 许可证

仅供学习研究使用,请勿用于商业用途。
