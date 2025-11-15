# AugmentInjectoer v2.1 更新日志

## 🎯 版本信息
- **版本号**: v2.1
- **更新日期**: 2024-01-XX
- **主要目标**: 修复聊天上下文丢失问题 + 增强调试能力

---

## 🔧 核心修复

### 1. **增强调试模式**
- ✅ 新增 `DEBUG_MODE` 开关（默认开启）
- ✅ 新增 `debug` 日志级别，可单独控制调试日志输出
- ✅ 调试模式下输出完整的请求体字段结构
- ✅ 调试模式下显示所有已加载的 Conversation ID 映射

### 2. **chat-stream 拦截器增强**
- ✅ 增加详细的拦截流程日志
- ✅ 记录请求体解析状态
- ✅ 输出请求体字段列表（调试模式）
- ✅ 明确标识是否存在 conversation_id 字段
- ✅ 优化 Conversation ID 显示（只显示前 8 位）
- ✅ 增加错误堆栈输出（调试模式）

### 3. **record-request-events 拦截器增强**
- ✅ 增加详细的拦截流程日志
- ✅ 统计替换的 conversation_id 数量
- ✅ 优化 Conversation ID 显示（只显示前 8 位）
- ✅ 增加错误堆栈输出（调试模式）

### 4. **Conversation ID 映射函数增强**
- ✅ 增加详细的映射创建/复用日志
- ✅ 显示当前映射表大小
- ✅ 记录文件保存状态
- ✅ 优化 ID 显示（只显示前 8 位）

### 5. **初始化流程增强**
- ✅ 增加初始化阶段的分隔线
- ✅ 显示所有已加载的映射关系（调试模式）
- ✅ 记录 Session ID 保存状态
- ✅ 更清晰的初始化完成提示

### 6. **Git 日志优化（完全静默）**
- ✅ **默认完全禁用 Git 日志输出**
- ✅ 仅在调试模式下统计 Git 命令
- ✅ 每 5 秒输出一次统计摘要（仅显示前 3 个最频繁命令）
- ✅ 彻底解决 Git 日志刷屏问题

---

## 📊 日志输出示例

### 启动时
```
========================================
🚀 开始初始化持久化数据...
========================================
✅ 成功加载 Session ID: 08d56c1a-...
🔄 使用已保存的 Session ID: 08d56c1a-...
✅ 成功加载 Conversation ID 映射，数量: 3
🔄 已加载 Conversation ID 映射，当前数量: 3
🔍 [DEBUG] 已加载的 Conversation ID 映射:
  - 12345678-... → 87654321-...
  - abcdefgh-... → hgfedcba-...
  - 11111111-... → 99999999-...
========================================
✅ 持久化数据初始化完成
========================================
```

### 聊天请求时
```
🔍 [DEBUG] chat-stream 拦截器触发
🔍 [DEBUG] chat-stream 请求体已解析为 JSON
🔍 [DEBUG] chat-stream 请求体字段: conversation_id, messages, model, stream
🧹 清理 chat-stream 数据: 已清空 2 个 blobs
🔍 [DEBUG] getOrCreateConversationIdMapping 被调用，原始 ID: 12345678...
♻️ 复用已有 Conversation ID 映射: 12345678... → 87654321...
🔍 [DEBUG] 当前映射表大小: 3
🎲 chat-stream 替换 conversation_id: 12345678... → 87654321...
✅ chat-stream 请求已修改，返回新的请求体
```

### 新会话时
```
🔍 [DEBUG] chat-stream 拦截器触发
⚠️ chat-stream 请求体中没有 conversation_id 字段（可能是新会话）
🔍 [DEBUG] chat-stream 请求未修改
```

### Git 命令统计（仅调试模式）
```
🔍 [DEBUG] Git 命令统计（最近 5 秒）: 共 127 次
  - git status (×85)
  - git config user.name (×32)
  - git log --oneline -1 (×10)
```

---

## 🐛 已知问题排查

### 问题：聊天上下文丢失

**可能原因**：
1. ❌ Augment 本地 LevelDB 数据库被清空
2. ❌ 没有发送聊天请求，拦截器未触发
3. ❌ 请求体中没有 conversation_id 字段

**排查方法**：
1. 查看日志中是否有 `chat-stream 拦截器触发` 日志
2. 查看是否有 `替换 conversation_id` 或 `没有 conversation_id 字段` 日志
3. 检查映射表大小是否正确
4. 确认是否真的发送了聊天消息

---

## 🎛️ 调试模式控制

在 `interceptor.js` 第 30 行：

```javascript
// 调试模式开关（设置为 true 可以看到更详细的日志）
const DEBUG_MODE = true;  // 改为 false 关闭调试日志
```

**调试模式开启时**：
- ✅ 显示所有 `[DEBUG]` 日志
- ✅ 显示请求体字段列表
- ✅ 显示已加载的映射关系
- ✅ 显示错误堆栈
- ✅ 显示非敏感 Git 命令

**调试模式关闭时**：
- ❌ 隐藏所有 `[DEBUG]` 日志
- ✅ 仅显示关键操作日志
- ✅ 日志更简洁

---

## 📝 下一步建议

1. **测试新版本**：重启 VSCode/Cursor，发送聊天消息
2. **查看日志**：打开 "Augment Interceptor" 输出通道
3. **确认拦截**：查看是否有 `chat-stream 拦截器触发` 日志
4. **验证映射**：查看是否有 `替换 conversation_id` 日志
5. **检查持久化**：重启后查看映射表大小是否保持

---

## 🆕 v2.1.1 更新 (2025-11-15)

### 上下文丢失问题诊断增强
- ✅ 在 `processInterceptedRequest` 中添加详细调试日志
- ✅ 记录所有 chat-stream 相关请求的 URL 和数据结构
- ✅ 追踪拦截器匹配情况和返回值
- ✅ 帮助诊断为什么拦截器没有被触发

### 新增调试日志
```
🔍 [DEBUG] processInterceptedRequest 被调用
🔍 [DEBUG] URL: https://api.augmentcode.com/chat-stream
🔍 [DEBUG] 请求数据: {"hasHeaders":true,"hasBody":true,"bodyType":"string"}
🔍 [DEBUG] 拦截器匹配: chat-stream
🔍 [DEBUG] 拦截器返回: {"type":"modify","data":{...}}
```

### 问题诊断文档
- ✅ 创建 `上下文丢失问题诊断报告.md`
- ✅ 详细分析日志差异
- ✅ 提供解决方案和下一步行动

---

## 🔗 相关文件

- `AugmentInjectoer_v2/resources/interceptor.js` - 核心拦截器代码
- `AugmentInjectoer_v2/inject.js` - 注入入口
- `%APPDATA%\Code\User\globalStorage\augment-interceptor\` - 持久化数据目录
  - `sessionid.json` - Session ID 存储
  - `conversationids.json` - Conversation ID 映射存储
- `上下文丢失问题诊断报告.md` - 问题诊断文档

