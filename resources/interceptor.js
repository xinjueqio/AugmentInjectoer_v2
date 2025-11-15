/**
 * 网络拦截器 - 核心风控绕过模块 + 上下文保留
 * 基于官方 v0.633.0 分析 + AugmentInjectoer_release1 拦截框架
 *
 * 功能:
 * 1. URI 深链接拦截 (支持 /autoAuth 和 /push-login)
 * 2. Session ID 替换
 * 3. Machine ID 伪造
 * 4. Feature Vector 替换
 * 5. ✅ 保留 Conversation ID (不替换，维持上下文)
 * 6. 硬件标识符伪造
 * 7. Git 输出隐藏
 * 8. ✅ 保留完整聊天上下文 (包括 Blob 数据、对话历史等)
 *
 * 关键改进 (v2):
 * - 使用 release1 的拦截逻辑框架 (type: 'modify'/'skip')
 * - 保留所有请求体数据，不清除任何字段
 * - 启用 record-request-events 拦截器
 * - 修复 HTTP 拦截器的参数传递 bug
 *
 * 注意：GitHub Actions 会直接注入此文件内容，不添加额外包裹
 * 所以需要保持原有的 IIFE 结构
 */

(function() {
  'use strict';

  // ==================== 日志输出通道 ====================

  let outputChannel = null;
  let vscodeModule = null;

  // 调试模式开关（设置为 true 可以看到更详细的日志）
  const DEBUG_MODE = true;

  try {
    vscodeModule = require('vscode');
    if (vscodeModule && vscodeModule.window && typeof vscodeModule.window.createOutputChannel === 'function') {
      outputChannel = vscodeModule.window.createOutputChannel('Augment Interceptor');
      outputChannel.appendLine('========================================');
      outputChannel.appendLine('Augment Interceptor v2.1 已加载');
      outputChannel.appendLine('时间: ' + new Date().toLocaleString());
      outputChannel.appendLine('调试模式: ' + (DEBUG_MODE ? '开启' : '关闭'));
      outputChannel.appendLine('========================================');
    }
  } catch (e) {
    // vscode 模块可能不存在，忽略错误
  }

  /**
   * 统一的日志输出函数
   * @param {string} message - 日志消息
   * @param {string} level - 日志级别: 'info', 'warn', 'error', 'debug'
   */
  function log(message, level = 'info') {
    // 如果是 debug 级别且调试模式关闭，则不输出
    if (level === 'debug' && !DEBUG_MODE) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [AugmentInterceptor]`;
    const fullMessage = `${prefix} ${message}`;

    // 输出到控制台
    if (level === 'error') {
      console.error(fullMessage);
    } else if (level === 'warn') {
      console.warn(fullMessage);
    } else if (level === 'debug') {
      console.log('[DEBUG] ' + fullMessage);
    } else {
      console.log(fullMessage);
    }

    // 输出到 OutputChannel
    if (outputChannel) {
      try {
        outputChannel.appendLine(fullMessage);
      } catch (e) {
        // 忽略 OutputChannel 错误
      }
    }
  }

  // ==================== URI 深链接拦截器 ====================

  try {
    const vscode = vscodeModule || require('vscode');

    if (vscode && vscode.window && typeof vscode.window.registerUriHandler === 'function') {
      // 保存原始的 registerUriHandler
      const originalRegisterUriHandler = vscode.window.registerUriHandler.bind(vscode.window);

      // 自定义 URI 处理器（由 token-login-enhanced.js 设置）
      let customUriHandler = null;

      /**
       * 检查 URI 路径是否为认证相关路径
       */
      function isAuthPath(uri) {
        try {
          const path = uri && (uri.path || '');
          return (
            path === '/autoAuth' ||
            path === 'autoAuth' ||
            path === '/push-login' ||
            path === 'push-login'
          );
        } catch (e) {
          return false;
        }
      }

      /**
       * 拦截 registerUriHandler，支持自定义处理器优先级
       */
      vscode.window.registerUriHandler = function(handler) {
        const wrappedHandler = {
          handleUri: async (uri) => {
            // 优先使用自定义处理器处理认证路径
            try {
              if (customUriHandler && isAuthPath(uri)) {
                return await customUriHandler(uri);
              }
            } catch (error) {
              try {
                log('Custom URI handler failed: ' + error.message, 'warn');
              } catch (e) {}
            }

            // 否则使用原始处理器
            try {
              return handler && typeof handler.handleUri === 'function'
                ? handler.handleUri(uri)
                : undefined;
            } catch (error) {
              try {
                log('Delegate URI handler failed: ' + error.message, 'warn');
              } catch (e) {}
            }
          }
        };

        return originalRegisterUriHandler(wrappedHandler);
      };

      // 暴露全局接口供 token-login-enhanced.js 使用
      const globalObj = typeof globalThis !== 'undefined' ? globalThis :
                       (typeof global !== 'undefined' ? global : {});

      if (globalObj) {
        globalObj.Augment = globalObj.Augment || {};

        /**
         * 设置自定义 URI 处理器
         */
        globalObj.Augment.setUriHandler = function(handler) {
          if (typeof handler === 'function') {
            customUriHandler = handler;
            log('Custom URI handler registered');
          }
        };

        /**
         * 获取当前自定义 URI 处理器
         */
        globalObj.Augment.getUriHandler = function() {
          return customUriHandler;
        };
      }

      log('URI interceptor initialized');
    }
  } catch (error) {
    log('Failed to initialize URI interceptor: ' + error.message, 'error');
  }

  // ==================== 全局变量 ====================

  // 伪造的 Session ID
  let FAKE_SESSION_ID = generateUUID();

  // Conversation ID 映射表 (内存)
  const conversationIdMap = new Map();

  // 拦截器映射表
  const interceptorMap = new Map();

  // ==================== 持久化存储管理 ====================

  /**
   * 获取存储目录路径
   * 参考 augment-account-manager 的实现
   */
  function getStorageDir() {
    try {
      const os = require('os');
      const path = require('path');
      return path.join(os.homedir(), '.augmentpool');
    } catch (error) {
      log('❌ 获取存储目录失败: ' + error.message, 'error');
      return null;
    }
  }

  /**
   * 确保存储目录存在
   */
  function ensureStorageDir() {
    try {
      const fs = require('fs');
      const storageDir = getStorageDir();

      if (!storageDir) {
        return false;
      }

      if (!fs.existsSync(storageDir)) {
        log('📁 创建存储目录: ' + storageDir);
        fs.mkdirSync(storageDir, { recursive: true });
        log('✅ 存储目录创建成功');
      }

      return true;
    } catch (error) {
      log('❌ 创建存储目录失败: ' + error.message, 'error');
      return false;
    }
  }

  /**
   * 加载 Session ID (从文件)
   * 参考 augment-account-manager 的实现
   */
  function loadSessionId() {
    try {
      const fs = require('fs');
      const path = require('path');
      const storageDir = getStorageDir();

      if (!storageDir) {
        return null;
      }

      const sessionFile = path.join(storageDir, 'session.json');

      if (!fs.existsSync(sessionFile)) {
        log('📄 Session 文件不存在: ' + sessionFile);
        return null;
      }

      const data = fs.readFileSync(sessionFile, 'utf8');
      const sessionData = JSON.parse(data);

      if (sessionData && sessionData.sessionId) {
        log('✅ 成功加载 Session ID: ' + sessionData.sessionId);
        return sessionData.sessionId;
      }

      return null;
    } catch (error) {
      log('❌ 加载 Session ID 失败: ' + error.message, 'error');
      return null;
    }
  }

  /**
   * 保存 Session ID (到文件)
   * 参考 augment-account-manager 的实现
   */
  function saveSessionId(sessionId) {
    try {
      if (!ensureStorageDir()) {
        return false;
      }

      const fs = require('fs');
      const path = require('path');
      const storageDir = getStorageDir();
      const sessionFile = path.join(storageDir, 'session.json');

      const sessionData = {
        sessionId: sessionId,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
      log('✅ 成功保存 Session ID: ' + sessionId);
      return true;
    } catch (error) {
      log('❌ 保存 Session ID 失败: ' + error.message, 'error');
      return false;
    }
  }

  /**
   * 加载 Conversation ID 映射 (从文件)
   * 参考 augment-account-manager 的实现
   */
  function loadConversationIdMappings() {
    try {
      const fs = require('fs');
      const path = require('path');
      const storageDir = getStorageDir();

      if (!storageDir) {
        return {};
      }

      const mappingFile = path.join(storageDir, 'conversationids.json');

      if (!fs.existsSync(mappingFile)) {
        log('📄 Conversation ID 映射文件不存在');
        return {};
      }

      const data = fs.readFileSync(mappingFile, 'utf8');
      const mappings = JSON.parse(data);

      log('✅ 成功加载 Conversation ID 映射，数量: ' + Object.keys(mappings).length);

      // 将对象转换为 Map
      for (const [key, value] of Object.entries(mappings)) {
        conversationIdMap.set(key, value);
      }

      return mappings;
    } catch (error) {
      log('❌ 加载 Conversation ID 映射失败: ' + error.message, 'error');
      return {};
    }
  }

  /**
   * 保存 Conversation ID 映射 (到文件)
   * 参考 augment-account-manager 的实现
   */
  function saveConversationIdMappings() {
    try {
      if (!ensureStorageDir()) {
        return false;
      }

      const fs = require('fs');
      const path = require('path');
      const storageDir = getStorageDir();
      const mappingFile = path.join(storageDir, 'conversationids.json');

      // 将 Map 转换为对象
      const mappings = {};
      for (const [key, value] of conversationIdMap.entries()) {
        mappings[key] = value;
      }

      fs.writeFileSync(mappingFile, JSON.stringify(mappings, null, 2), 'utf8');
      log('✅ 成功保存 Conversation ID 映射，数量: ' + Object.keys(mappings).length);
      return true;
    } catch (error) {
      log('❌ 保存 Conversation ID 映射失败: ' + error.message, 'error');
      return false;
    }
  }

  /**
   * 获取或创建 Conversation ID 映射 (带持久化)
   * 参考 augment-account-manager 的实现
   */
  function getOrCreateConversationIdMapping(originalId) {
    log('🔍 [DEBUG] getOrCreateConversationIdMapping 被调用，原始 ID: ' + (originalId ? originalId.substring(0, 8) + '...' : 'null'), 'debug');
    log('🔍 [DEBUG] 调用堆栈: ' + new Error().stack.split('\n').slice(1, 4).join(' <- '), 'debug');

    if (!originalId || typeof originalId !== 'string') {
      log('⚠️ [DEBUG] Conversation ID 无效，返回原值', 'debug');
      return originalId;
    }

    // 检查是否是 UUID 格式
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(originalId)) {
      log('⚠️ [DEBUG] Conversation ID 不是 UUID 格式，返回原值', 'debug');
      return originalId;
    }

    // 如果已经映射过，返回映射的 ID
    if (conversationIdMap.has(originalId)) {
      const mappedId = conversationIdMap.get(originalId);
      log('♻️ 复用已有 Conversation ID 映射: ' + originalId.substring(0, 8) + '... → ' + mappedId.substring(0, 8) + '...');
      log('🔍 [DEBUG] 当前映射表大小: ' + conversationIdMap.size, 'debug');
      log('🔍 [DEBUG] 所有映射: ' + JSON.stringify(Array.from(conversationIdMap.entries()).map(([k, v]) => [k.substring(0, 8), v.substring(0, 8)])), 'debug');
      return mappedId;
    }

    // 生成新的随机 ID
    const newId = generateUUID();
    conversationIdMap.set(originalId, newId);

    log('🎲 新建 Conversation ID 映射: ' + originalId.substring(0, 8) + '... → ' + newId.substring(0, 8) + '...');
    log('🔍 [DEBUG] 映射表大小: ' + conversationIdMap.size, 'debug');
    log('🔍 [DEBUG] 所有映射: ' + JSON.stringify(Array.from(conversationIdMap.entries()).map(([k, v]) => [k.substring(0, 8), v.substring(0, 8)])), 'debug');

    // 保存到文件
    const saved = saveConversationIdMappings();
    if (saved) {
      log('✅ Conversation ID 映射已保存到文件');
    } else {
      log('❌ Conversation ID 映射保存失败', 'error');
    }

    return newId;
  }

  // ==================== 初始化持久化数据 ====================

  log('========================================');
  log('🚀 开始初始化持久化数据...');
  log('========================================');

  // 启动时加载 Session ID
  const loadedSessionId = loadSessionId();
  if (loadedSessionId) {
    FAKE_SESSION_ID = loadedSessionId;
    log('🔄 使用已保存的 Session ID: ' + FAKE_SESSION_ID);
  } else {
    // 保存新生成的 Session ID
    const saved = saveSessionId(FAKE_SESSION_ID);
    if (saved) {
      log('🆕 生成并保存新的 Session ID: ' + FAKE_SESSION_ID);
    } else {
      log('⚠️ 新 Session ID 保存失败，但仍将使用: ' + FAKE_SESSION_ID, 'warn');
    }
  }

  // 启动时加载 Conversation ID 映射
  const loadedMappings = loadConversationIdMappings();
  log('🔄 已加载 Conversation ID 映射，当前数量: ' + conversationIdMap.size);

  if (DEBUG_MODE && conversationIdMap.size > 0) {
    log('🔍 [DEBUG] 已加载的 Conversation ID 映射:', 'debug');
    conversationIdMap.forEach((fakeId, realId) => {
      log('  - ' + realId.substring(0, 8) + '... → ' + fakeId.substring(0, 8) + '...', 'debug');
    });
  }

  log('========================================');
  log('✅ 持久化数据初始化完成');
  log('========================================');

  // 伪造的硬件标识符
  const FAKE_IDENTIFIERS = {
    // macOS
    uuid: generateUUID(),
    serialNumber: 'C02' + Array.from({ length: 8 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
    ).join(''),
    macAddress: '00:' + Array.from({ length: 16 }, () =>
      '0123456789ABCDEF'[Math.floor(Math.random() * 16)]
    ).join(''),

    // Windows
    windowsGuid: '{' + [8, 4, 4, 4, 12].map(len =>
      Array.from({ length: len }, () =>
        '0123456789abcdef'[Math.floor(Math.random() * 16)]
      ).join('')
    ).join('-') + '}',
    productId: Array.from({ length: 20 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
    ).join(''),
    windowsSerial: Array.from({ length: 10 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
    ).join('')
  };

  // ==================== 拦截器配置 ====================

  /**
   * 必要端点白名单（参考 augment-account-manager）
   * 这些端点对核心功能至关重要，绝对不拦截
   */
  const ESSENTIAL_ENDPOINTS = [
    '/report-feature-vector',
    'batch-upload',
    'memorize',
    'completion',
    'chat-stream',
    'subscription-info',
    'get-models',
    'token',
    'codebase-retrieval',
    'agents/',
    'remote-agents',
    'list-stream',
    'augment-api',
    'augment-backend',
    'workspace-context',
    'symbol-index',
    'blob-upload',
    'codebase-upload',
    'file-sync',
    'is-user-configured',
    'list-repos'
  ];

  /**
   * 代码索引相关关键字（参考 augment-account-manager）
   * 保护代码索引功能
   */
  const CODE_INDEXING_KEYWORDS = [
    'batch-upload',
    'codebase-retrieval',
    'file-sync',
    'workspace-context',
    'symbol-index',
    'blob-upload',
    'codebase-upload',
    'agents/',
    'augment-api',
    'augment-backend'
  ];

  /**
   * 检查是否是必要端点
   */
  function isEssentialEndpoint(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    const lowerUrl = url.toLowerCase();
    return ESSENTIAL_ENDPOINTS.some(endpoint => lowerUrl.includes(endpoint.toLowerCase()));
  }

  /**
   * 检查是否是代码索引相关
   */
  function isCodeIndexingRelated(url, data) {
    if (!url && !data) {
      return false;
    }
    const searchText = ((url || '') + ' ' + (typeof data === 'string' ? data : JSON.stringify(data))).toLowerCase();
    return CODE_INDEXING_KEYWORDS.some(keyword => searchText.includes(keyword.toLowerCase()));
  }

  /**
   * 拦截器配置
   */
  const interceptorConfigs = {
    'chat-stream': {
      enabled: true,
      description: '聊天流端点拦截器 (风控绕过 + 上下文保留)',
    },
    'record-request-events': {
      enabled: true,
      description: '请求事件记录端点拦截器 (风控绕过)',
    },
    'report-feature-vector': {
      enabled: true,
      description: '特征向量报告端点拦截器',
    },
  };

  /**
   * 拦截器处理器
   */
  const interceptorHandlers = {
    'chat-stream': {
      shouldIntercept: function(url) {
        return typeof url === 'string' && url.includes('/chat-stream');
      },
      processRequest: function(requestData) {
        try {
          log('========================================');
          log('🔍 [DEBUG] chat-stream 拦截器触发', 'debug');
          log('🔍 [DEBUG] 请求 URL: ' + (requestData.url || 'unknown'), 'debug');

          let body = requestData.body || requestData.data;
          if (!body) {
            log('⚠️ [DEBUG] chat-stream 请求体为空', 'debug');
            log('========================================');
            return { type: 'skip' };
          }

          log('🔍 [DEBUG] 请求体类型: ' + typeof body, 'debug');
          log('🔍 [DEBUG] 请求体长度: ' + (typeof body === 'string' ? body.length : 'N/A'), 'debug');

          if (typeof body === 'string') {
            try {
              body = JSON.parse(body);
              log('🔍 [DEBUG] chat-stream 请求体已解析为 JSON', 'debug');
            } catch (e) {
              log('⚠️ [DEBUG] chat-stream 请求体 JSON 解析失败: ' + e.message, 'debug');
              log('========================================');
              return { type: 'skip' };
            }
          }

          // 调试模式：输出完整请求体结构
          if (DEBUG_MODE) {
            log('🔍 [DEBUG] chat-stream 请求体字段: ' + Object.keys(body).join(', '), 'debug');
            if (body.conversation_id) {
              log('🔍 [DEBUG] conversation_id: ' + body.conversation_id.substring(0, 8) + '...', 'debug');
            }
            if (body.blobs) {
              log('🔍 [DEBUG] blobs 数量: ' + (Array.isArray(body.blobs) ? body.blobs.length : 'not array'), 'debug');
            }
            if (body.message) {
              log('🔍 [DEBUG] message 长度: ' + (typeof body.message === 'string' ? body.message.length : 'not string'), 'debug');
            }
          }

          // ✅ 参考 augment-account-manager 的风控策略
          // 清空 blobs 数组（风控绕过）
          // 替换 conversation_id（风控绕过）
          // 但本地 LevelDB 存储不受影响，上下文仍然保留
          if (body && typeof body === 'object') {
            let modified = false;

            // 清空 blobs 数组
            if (body.blobs && Array.isArray(body.blobs)) {
              const blobsCount = body.blobs.length;
              body.blobs = [];
              modified = true;
              log('🧹 清理 chat-stream 数据: 已清空 ' + blobsCount + ' 个 blobs');
            } else {
              log('🔍 [DEBUG] chat-stream 请求体中没有 blobs 字段', 'debug');
            }

            // ⚠️ 不再替换 conversation_id!
            // 原因: conversation_id 用于在 LevelDB 中查找聊天记录
            // 如果替换了 conversation_id,会导致无法加载历史聊天记录,造成上下文丢失
            if (body.conversation_id && typeof body.conversation_id === 'string') {
              log('ℹ️ 保持 conversation_id 不变: ' + body.conversation_id.substring(0, 8) + '...');
            } else {
              log('⚠️ chat-stream 请求体中没有 conversation_id 字段（可能是新会话）', 'warn');
            }

            if (modified) {
              const newBody = JSON.stringify(body);
              log('✅ chat-stream 请求已修改，返回新的请求体');
              log('🔍 [DEBUG] 新请求体长度: ' + newBody.length, 'debug');
              log('========================================');
              return {
                type: 'modify',
                data: {
                  body: newBody
                }
              };
            } else {
              log('🔍 [DEBUG] chat-stream 请求未修改', 'debug');
              log('========================================');
            }
          }

          log('========================================');
          return { type: 'skip' };
        } catch (error) {
          log('❌ Error in chat-stream handler: ' + error.message, 'error');
          log('❌ Error stack: ' + error.stack, 'debug');
          log('========================================');
          return { type: 'skip' };
        }
      },
      isSpecial: true,
    },
    'record-request-events': {
      shouldIntercept: function(url) {
        return typeof url === 'string' && url.includes('record-request-events');
      },
      processRequest: function(requestData) {
        try {
          log('🔍 [DEBUG] record-request-events 拦截器触发', 'debug');

          let body = requestData.body || requestData.data;
          if (!body) {
            log('⚠️ [DEBUG] record-request-events 请求体为空', 'debug');
            return { type: 'skip' };
          }

          if (typeof body === 'string') {
            try {
              body = JSON.parse(body);
              log('🔍 [DEBUG] record-request-events 请求体已解析为 JSON', 'debug');
            } catch (e) {
              log('⚠️ [DEBUG] record-request-events 请求体 JSON 解析失败', 'debug');
              return { type: 'skip' };
            }
          }

          // ✅ 参考 augment-account-manager 的风控策略
          // 递归替换所有 conversation_id
          if (body && typeof body === 'object') {
            let replacementCount = 0;

            const processData = function(data) {
              if (Array.isArray(data)) {
                return data.map(item => processData(item));
              }
              if (data && typeof data === 'object') {
                const result = {};
                for (const [key, value] of Object.entries(data)) {
                  if (key === 'conversation_id' && typeof value === 'string') {
                    // ⚠️ 不再替换 conversation_id!
                    result[key] = value;  // 保持原值
                    log('ℹ️ record-request-events 保持 conversation_id 不变: ' + value.substring(0, 8) + '...');
                  } else {
                    result[key] = processData(value);
                  }
                }
                return result;
              }
              return data;
            };

            const processedBody = processData(body);

            if (replacementCount > 0) {
              log('✅ record-request-events 共替换 ' + replacementCount + ' 个 conversation_id');
              return {
                type: 'modify',
                data: {
                  body: JSON.stringify(processedBody)
                }
              };
            } else {
              log('🔍 [DEBUG] record-request-events 未发现需要替换的 conversation_id', 'debug');
            }
          }

          return { type: 'skip' };
        } catch (error) {
          log('❌ Error in record-request-events handler: ' + error.message, 'error');
          log('❌ Error stack: ' + error.stack, 'debug');
          return { type: 'skip' };
        }
      },
      isSpecial: true,
    },
    'report-feature-vector': {
      shouldIntercept: function(url) {
        return typeof url === 'string' && url.includes('report-feature-vector');
      },
      processRequest: function(requestData) {
        try {
          let body = requestData.body || requestData.data;
          if (!body) {
            return { type: 'skip' };
          }

          if (typeof body === 'string') {
            try {
              body = JSON.parse(body);
            } catch (e) {
              return { type: 'skip' };
            }
          }

          // 替换 Feature Vector
          const modifiedBody = replaceFeatureVectors(body);
          return {
            type: 'modify',
            data: {
              body: JSON.stringify(modifiedBody)
            }
          };
        } catch (error) {
          log('Error in report-feature-vector handler: ' + error.message, 'error');
          return { type: 'skip' };
        }
      },
      isSpecial: true,
    },
  };

  /**
   * 初始化拦截器
   */
  function initializeInterceptors() {
    log('========== Initializing Interceptors ==========');
    for (const [name, config] of Object.entries(interceptorConfigs)) {
      if (config.enabled) {
        const handler = interceptorHandlers[name];
        if (handler) {
          interceptorMap.set(name, handler);
          log(`✅ Registered: ${name} - ${config.description}`);
        }
      } else {
        log(`⏭️  Skipped: ${name} - ${config.description}`);
      }
    }
    log(`Total registered: ${interceptorMap.size} interceptors`);
    log('========================================');
  }

  // 初始化拦截器
  log('Loading interceptor module...');
  initializeInterceptors();

  // ==================== 工具函数 ====================
  
  /**
   * 生成 UUID v4
   */
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 生成伪造的 Machine ID
   */
  function generateFakeMachineId(realMachineId) {
    if (!realMachineId) {
      return Array.from({ length: 64 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
    }
    
    const chars = '0123456789abcdef';
    return Array.from({ length: realMachineId.length }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  /**
   * 生成伪造的 Feature Vector (64位十六进制)
   */
  function generateFakeFeatureVector() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * 判断是否为 UUID
   */
  function isUUID(value) {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  /**
   * 判断是否为 Session ID
   * 参考 augment-account-manager 的实现
   */
  function isSessionId(value) {
    if (typeof value !== 'string') return false;

    // UUID v4 格式
    if (isUUID(value)) return true;

    // 16位以上的字母数字下划线横线组合
    if (value.length >= 16 && /^[a-zA-Z0-9_-]+$/.test(value)) {
      return true;
    }

    return false;
  }

  /**
   * 判断是否为 Feature Vector
   */
  function isFeatureVector(value) {
    if (typeof value !== 'string') return false;
    // 64位十六进制哈希
    return /^[0-9a-f]{64}$/i.test(value);
  }

  /**
   * 递归替换对象中的 Conversation ID
   * ⚠️ 已禁用：替换 conversation_id 会导致上下文丢失
   */
  function replaceConversationIds(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => replaceConversationIds(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'conversation_id' && isUUID(value)) {
        // ✅ 不替换 conversation_id，保持原值以保留上下文
        result[key] = value;
      } else if (typeof value === 'object') {
        result[key] = replaceConversationIds(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * 统一的 Session ID 替换方法
   * 支持 Headers 对象和普通对象
   * 参考 augment-account-manager 的实现
   */
  function replaceSessionIds(headers) {
    if (!headers || typeof headers !== 'object') {
      return false;
    }

    let modified = false;
    const headerKey = 'x-request-session-id';

    // 支持 Headers 对象
    if (headers instanceof Headers) {
      if (headers.has(headerKey)) {
        const oldValue = headers.get(headerKey);
        if (isSessionId(oldValue)) {
          headers.set(headerKey, FAKE_SESSION_ID);
          log('🎭 替换 Headers 中的 ' + headerKey + ': ' + oldValue + ' → ' + FAKE_SESSION_ID);
          modified = true;
        }
      }
    }
    // 支持普通对象
    else {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === headerKey && isSessionId(value)) {
          const oldValue = headers[key];
          headers[key] = FAKE_SESSION_ID;
          log('🎭 替换对象中的 ' + key + ': ' + oldValue + ' → ' + FAKE_SESSION_ID);
          modified = true;
        }
      }
    }

    return modified;
  }

  /**
   * 替换 Feature Vector (只处理 feature_vector 字段)
   * 参考 augment-account-manager 的精确处理策略
   */
  function replaceFeatureVectors(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    // 只处理 feature_vector 字段
    if (obj.feature_vector && typeof obj.feature_vector === 'object') {
      const newFeatureVector = {};

      for (const [key, value] of Object.entries(obj.feature_vector)) {
        if (typeof value === 'string') {
          // 检测 64 字符 hex (可能带 # 前缀)
          const parts = value.split('#');
          const hash = parts.length > 1 ? parts[1] : parts[0];

          if (isFeatureVector(hash)) {
            // 替换 Feature Vector
            if (parts.length > 1) {
              newFeatureVector[key] = parts[0] + '#' + generateFakeFeatureVector();
            } else {
              newFeatureVector[key] = generateFakeFeatureVector();
            }
            log('🎭 替换 64 位特征哈希: ' + key);
          } else {
            newFeatureVector[key] = value;
          }
        } else {
          newFeatureVector[key] = value;
        }
      }

      obj.feature_vector = newFeatureVector;
    }

    return obj;
  }

  /**
   * 处理拦截的请求 (参考 release1 逻辑，但保留上下文)
   */
  function processInterceptedRequest(url, requestData) {
    try {
      let modified = false;

      // 调试：记录所有请求
      if (DEBUG_MODE && url && (url.includes('chat-stream') || url.includes('record-request-events'))) {
        log('========================================');
        log('🔍 [DEBUG] processInterceptedRequest 被调用', 'debug');
        log('🔍 [DEBUG] URL: ' + url, 'debug');
        log('🔍 [DEBUG] 请求数据: ' + JSON.stringify({
          hasHeaders: !!requestData.headers,
          hasBody: !!requestData.body,
          hasData: !!requestData.data,
          bodyType: typeof requestData.body,
          dataType: typeof requestData.data
        }), 'debug');
      }

      // 1. 替换 Session ID (Headers) - 使用统一方法
      if (requestData.headers) {
        if (replaceSessionIds(requestData.headers)) {
          modified = true;
          log('✅ Session ID 已替换');
        }
      }

      // 2. 替换 Feature Vector (Headers)
      if (requestData.headers && requestData.headers['x-signature-vector']) {
        const vector = requestData.headers['x-signature-vector'];
        if (isFeatureVector(vector)) {
          requestData.headers['x-signature-vector'] = generateFakeFeatureVector();
          modified = true;
          log('✅ Feature Vector 已替换');
        }
      }

      // 3. 使用拦截器处理请求体 (参考 release1 的 type 判断逻辑)
      log('🔍 [DEBUG] 开始遍历拦截器，总数: ' + interceptorMap.size, 'debug');
      for (const [name, handler] of interceptorMap) {
        log('🔍 [DEBUG] 检查拦截器: ' + name, 'debug');
        log('🔍 [DEBUG] shouldIntercept 结果: ' + handler.shouldIntercept(url), 'debug');

        if (handler.shouldIntercept(url)) {
          log('🎯 拦截器匹配: ' + name);
          log('🔍 [DEBUG] isSpecial: ' + handler.isSpecial, 'debug');

          if (handler.isSpecial) {
            log('🔍 [DEBUG] 调用 ' + name + ' 拦截器的 processRequest', 'debug');
            const result = handler.processRequest(requestData);

            log('🔍 [DEBUG] ' + name + ' 拦截器返回: ' + JSON.stringify(result ? { type: result.type, hasData: !!result.data } : null), 'debug');

            // ✅ 使用 release1 的判断逻辑: type === 'modify'
            if (result && result.type === 'modify' && result.data) {
              log('✅ ' + name + ' 拦截器返回了修改结果');

              // 更新请求体
              if (typeof result.data === 'object' && result.data.body) {
                log('🔍 [DEBUG] 更新请求体 (object.body)', 'debug');
                requestData.body = result.data.body;
                requestData.data = result.data.body;
                modified = true;
              } else if (typeof result.data === 'string') {
                log('🔍 [DEBUG] 更新请求体 (string)', 'debug');
                requestData.body = result.data;
                requestData.data = result.data;
                modified = true;
              }
              log(`✅ Request processed by ${name} interceptor`);
            } else {
              log('⚠️ ' + name + ' 拦截器未返回修改结果', 'warn');
            }
          } else {
            log('⚠️ ' + name + ' 拦截器不是 special 类型', 'warn');
          }
        }
      }

      // ✅ 修复:返回正确的格式 { type: 'modify'/'skip', data: requestData }
      if (modified) {
        log('✅ processInterceptedRequest 返回修改结果');
        log('========================================');
        return {
          type: 'modify',
          data: requestData
        };
      }

      log('⚠️ processInterceptedRequest 返回跳过结果');
      log('========================================');
      return { type: 'skip' };
    } catch (error) {
      log('❌ Error processing request: ' + error.message, 'error');
      log('❌ Error stack: ' + error.stack, 'error');
      log('========================================');
      return { type: 'skip' };
    }
  }

  /**
   * 伪造 ioreg 输出 (macOS)
   */
  function spoofIoregOutput(output) {
    if (!output || typeof output !== 'string') return output;

    let result = output;

    // 替换 IOPlatformUUID
    result = result.replace(
      /"IOPlatformUUID"\s*=\s*"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"/g,
      `"IOPlatformUUID" = "${FAKE_IDENTIFIERS.uuid}"`
    );

    // 替换 IOPlatformSerialNumber
    result = result.replace(
      /"IOPlatformSerialNumber"\s*=\s*"[A-Z0-9]+"/g,
      `"IOPlatformSerialNumber" = "${FAKE_IDENTIFIERS.serialNumber}"`
    );

    // 替换 board-id
    result = result.replace(
      /"board-id"\s*=\s*<"Mac-[0-9A-Fa-f]+">/g,
      `"board-id" = <"Mac-${FAKE_IDENTIFIERS.macAddress}">`
    );

    return result;
  }

  /**
   * 伪造 Windows 注册表输出
   */
  function spoofWindowsRegistryOutput(output) {
    if (!output || typeof output !== 'string') return output;

    let result = output;

    // 替换 MachineGuid
    result = result.replace(
      /(MachineGuid\s+REG_SZ\s+)\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g,
      '$1' + FAKE_IDENTIFIERS.windowsGuid
    );

    // 替换 ProductId
    result = result.replace(
      /(ProductId\s+REG_SZ\s+)[A-Z0-9\-]+/g,
      '$1' + FAKE_IDENTIFIERS.productId
    );

    // 替换 SerialNumber
    result = result.replace(
      /(SerialNumber\s+REG_SZ\s+)[A-Z0-9]+/g,
      '$1' + FAKE_IDENTIFIERS.windowsSerial
    );

    return result;
  }

  /**
   * 伪造 Git 输出 (隐藏 Git 信息)
   */
  function spoofGitOutput(command, output) {
    // 如果是 git 命令,返回空字符串
    if (command && typeof command === 'string' && command.includes('git ')) {
      return '';
    }
    return output;
  }

  // ==================== 拦截 require() ====================

  log('Initializing interceptors...');

  const originalRequire = require;
  require = function(moduleName) {
    const module = originalRequire.apply(this, arguments);

    // 拦截 http/https
    if (moduleName === 'http' || moduleName === 'https') {
      const originalRequest = module.request;
      module.request = function(url, options) {
        const fullUrl = url.href || url.protocol + '//' + (url.hostname || url.host) + (url.path || '');
        const requestData = {
          url: fullUrl,
          method: url.method || 'GET',
          headers: url.headers || {},
          body: null,
          data: null
        };

        const req = originalRequest.apply(this, arguments);
        const originalWrite = req.write;
        const originalEnd = req.end;

        req.write = function(chunk) {
          if (chunk) {
            requestData.body = (requestData.body || '') + chunk.toString();
            requestData.data = requestData.body;
          }
          return originalWrite.apply(this, arguments);
        };

        // 拦截 Session ID (Headers) - 使用统一方法
        if (url.headers) {
          replaceSessionIds(url.headers);
        }

        req.end = function(chunk) {
          if (chunk) {
            requestData.body = (requestData.body || '') + chunk.toString();
            requestData.data = requestData.body;
          }

          // 处理拦截 (参考 release1 逻辑)
          const processed = processInterceptedRequest(fullUrl, requestData);

          // ✅ 修复：正确检查返回值格式
          let finalChunk = chunk;
          if (processed.type === 'modify' && processed.data) {
            if (processed.data.body) {
              finalChunk = processed.data.body;
            } else if (typeof processed.data === 'string') {
              finalChunk = processed.data;
            }
          }

          // ✅ 修复：使用 call 而不是 apply
          return originalEnd.call(this, finalChunk);
        };

        return req;
      };
    }

    // 拦截 axios (参考 release1 逻辑)
    if (moduleName === 'axios' && module.interceptors && module.interceptors.request) {
      module.interceptors.request.use(
        function(config) {
          const requestData = {
            url: config.url,
            method: config.method,
            headers: config.headers || {},
            body: config.data || null,
            data: config.data || null
          };

          // 处理拦截
          const processed = processInterceptedRequest(config.url, requestData);

          // ✅ 修复：正确检查返回值格式
          if (processed.type === 'modify' && processed.data) {
            // 更新 headers（Session ID 已在 processInterceptedRequest 中处理）
            if (processed.data.headers) {
              config.headers = processed.data.headers;
            }

            // 更新 body
            if (processed.data.body) {
              config.data = processed.data.body;
            } else if (processed.data.data) {
              config.data = processed.data.data;
            }
          }

          return config;
        },
        function(error) {
          return Promise.reject(error);
        }
      );
    }

    // 拦截 child_process
    if (moduleName === 'child_process') {
      const originalExec = module.exec;
      const originalExecSync = module.execSync;
      const originalSpawn = module.spawn;

      module.exec = function(command, options, callback) {
        if (typeof command === 'string') {
          return originalExec.apply(this, [command, options, function(error, stdout, stderr) {
            if (error) {
              // Git 命令返回空
              if (command.includes('git ')) {
                return callback(null, '', stderr || '');
              }
              return callback(error, stdout, stderr);
            }

            if (stdout) {
              let spoofed = '';
              let modified = false;

              // 伪造 ioreg 输出
              if (command.includes('ioreg')) {
                spoofed = spoofIoregOutput(stdout);
                modified = true;
              }
              // 伪造 Git 输出
              else if (command.includes('git ')) {
                spoofed = spoofGitOutput(command, stdout);
                modified = true;
              }
              // 伪造 Windows 注册表输出
              else if (command.includes('REG.exe QUERY') || command.includes('reg query') ||
                       command.includes('wmic') || command.includes('systeminfo')) {
                spoofed = spoofWindowsRegistryOutput(stdout);
                modified = true;
              }

              callback(null, modified ? spoofed : stdout, stderr);
            } else {
              callback(null, '', stderr || '');
            }
          }]);
        }
        return originalExec.apply(this, arguments);
      };

      module.execSync = function(command, options) {
        if (typeof command !== 'string') {
          return originalExecSync.apply(this, arguments);
        }

        try {
          const result = originalExecSync.apply(this, arguments);
          if (result && result.length > 0) {
            const output = result.toString();
            let spoofed = '';
            let modified = false;

            // 伪造 ioreg 输出
            if (command.includes('ioreg')) {
              spoofed = spoofIoregOutput(output);
              modified = true;
            }
            // 伪造 Git 输出
            else if (command.includes('git ')) {
              spoofed = spoofGitOutput(command, output);
              modified = true;
            }
            // 伪造 Windows 注册表输出
            else if (command.includes('REG.exe QUERY') || command.includes('reg query') ||
                     command.includes('wmic') || command.includes('systeminfo')) {
              spoofed = spoofWindowsRegistryOutput(output);
              modified = true;
            }

            return Buffer.from(modified ? spoofed : output);
          }
          return Buffer.from('');
        } catch (error) {
          // Git 命令返回空
          if (command.includes('git ')) {
            return Buffer.from('');
          }
          throw error;
        }
      };

      // ✅ 修复：添加 spawn 拦截逻辑
      // Git 命令统计（仅调试模式输出）
      let gitCommandStats = {};
      let gitStatsTimer = null;

      module.spawn = function(command, args, options) {
        // spawn 通常用于长时间运行的进程，不适合直接修改输出
        // 只在调试模式下记录 Git 命令统计
        if (DEBUG_MODE && typeof command === 'string' && command.includes('git')) {
          const argsStr = (args || []).join(' ');
          const fullCommand = command + ' ' + argsStr;

          // 统计命令次数
          if (!gitCommandStats[fullCommand]) {
            gitCommandStats[fullCommand] = 0;
          }
          gitCommandStats[fullCommand]++;

          // 清除之前的定时器
          if (gitStatsTimer) {
            clearTimeout(gitStatsTimer);
          }

          // 延迟 5 秒输出统计，避免频繁日志
          gitStatsTimer = setTimeout(() => {
            const totalCommands = Object.values(gitCommandStats).reduce((a, b) => a + b, 0);
            if (totalCommands > 0) {
              log('🔍 [DEBUG] Git 命令统计（最近 5 秒）: 共 ' + totalCommands + ' 次', 'debug');

              // 只显示前 3 个最频繁的命令
              const sortedCommands = Object.entries(gitCommandStats)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

              sortedCommands.forEach(([cmd, count]) => {
                if (count > 1) {
                  log('  - ' + cmd + ' (×' + count + ')', 'debug');
                }
              });
            }
            gitCommandStats = {};
          }, 5000);
        }
        return originalSpawn.apply(this, arguments);
      };
    }

    return module;
  };

  // ==================== 拦截 global.fetch (参考 release1 逻辑) ====================

  if (typeof global !== 'undefined' && global.fetch && !global._fetchIntercepted) {
    const originalFetch = global.fetch;
    global.fetch = async function(url, options = {}) {
      try {
        const modifiedOptions = { ...options };
        const requestData = {
          url: url,
          method: modifiedOptions.method || 'GET',
          headers: modifiedOptions.headers || {},
          body: modifiedOptions.body || null,
          data: modifiedOptions.body || null
        };

        // 处理拦截
        const processed = processInterceptedRequest(url, requestData);

        // ✅ 使用 release1 的逻辑处理返回值
        if (processed.data) {
          if (typeof processed.data === 'object' && processed.data.body) {
            modifiedOptions.body = processed.data.body;
          } else if (typeof processed.data === 'string') {
            modifiedOptions.body = processed.data;
          }
        }

        // 替换 Session ID (Headers) - 使用统一方法
        if (modifiedOptions.headers) {
          const headers = new Headers(modifiedOptions.headers);
          replaceSessionIds(headers);
          modifiedOptions.headers = headers;
        }

        return originalFetch.call(this, url, modifiedOptions);
      } catch (error) {
        log('Error in fetch interceptor: ' + error.message, 'error');
        return originalFetch.call(this, url, options);
      }
    };

    Object.setPrototypeOf(global.fetch, originalFetch);
    Object.defineProperty(global.fetch, 'name', { value: 'fetch' });
    global._fetchIntercepted = true;
  }

  // ==================== 拦截 XMLHttpRequest ====================

  if (typeof XMLHttpRequest !== 'undefined' && !XMLHttpRequest._intercepted) {
    const OriginalXMLHttpRequest = XMLHttpRequest;
    global.XMLHttpRequest = class extends OriginalXMLHttpRequest {
      constructor() {
        super();
        this._augment_url = null;
        this._augment_method = null;
        this._augment_headers = {};
      }

      open(method, url, async, user, password) {
        this._augment_url = url;
        this._augment_method = method;
        return super.open(method, url, async, user, password);
      }

      setRequestHeader(name, value) {
        this._augment_headers = this._augment_headers || {};
        this._augment_headers[name] = value;

        // 替换 Session ID - 使用统一判断逻辑
        if (name.toLowerCase() === 'x-request-session-id' && isSessionId(value)) {
          log('🎭 替换 XHR 中的 ' + name + ': ' + value + ' → ' + FAKE_SESSION_ID);
          return super.setRequestHeader(name, FAKE_SESSION_ID);
        }

        return super.setRequestHeader(name, value);
      }

      async send(body) {
        try {
          const requestData = {
            url: this._augment_url,
            method: this._augment_method,
            headers: this._augment_headers || {},
            body: body || null,
            data: body || null
          };

          // 处理拦截 (参考 release1 逻辑)
          const processed = processInterceptedRequest(this._augment_url, requestData);

          // ✅ 使用 release1 的逻辑处理返回值
          if (processed.data) {
            if (typeof processed.data === 'object' && processed.data.body) {
              body = processed.data.body;
            } else if (typeof processed.data === 'string') {
              body = processed.data;
            }
          } else if (processed.body) {
            body = processed.body;
          }
        } catch (error) {
          log('Error in XMLHttpRequest interceptor: ' + error.message, 'error');
        }

        return super.send(body);
      }
    };

    XMLHttpRequest._intercepted = true;
  }

  // ==================== 拦截 vscode.env.machineId ====================

  try {
    const vscode = require('vscode');
    if (vscode && vscode.env && vscode.env.machineId) {
      const realMachineId = vscode.env.machineId;
      const fakeMachineId = generateFakeMachineId(realMachineId);

      Object.defineProperty(vscode.env, 'machineId', {
        get: () => fakeMachineId,
        configurable: true
      });

      log('Machine ID intercepted');
      log('Real Machine ID: ' + realMachineId.substring(0, 8) + '...');
      log('Fake Machine ID: ' + fakeMachineId.substring(0, 8) + '...');
    }
  } catch (e) {
    // vscode 模块可能不存在
  }

  // ==================== 导出 ====================

  log('All interceptors initialized');
  log('Fake Session ID: ' + FAKE_SESSION_ID);

  /**
   * 创建扩展包装器
   */
  function createExtensionWrapper(extension = {}) {
    return {
      ...extension,
      activate: async function(context) {
        try {
          if (extension.activate && typeof extension.activate === 'function') {
            await extension.activate(context);
            log('Original activate function executed');
          }
          log('Extension wrapper activated');
        } catch (error) {
          log('Error in activate wrapper: ' + error.message, 'error');
          throw error;
        }
      },
      deactivate: function() {
        try {
          if (extension.deactivate && typeof extension.deactivate === 'function') {
            extension.deactivate();
            log('Original deactivate function executed');
          }
          log('Extension wrapper deactivated');
        } catch (error) {
          log('Error in deactivate wrapper: ' + error.message, 'error');
        }
      }
    };
  }

  // 导出模块
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      processInterceptedRequest,
      FAKE_SESSION_ID,
      FAKE_IDENTIFIERS,
      isSessionId,
      updateFakeSessionId: function(newId) {
        if (newId && typeof newId === 'string') {
          FAKE_SESSION_ID = newId;
          log('SessionId updated to: ' + newId);
          return true;
        }
        return false;
      },
      getCurrentSessionId: function() {
        return FAKE_SESSION_ID;
      },
      spoofIoregOutput,
      spoofWindowsRegistryOutput,
      spoofGitOutput,
      createExtensionWrapper,
      wrapAsExtension: function(extension) {
        return createExtensionWrapper(extension);
      }
    };
  }

  // ========================================
  // Fetch API 拦截初始化
  // ========================================

  /**
   * 初始化 Fetch API 拦截
   * 参考 augment-account-manager 的实现
   */
  function initializeFetchInterceptor() {
    try {
      const globalObj = typeof global !== 'undefined' ? global :
                        typeof window !== 'undefined' ? window : this;

      if (!globalObj.fetch) {
        log('⚠️ Fetch API 不存在，跳过拦截', 'warn');
        return false;
      }

      // ⚠️ 防止双重拦截
      if (globalObj._fetchIntercepted) {
        log('ℹ️ Fetch API 已被拦截，跳过重复拦截');
        return true;
      }

      const originalFetch = globalObj.fetch;

      globalObj.fetch = function(url, options = {}) {
        try {
          const urlStr = url.toString();

          if (DEBUG_MODE) {
            log('🔍 [DEBUG] Fetch 请求: ' + urlStr, 'debug');
          }

          // 检查是否需要拦截
          const shouldIntercept = urlStr.includes('/chat-stream') ||
                                  urlStr.includes('/record-request-events') ||
                                  urlStr.includes('/report-feature-vector');

          if (shouldIntercept) {
            log('🎯 检测到需要拦截的请求: ' + urlStr);
            log('🔍 [DEBUG] options.body 存在: ' + (!!options.body), 'debug');
            log('🔍 [DEBUG] options.body 类型: ' + typeof options.body, 'debug');

            if (options.body) {
              log('🔍 [DEBUG] 拦截 Fetch 请求: ' + urlStr, 'debug');

              // 创建请求数据对象
              const requestData = {
                url: urlStr,
                headers: options.headers || {},
                body: options.body,
                method: options.method || 'POST'
              };

              log('🔍 [DEBUG] processInterceptedRequest 被调用', 'debug');

              // 调用拦截器处理
              const result = processInterceptedRequest(urlStr, requestData);

              log('🔍 [DEBUG] processInterceptedRequest 返回: ' + JSON.stringify(result ? { type: result.type, hasData: !!result.data } : null), 'debug');

              // 检查是否需要修改
              if (result && result.type === 'modify' && result.data) {
                // 更新 options.body
                if (result.data.body && result.data.body !== options.body) {
                  log('🔄 正在修改 Fetch 请求体...');
                  options.body = result.data.body;
                  log('✅ Fetch 请求体已修改');
                }

                // 更新 options.headers
                if (result.data.headers && result.data.headers !== options.headers) {
                  log('🔄 正在修改 Fetch 请求头...');
                  options.headers = result.data.headers;
                  log('✅ Fetch 请求头已修改');
                }
              } else {
                log('⚠️ processInterceptedRequest 未返回修改结果', 'warn');
              }
            } else {
              log('⚠️ 需要拦截的请求但没有 body: ' + urlStr, 'warn');
            }
          }

          // 调用原始 fetch
          return originalFetch.call(this, url, options);
        } catch (error) {
          log('❌ Fetch 拦截错误: ' + error.message, 'error');
          if (DEBUG_MODE) {
            log('❌ 错误堆栈: ' + error.stack, 'error');
          }
          // 出错时调用原始 fetch
          return originalFetch.call(this, url, options);
        }
      };

      // 设置标志防止双重拦截
      globalObj._fetchIntercepted = true;

      log('✅ Fetch API 拦截已初始化');
      return true;
    } catch (error) {
      log('❌ Fetch API 拦截初始化失败: ' + error.message, 'error');
      return false;
    }
  }

  /**
   * 初始化 XMLHttpRequest 拦截
   * 参考 augment-account-manager 的实现
   */
  function initializeXHRInterceptor() {
    try {
      const globalObj = typeof global !== 'undefined' ? global :
                        typeof window !== 'undefined' ? window : this;

      if (!globalObj.XMLHttpRequest) {
        log('⚠️ XMLHttpRequest 不存在，跳过拦截', 'warn');
        return false;
      }

      const OriginalXHR = globalObj.XMLHttpRequest;

      globalObj.XMLHttpRequest = function() {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;

        xhr.open = function(method, url, async, user, password) {
          this._method = method;
          this._url = url;

          if (DEBUG_MODE) {
            log('🔍 [DEBUG] XHR 请求: ' + method + ' ' + url, 'debug');
          }

          return originalOpen.apply(this, arguments);
        };

        xhr.send = function(body) {
          try {
            const urlStr = this._url || '';
            const shouldIntercept = urlStr.includes('/chat-stream') ||
                                    urlStr.includes('/record-request-events') ||
                                    urlStr.includes('/report-feature-vector');

            if (shouldIntercept && body) {
              if (DEBUG_MODE) {
                log('🔍 [DEBUG] 拦截 XHR 请求: ' + urlStr, 'debug');
              }

              // 创建请求数据对象
              const requestData = {
                url: urlStr,
                headers: {},
                body: body,
                method: this._method || 'POST'
              };

              // 调用拦截器处理
              const result = processInterceptedRequest(urlStr, requestData);

              // 检查是否需要修改
              if (result && result.type === 'modify' && result.data) {
                // 使用修改后的 body
                if (result.data.body && result.data.body !== body) {
                  body = result.data.body;
                  if (DEBUG_MODE) {
                    log('🔍 [DEBUG] XHR 请求体已修改', 'debug');
                  }
                }
              }
            }
          } catch (error) {
            log('❌ XHR 拦截错误: ' + error.message, 'error');
          }

          return originalSend.call(this, body);
        };

        return xhr;
      };

      log('✅ XMLHttpRequest 拦截已初始化');
      return true;
    } catch (error) {
      log('❌ XMLHttpRequest 拦截初始化失败: ' + error.message, 'error');
      return false;
    }
  }

  // ========================================
  // 立即执行初始化
  // ========================================

  log('========================================');
  log('🚀 开始初始化网络拦截器...');
  log('========================================');

  const fetchInitialized = initializeFetchInterceptor();
  const xhrInitialized = initializeXHRInterceptor();

  if (fetchInitialized || xhrInitialized) {
    log('========================================');
    log('✅ 网络拦截器初始化完成');
    log('   - Fetch API: ' + (fetchInitialized ? '✅' : '❌'));
    log('   - XMLHttpRequest: ' + (xhrInitialized ? '✅' : '❌'));
    log('========================================');
  } else {
    log('⚠️ 警告: 所有网络拦截器初始化失败', 'warn');
  }

  // 全局导出（与 module.exports 保持一致）
  if (typeof global !== 'undefined') {
    global.AugmentInterceptor = {
      processInterceptedRequest,
      FAKE_SESSION_ID,
      FAKE_IDENTIFIERS,
      isSessionId,
      updateFakeSessionId: function(newId) {
        if (newId && typeof newId === 'string') {
          FAKE_SESSION_ID = newId;
          log('🔄 更新 Session ID: ' + newId);

          // 保存到文件
          saveSessionId(newId);

          return true;
        }
        return false;
      },
      getCurrentSessionId: function() {
        return FAKE_SESSION_ID;
      },
      getConversationIdMapping: function(originalId) {
        return conversationIdMap.get(originalId) || null;
      },
      getAllConversationIdMappings: function() {
        const mappings = {};
        for (const [key, value] of conversationIdMap.entries()) {
          mappings[key] = value;
        }
        return mappings;
      },
      clearConversationIdMappings: function() {
        conversationIdMap.clear();
        saveConversationIdMappings();
        log('🗑️ 已清空所有 Conversation ID 映射');
      },
      spoofIoregOutput,
      spoofWindowsRegistryOutput,
      spoofGitOutput,
      createExtensionWrapper,
      wrapAsExtension: function(extension) {
        return createExtensionWrapper(extension);
      }
    };
  }

})();
