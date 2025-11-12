/**
 * 网络拦截器 - 核心风控绕过模块
 * 基于官方 v0.633.0 分析 + AugmentInjectoer_release1 解密
 *
 * 功能:
 * 1. URI 深链接拦截 (支持 /autoAuth 和 /push-login)
 * 2. Session ID 替换
 * 3. Machine ID 伪造
 * 4. Feature Vector 替换
 * 5. Conversation ID 替换
 * 6. 硬件标识符伪造
 * 7. Git 输出隐藏
 * 8. 保留聊天上下文 (不清除 Blob 数据)
 */

(function() {
  'use strict';

  // ==================== URI 深链接拦截器 ====================

  try {
    const vscode = require('vscode');

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
            path === 'push-login' ||
            path === '/autoAuth/push-login' ||
            path === 'autoAuth/push-login'
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
                console.warn('[AugmentCompositeUri] Custom handler failed:', error);
              } catch (e) {}
            }

            // 否则使用原始处理器
            try {
              return handler && typeof handler.handleUri === 'function'
                ? handler.handleUri(uri)
                : undefined;
            } catch (error) {
              try {
                console.warn('[AugmentCompositeUri] Delegate handler failed:', error);
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
            console.log('[AugmentCompositeUri] Custom URI handler registered');
          }
        };

        /**
         * 获取当前自定义 URI 处理器
         */
        globalObj.Augment.getUriHandler = function() {
          return customUriHandler;
        };
      }

      console.log('[AugmentCompositeUri] URI interceptor initialized');
    }
  } catch (error) {
    console.error('[AugmentCompositeUri] Failed to initialize URI interceptor:', error);
  }

  // ==================== 全局变量 ====================
  
  // 伪造的 Session ID
  let FAKE_SESSION_ID = generateUUID();
  
  // Conversation ID 映射表
  const conversationIdMap = new Map();
  
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
   */
  function isSessionId(value) {
    if (typeof value !== 'string') return false;
    // UUID v4 格式
    if (isUUID(value)) return true;
    // 32位十六进制格式
    if (/^[0-9a-f]{32}$/i.test(value)) return true;
    // 包含 "session" 关键字
    if (value.toLowerCase().includes('session')) return true;
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
        // 替换 Conversation ID
        if (!conversationIdMap.has(value)) {
          conversationIdMap.set(value, generateUUID());
        }
        result[key] = conversationIdMap.get(value);
      } else if (typeof value === 'object') {
        result[key] = replaceConversationIds(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * 递归替换对象中的 Feature Vector
   */
  function replaceFeatureVectors(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => replaceFeatureVectors(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // 检测 64 字符 hex (可能带 # 前缀)
        const parts = value.split('#');
        const hash = parts.length > 1 ? parts[1] : parts[0];

        if (isFeatureVector(hash)) {
          // 替换 Feature Vector
          if (parts.length > 1) {
            result[key] = parts[0] + '#' + generateFakeFeatureVector();
          } else {
            result[key] = generateFakeFeatureVector();
          }
        } else {
          result[key] = value;
        }
      } else if (typeof value === 'object') {
        result[key] = replaceFeatureVectors(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * 处理拦截的请求
   */
  function processInterceptedRequest(url, requestData) {
    try {
      // 1. 替换 Session ID (Headers)
      if (requestData.headers) {
        for (const [key, value] of Object.entries(requestData.headers)) {
          if (key.toLowerCase() === 'x-request-session-id' && isSessionId(value)) {
            requestData.headers[key] = FAKE_SESSION_ID;
          }
        }
      }

      // 2. 替换 Feature Vector (Headers)
      if (requestData.headers && requestData.headers['x-signature-vector']) {
        const vector = requestData.headers['x-signature-vector'];
        if (isFeatureVector(vector)) {
          requestData.headers['x-signature-vector'] = generateFakeFeatureVector();
        }
      }

      // 3. 处理请求体
      if (requestData.body || requestData.data) {
        let bodyStr = requestData.body || requestData.data;
        if (typeof bodyStr !== 'string') {
          bodyStr = JSON.stringify(bodyStr);
        }

        try {
          let body = JSON.parse(bodyStr);

          // 3.1 record-request-events: 替换 Conversation ID
          if (url.includes('record-request-events')) {
            body = replaceConversationIds(body);
          }

          // 3.2 report-feature-vector: 替换 Feature Vector
          if (url.includes('report-feature-vector')) {
            body = replaceFeatureVectors(body);
          }

          // 3.3 chat-stream: 保留 Blob 数据 (不清除)
          // 注意: 这里不做任何修改,保持原样以保留聊天上下文

          // 更新请求体
          const newBodyStr = JSON.stringify(body);
          if (requestData.body) {
            requestData.body = newBodyStr;
          }
          if (requestData.data) {
            requestData.data = newBodyStr;
          }
        } catch (e) {
          // 如果不是 JSON,保持原样
        }
      }

      return requestData;
    } catch (error) {
      console.error('[AugmentInterceptor] Error processing request:', error);
      return requestData;
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

  console.log('[AugmentInterceptor] Initializing interceptors...');

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

        // 拦截 Session ID (Headers)
        if (url.headers) {
          for (const [key, value] of Object.entries(url.headers)) {
            if (key.toLowerCase() === 'x-request-session-id' && isSessionId(value)) {
              url.headers[key] = FAKE_SESSION_ID;
              break;
            }
          }
        }

        req.end = function(chunk) {
          if (chunk) {
            requestData.body = (requestData.body || '') + chunk.toString();
            requestData.data = requestData.body;
          }

          // 处理拦截
          const processed = processInterceptedRequest(fullUrl, requestData);
          if (processed.body && processed.body !== requestData.body) {
            chunk = processed.body;
          } else if (processed.data && typeof processed.data === 'string') {
            chunk = processed.data;
          }

          return originalEnd.apply(this, chunk);
        };

        return req;
      };
    }

    // 拦截 axios
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

          if (processed.data) {
            if (typeof processed.data === 'object' && processed.data.body) {
              config.data = processed.data.body;
            } else if (typeof processed.data === 'string') {
              config.data = processed.data;
            }
          }

          // 替换 Session ID (Headers)
          if (config.headers && config.headers['x-request-session-id']) {
            if (isSessionId(config.headers['x-request-session-id'])) {
              config.headers['x-request-session-id'] = FAKE_SESSION_ID;
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

      module.spawn = function(command, args, options) {
        return originalSpawn.apply(this, arguments);
      };
    }

    return module;
  };

  // ==================== 拦截 global.fetch ====================

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

        if (processed.data) {
          if (typeof processed.data === 'object' && processed.data.body) {
            modifiedOptions.body = processed.data.body;
          } else if (typeof processed.data === 'string') {
            modifiedOptions.body = processed.data;
          }
        }

        // 替换 Session ID (Headers)
        if (modifiedOptions.headers) {
          const headers = new Headers(modifiedOptions.headers);
          if (headers.has('x-request-session-id')) {
            if (isSessionId(headers.get('x-request-session-id'))) {
              headers.set('x-request-session-id', FAKE_SESSION_ID);
            }
          }
          modifiedOptions.headers = headers;
        }

        return originalFetch.apply(this, [url, modifiedOptions]);
      } catch (error) {
        console.error('[AugmentInterceptor] Error in fetch interceptor:', error);
        return originalFetch.apply(this, [url, options]);
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

        // 替换 Session ID
        if (name.toLowerCase() === 'x-request-session-id' && isSessionId(value)) {
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

          // 处理拦截
          const processed = processInterceptedRequest(this._augment_url, requestData);

          if (processed.data) {
            if (typeof processed.data === 'object' && processed.data.body) {
              body = processed.data.body;
            } else if (typeof processed.data === 'string') {
              body = processed.data;
            }
          }
        } catch (error) {
          console.error('[AugmentInterceptor] Error in XMLHttpRequest interceptor:', error);
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

      console.log('[AugmentInterceptor] Machine ID intercepted');
      console.log('[AugmentInterceptor] Real Machine ID:', realMachineId.substring(0, 8) + '...');
      console.log('[AugmentInterceptor] Fake Machine ID:', fakeMachineId.substring(0, 8) + '...');
    }
  } catch (e) {
    // vscode 模块可能不存在
  }

  // ==================== 导出 ====================

  console.log('[AugmentInterceptor] All interceptors initialized');
  console.log('[AugmentInterceptor] Fake Session ID:', FAKE_SESSION_ID);

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
            console.log('[AugmentInterceptor] Original activate function executed');
          }
          console.log('[AugmentInterceptor] Extension wrapper activated');
        } catch (error) {
          console.error('[AugmentInterceptor] Error in activate wrapper:', error);
          throw error;
        }
      },
      deactivate: function() {
        try {
          if (extension.deactivate && typeof extension.deactivate === 'function') {
            extension.deactivate();
            console.log('[AugmentInterceptor] Original deactivate function executed');
          }
          console.log('[AugmentInterceptor] Extension wrapper deactivated');
        } catch (error) {
          console.error('[AugmentInterceptor] Error in deactivate wrapper:', error);
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
          console.log('[AugmentInterceptor] SessionId updated to:', newId);
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

  // 全局导出
  if (typeof global !== 'undefined') {
    global.AugmentInterceptor = {
      processInterceptedRequest,
      FAKE_SESSION_ID,
      FAKE_IDENTIFIERS,
      updateFakeSessionId: function(newId) {
        if (newId && typeof newId === 'string') {
          FAKE_SESSION_ID = newId;
          return true;
        }
        return false;
      },
      getCurrentSessionId: function() {
        return FAKE_SESSION_ID;
      },
      createExtensionWrapper,
      wrapAsExtension: function(extension) {
        return createExtensionWrapper(extension);
      }
    };
  }

})();
