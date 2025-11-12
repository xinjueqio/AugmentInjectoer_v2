/**
 * Token Login Enhanced - 清晰版本
 * 基于 AugmentInjectoer_release1 重新编写
 * 
 * 功能：
 * 1. 直接 Token 登录
 * 2. 深链接自动登录
 * 3. Webview 表单登录
 * 4. 一键换号
 * 5. Session 变更触发
 */

const vscode = require('vscode');

class AugmentTokenLoginEnhanced {
  constructor() {
    this.context = null;
    this.logger = this.createLogger();
    this.isInitialized = false;
  }

  /**
   * 创建日志工具
   */
  createLogger() {
    return {
      info: (msg, ...args) => console.log('[TokenLogin] ' + msg, ...args),
      warn: (msg, ...args) => console.warn('[TokenLogin] ' + msg, ...args),
      error: (msg, ...args) => console.error('[TokenLogin] ' + msg, ...args),
      debug: (msg, ...args) => console.debug('[TokenLogin] ' + msg, ...args),
    };
  }

  /**
   * 初始化模块
   */
  async initialize(context) {
    if (this.isInitialized) {
      this.logger.warn('Module already initialized');
      return;
    }

    try {
      this.context = context;

      // 注册命令
      this.registerCommands();

      // 设置 Token 注入
      this.setupTokenInjection();

      // ✅ 新增: 启动时恢复 Token 和 Session
      await this.restoreTokenOnStartup();

      // 注册深链接处理器
      try {
        this.registerDeepLinkHandler();
      } catch (error) {
        this.logger.warn('registerDeepLinkHandler failed:', error);
      }

      this.isInitialized = true;
      this.logger.info('Enhanced module initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize module:', error);
      throw error;
    }
  }

  /**
   * 注册命令
   */
  registerCommands() {
    try {
      const tokenManagementCmd = vscode.commands.registerCommand(
        'augment.custom.tokenManagement',
        () => {
          this.handleTokenManagement();
        }
      );

      const directLoginCmd = vscode.commands.registerCommand(
        'augment.custom.directLogin',
        () => {
          this.handleDirectLogin();
        }
      );

      this.context.subscriptions.push(tokenManagementCmd);
      this.context.subscriptions.push(directLoginCmd);
      
      this.logger.info('Commands registered successfully');
    } catch (error) {
      this.logger.error('Failed to register commands:', error);
    }
  }

  /**
   * 注册深链接处理器
   * 格式: vscode://augment.vscode-augment/autoAuth/push-login?url=...&token=...&portal=...
   */
  registerDeepLinkHandler() {
    try {
      const handler = vscode.window.registerUriHandler({
        handleUri: async (uri) => {
          try {
            const params = new URLSearchParams(uri.query || '');
            const url = params.get('url') || params.get('tenantURL') || '';
            const token = params.get('token') || params.get('accessToken') || '';
            const portal = params.get('portal');

            // 处理 portal 参数（余额 token）
            if (portal !== null) {
              const portalToken = (portal || '').trim();
              if (portalToken.length === 0) {
                vscode.window.showWarningMessage('portal 参数为空，已忽略余额 token 更新');
              } else {
                let extractedToken = portalToken;
                
                // 尝试从 URL 中提取 token
                try {
                  const match = portalToken.match(/[?&]token=([^&]+)/);
                  if (match) {
                    extractedToken = decodeURIComponent(match[1]);
                  }
                } catch (e) {
                  // 忽略提取错误
                }

                // 更新余额 token
                try {
                  await vscode.workspace.getConfiguration('augmentBalance')
                    .update('token', extractedToken, vscode.ConfigurationTarget.Global);
                  this.logger.info('augmentBalance.token 已通过 portal 更新');
                } catch (error) {
                  this.logger.warn('更新 augmentBalance.token 失败:', error);
                }
              }
            }

            // 验证参数
            const urlValidation = this.validateURL(url);
            const tokenValidation = this.validateToken(token);

            if (!urlValidation.valid || !tokenValidation.valid) {
              vscode.window.showErrorMessage('推送登录参数无效');
              return;
            }

            // 执行登录
            const result = await this.updateSessionsData(
              urlValidation.url,
              tokenValidation.token
            );

            if (result && result.success) {
              // 触发 Session 变更
              if (typeof this.triggerSessionChange === 'function') {
                await this.triggerSessionChange();
              }

              // 提示重载窗口
              const choice = await vscode.window.showInformationMessage(
                '登录成功，是否重载窗口以生效？',
                '重载窗口',
                '稍后'
              );

              if (choice === '重载窗口') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
              }
            } else {
              vscode.window.showErrorMessage(
                '推送登录失败：' + (result && result.error || '未知原因')
              );
            }
          } catch (error) {
            this.logger.error('Push login handle failed:', error);
            vscode.window.showErrorMessage(
              '推送登录异常：' + (error && error.message ? error.message : String(error))
            );
          }
        }
      });

      if (this.context && this.context.subscriptions && handler) {
        this.context.subscriptions.push(handler);
      }

      this.logger.info('URI handler registered for autoAuth/push-login');
    } catch (error) {
      this.logger.warn('registerUriHandler failed:', error);

      // Fallback: 使用 Augment.setUriHandler (由 interceptor.js 提供)
      try {
        const globalObj = typeof globalThis !== 'undefined' ? globalThis :
                         (typeof global !== 'undefined' ? global : {});

        if (globalObj && globalObj.Augment && typeof globalObj.Augment.setUriHandler === 'function') {
          const fallbackHandler = async (uri) => {
            try {
              const params = new URLSearchParams(uri.query || '');
              const url = params.get('url') || params.get('tenantURL') || '';
              const token = params.get('token') || params.get('accessToken') || '';
              const portal = params.get('portal');

              // 处理 portal 参数（余额 token）
              if (portal !== null) {
                const portalToken = (portal || '').trim();
                if (portalToken.length === 0) {
                  vscode.window.showWarningMessage('portal 参数为空，已忽略余额 token 更新');
                } else {
                  let extractedToken = portalToken;

                  // 尝试从 URL 中提取 token
                  try {
                    const match = portalToken.match(/[?&]token=([^&]+)/);
                    if (match) {
                      extractedToken = decodeURIComponent(match[1]);
                    }
                  } catch (e) {
                    // 忽略提取错误
                  }

                  // 更新余额 token
                  try {
                    await vscode.workspace.getConfiguration('augmentBalance')
                      .update('token', extractedToken, vscode.ConfigurationTarget.Global);
                    this.logger.info('augmentBalance.token 已通过 portal 更新（fallback）');
                  } catch (error) {
                    this.logger.warn('更新 augmentBalance.token 失败（fallback）:', error);
                  }
                }
              }

              // 验证参数
              const urlValidation = this.validateURL(url);
              const tokenValidation = this.validateToken(token);

              if (!urlValidation.valid || !tokenValidation.valid) {
                vscode.window.showErrorMessage('推送登录参数无效');
                return;
              }

              // 执行登录
              const result = await this.updateSessionsData(
                urlValidation.url,
                tokenValidation.token
              );

              if (result && result.success) {
                // 触发 Session 变更
                if (typeof this.triggerSessionChange === 'function') {
                  await this.triggerSessionChange();
                }

                // 提示重载窗口
                const choice = await vscode.window.showInformationMessage(
                  '登录成功，是否重载窗口以生效？',
                  '重载窗口',
                  '稍后'
                );

                if (choice === '重载窗口') {
                  vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
              } else {
                vscode.window.showErrorMessage(
                  '推送登录失败：' + (result && result.error || '未知原因')
                );
              }
            } catch (error) {
              this.logger.error('Push login (fallback) failed:', error);
              vscode.window.showErrorMessage(
                '推送登录异常（fallback）：' + (error && error.message ? error.message : String(error))
              );
            }
          };

          globalObj.Augment.setUriHandler(fallbackHandler);
          this.logger.info('Fallback to composite URI handler');
        }
      } catch (fallbackError) {
        this.logger.error('Fallback URI handler setup failed:', fallbackError);
      }
    }
  }

  /**
   * 获取当前 accessToken
   */
  async getAccessToken() {
    try {
      const sessions = await this.context.secrets.get('augment.sessions');
      if (sessions) {
        const data = JSON.parse(sessions);
        return {
          success: true,
          accessToken: data.accessToken,
          tenantURL: data.tenantURL,
          data: data
        };
      }
      return { success: false, error: '未找到会话数据' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 存储 Secret
   */
  async storeSecret(key, value) {
    try {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
      await this.context.secrets.store(key, valueStr);
      this.logger.info('Secret stored: ' + key);
      return true;
    } catch (error) {
      this.logger.error('Failed to store secret ' + key + ':', error);
      return false;
    }
  }

  /**
   * 更新 accessToken（仅更新 token）
   */
  async updateAccessToken(newToken) {
    try {
      const sessions = await this.context.secrets.get('augment.sessions');
      let data = {};

      if (sessions) {
        try {
          data = JSON.parse(sessions);
        } catch (e) {
          this.logger.warn('Failed to parse existing sessions data');
          data = {};
        }
      }

      data.accessToken = newToken;

      // 设置默认值
      if (!data.tenantURL) {
        data.tenantURL = 'https://d5.api.augmentcode.com/';
      }
      if (!data.scopes) {
        data.scopes = ['email'];
      }

      const stored = await this.storeSecret('augment.sessions', data);

      if (stored) {
        this.logger.info('AccessToken updated successfully');
        await this.updateInterceptorSessionId();
        return { success: true, data: data };
      }

      return { success: false, error: '存储更新后的会话数据失败' };
    } catch (error) {
      this.logger.error('Failed to update access token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新会话数据（完整更新）
   */
  async updateSessionsData(tenantURL, accessToken) {
    try {
      const sessions = await this.context.secrets.get('augment.sessions');
      let data = {};

      if (sessions) {
        try {
          data = JSON.parse(sessions);
        } catch (e) {
          this.logger.warn('Failed to parse existing sessions data');
          data = {};
        }
      }

      data.tenantURL = tenantURL;
      data.accessToken = accessToken;

      if (!data.scopes) {
        data.scopes = ['email'];
      }

      const stored = await this.storeSecret('augment.sessions', data);

      if (stored) {
        this.logger.info('Sessions data updated successfully');
        await this.updateInterceptorSessionId();
        return { success: true, data: data };
      }

      return { success: false, error: '存储更新后的会话数据失败' };
    } catch (error) {
      this.logger.error('Failed to update sessions data:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ 启动时恢复 Token 和 Session
   * 从 Secret Storage 读取已保存的 Token,并更新拦截器的 Session ID
   */
  async restoreTokenOnStartup() {
    try {
      this.logger.info('Attempting to restore token on startup...');

      // 1. 从 Secret Storage 读取 Token
      const tokenData = await this.getAccessToken();

      if (tokenData.success && tokenData.accessToken) {
        this.logger.info('✅ Found stored token, restoring session...');
        this.logger.info('Tenant URL: ' + tokenData.tenantURL);

        // 2. 更新拦截器的 Session ID
        const sessionUpdated = await this.updateInterceptorSessionId();

        if (sessionUpdated) {
          this.logger.info('✅ Token and session restored successfully');
          this.logger.info('You are logged in and ready to use Augment');
        } else {
          this.logger.warn('⚠️ Token found but session update failed');
        }
      } else {
        this.logger.info('ℹ️ No stored token found - please login first');
      }
    } catch (error) {
      this.logger.error('Failed to restore token on startup:', error);
      // 不抛出错误,允许扩展继续初始化
    }
  }

  /**
   * 格式化 URL
   */
  formatURL(url) {
    if (!url) return '';

    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      url = 'https://' + url;
    }

    if (!url.endsWith('/')) {
      url += '/';
    }

    return url;
  }

  /**
   * 验证 Token
   */
  validateToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token不能为空' };
    }

    const trimmed = token.trim();
    if (trimmed.length < 10) {
      return { valid: false, error: 'Token长度似乎太短' };
    }

    return { valid: true, token: trimmed };
  }

  /**
   * 验证 URL
   */
  validateURL(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL不能为空' };
    }

    try {
      const formatted = this.formatURL(url.trim());
      new URL(formatted);
      return { valid: true, url: formatted };
    } catch {
      return { valid: false, error: 'URL格式无效' };
    }
  }

  /**
   * 生成新的 Session ID
   */
  generateNewSessionId() {
    const chars = '0123456789abcdef';
    let result = '';

    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        result += '-';
      } else if (i === 14) {
        result += '4';
      } else if (i === 19) {
        result += chars[8 + Math.floor(4 * Math.random())];
      } else {
        result += chars[Math.floor(16 * Math.random())];
      }
    }

    return result;
  }

  /**
   * 更新拦截器的 Session ID
   */
  async updateInterceptorSessionId() {
    try {
      const newSessionId = this.generateNewSessionId();

      // 更新全局拦截器
      if (typeof global !== 'undefined' && global.AugmentInterceptor) {
        if (typeof global.AugmentInterceptor.updateFakeSessionId === 'function') {
          const updated = global.AugmentInterceptor.updateFakeSessionId(newSessionId);
          if (updated) {
            this.logger.info('Interceptor SessionId updated via function: ' + newSessionId);
          }
        } else {
          global.AugmentInterceptor.FAKE_SESSION_ID = newSessionId;
          this.logger.info('Interceptor SessionId updated directly: ' + newSessionId);
        }
      }

      // 更新 window 拦截器（如果存在）
      if (typeof window !== 'undefined' && window.AugmentInterceptor) {
        if (typeof window.AugmentInterceptor.updateFakeSessionId === 'function') {
          window.AugmentInterceptor.updateFakeSessionId(newSessionId);
        } else {
          window.AugmentInterceptor.FAKE_SESSION_ID = newSessionId;
        }
      }

      return newSessionId;
    } catch (error) {
      this.logger.error('Failed to update interceptor SessionId:', error);
      return null;
    }
  }

  /**
   * 触发 Session 变更
   */
  async triggerSessionChange() {
    try {
      const newSessionId = await this.updateInterceptorSessionId();
      if (newSessionId) {
        this.logger.info('Session change triggered with new SessionId: ' + newSessionId);
      }

      // 触发认证事件（如果可用）
      if (vscode.authentication && typeof vscode.authentication.onDidChangeSessions === 'function') {
        vscode.authentication.onDidChangeSessions(() => {
          this.logger.info('Authentication sessions changed event fired');
        });
      }
    } catch (error) {
      this.logger.debug('Failed to trigger session change:', error);
    }
  }

  /**
   * Token 管理菜单
   */
  async handleTokenManagement() {
    try {
      const choice = await vscode.window.showQuickPick([
        {
          label: '🔑 直接登录',
          description: '使用租户URL和Token直接登录',
          detail: '输入租户URL和访问令牌进行快速登录'
        },
        {
          label: '📋 获取 accessToken',
          description: '查看当前的 accessToken 和 tenantURL',
          detail: '显示当前存储的认证信息，支持复制和查看完整数据'
        },
        {
          label: '⚙️ 设置 accessToken',
          description: '修改 accessToken 或 tenantURL',
          detail: '更新认证信息，支持仅更新 accessToken 或完整更新会话数据'
        }
      ], {
        placeHolder: '选择要执行的操作'
      });

      if (!choice) return;

      if (choice.label === '🔑 直接登录') {
        await this.handleDirectLogin();
      } else if (choice.label === '📋 获取 accessToken') {
        await this.handleGetAccessToken();
      } else if (choice.label === '⚙️ 设置 accessToken') {
        await this.handleSetAccessToken();
      }
    } catch (error) {
      vscode.window.showErrorMessage('操作失败：' + error.message);
    }
  }

  /**
   * 直接登录（Webview 方式）
   */
  async handleDirectLogin() {
    try {
      const panel = vscode.window.createWebviewPanel(
        'augmentLogin',
        'Augment 登录',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      panel.webview.html = this.getLoginWebviewContent();

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case 'login':
              await this.handleWebviewLogin(message.data, panel);
              break;
            case 'cancel':
              panel.dispose();
              break;
          }
        },
        undefined,
        this.context.subscriptions
      );
    } catch (error) {
      this.logger.error('Direct login failed:', error);
      vscode.window.showErrorMessage('直接登录失败: ' + error.message);
    }
  }

  /**
   * 处理 Webview 登录
   */
  async handleWebviewLogin(data, panel) {
    try {
      const { tenantURL, accessToken } = data;
      const urlValidation = this.validateURL(tenantURL);
      const tokenValidation = this.validateToken(accessToken);

      if (!urlValidation.valid) {
        panel.webview.postMessage({
          command: 'error',
          field: 'tenantURL',
          message: urlValidation.error
        });
        return;
      }

      if (!tokenValidation.valid) {
        panel.webview.postMessage({
          command: 'error',
          field: 'accessToken',
          message: tokenValidation.error
        });
        return;
      }

      panel.webview.postMessage({
        command: 'loading',
        message: '正在验证登录信息...'
      });

      const result = await this.updateSessionsData(
        urlValidation.url,
        tokenValidation.token
      );

      if (result.success) {
        await this.triggerSessionChange();

        panel.webview.postMessage({
          command: 'success',
          message: '登录成功！'
        });

        setTimeout(async () => {
          panel.dispose();

          const choice = await vscode.window.showInformationMessage(
            '登录成功！建议重载窗口以使更改生效。',
            '重载窗口',
            '稍后重载'
          );

          if (choice === '重载窗口') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }, 1500);
      } else {
        panel.webview.postMessage({
          command: 'error',
          field: 'general',
          message: '登录失败: ' + result.error
        });
      }
    } catch (error) {
      this.logger.error('Webview login failed:', error);
      panel.webview.postMessage({
        command: 'error',
        field: 'general',
        message: '登录失败: ' + error.message
      });
    }
  }

  /**
   * 获取 accessToken
   */
  async handleGetAccessToken() {
    try {
      const result = await this.getAccessToken();

      if (result.success) {
        const maskedToken = result.accessToken && result.accessToken.length > 16
          ? result.accessToken.substring(0, 8) + '...' + result.accessToken.substring(result.accessToken.length - 8)
          : result.accessToken || '未设置';

        const message = 'accessToken: ' + maskedToken + '\ntenantURL: ' + (result.tenantURL || '未设置');

        const choice = await vscode.window.showInformationMessage(
          message,
          '复制 accessToken',
          '显示完整数据'
        );

        if (choice === '复制 accessToken' && result.accessToken) {
          await vscode.env.clipboard.writeText(result.accessToken);
          vscode.window.showInformationMessage('accessToken 已复制到剪贴板');
        } else if (choice === '显示完整数据') {
          const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(result.data, null, 2),
            language: 'json'
          });
          await vscode.window.showTextDocument(doc);
        }
      } else {
        vscode.window.showErrorMessage('获取失败：' + result.error);
      }
    } catch (error) {
      vscode.window.showErrorMessage('操作失败：' + error.message);
    }
  }

  /**
   * 设置 accessToken
   */
  async handleSetAccessToken() {
    try {
      const choice = await vscode.window.showQuickPick([
        {
          label: '仅更新 accessToken',
          description: '只更新 augment.sessions 中的 accessToken',
          detail: '快速更新：仅修改 accessToken，保留 tenantURL 和权限范围'
        },
        {
          label: '更新会话数据',
          description: '更新 augment.sessions 中的 tenantURL 和 accessToken',
          detail: '完整更新：通过引导输入同时修改 tenantURL 和 accessToken'
        }
      ], {
        placeHolder: '选择更新方式'
      });

      if (!choice) return;

      if (choice.label === '仅更新 accessToken') {
        // 获取当前 token 作为占位符
        let placeholder = '输入新的 accessToken...';
        try {
          const current = await this.context.secrets.get('augment.sessions');
          if (current) {
            const data = JSON.parse(current);
            if (data.accessToken) {
              const token = data.accessToken;
              placeholder = token.length > 16
                ? '当前: ' + token.substring(0, 8) + '...' + token.substring(token.length - 8)
                : '当前: ' + token;
            }
          }
        } catch (e) {
          // 忽略错误
        }

        const newToken = await vscode.window.showInputBox({
          prompt: '输入新的 accessToken',
          placeHolder: placeholder,
          password: true,
          validateInput: (value) => {
            const validation = this.validateToken(value);
            return validation.valid ? null : validation.error;
          }
        });

        if (!newToken) return;

        const result = await this.updateAccessToken(newToken.trim());

        if (result.success) {
          vscode.window.showInformationMessage('accessToken 更新成功！');

          const showData = await vscode.window.showInformationMessage(
            'accessToken 更新成功！',
            '显示更新后的数据'
          );

          if (showData === '显示更新后的数据') {
            const doc = await vscode.workspace.openTextDocument({
              content: JSON.stringify(result.data, null, 2),
              language: 'json'
            });
            await vscode.window.showTextDocument(doc);
          }
        } else {
          vscode.window.showErrorMessage('更新失败：' + result.error);
        }
      } else {
        // 完整更新
        let defaultData = {
          accessToken: '',
          tenantURL: 'https://d5.api.augmentcode.com/',
          scopes: ['email']
        };

        try {
          const current = await this.context.secrets.get('augment.sessions');
          if (current) {
            const data = JSON.parse(current);
            defaultData = { ...defaultData, ...data };
          }
        } catch (e) {
          // 忽略错误
        }

        const tenantURL = await vscode.window.showInputBox({
          prompt: '输入 tenantURL',
          placeHolder: '当前: ' + defaultData.tenantURL,
          value: defaultData.tenantURL,
          validateInput: (value) => {
            const validation = this.validateURL(value);
            return validation.valid ? null : validation.error;
          }
        });

        if (!tenantURL) return;

        const maskedToken = defaultData.accessToken.length > 16
          ? defaultData.accessToken.substring(0, 8) + '...' + defaultData.accessToken.substring(defaultData.accessToken.length - 8)
          : defaultData.accessToken;

        const accessToken = await vscode.window.showInputBox({
          prompt: '输入 accessToken',
          placeHolder: '当前: ' + maskedToken,
          password: true,
          validateInput: (value) => {
            const validation = this.validateToken(value);
            return validation.valid ? null : validation.error;
          }
        });

        if (!accessToken) return;

        const urlValidation = this.validateURL(tenantURL);
        const tokenValidation = this.validateToken(accessToken);

        if (!urlValidation.valid || !tokenValidation.valid) {
          vscode.window.showErrorMessage('输入的参数无效');
          return;
        }

        const result = await this.updateSessionsData(
          urlValidation.url,
          tokenValidation.token
        );

        if (result.success) {
          vscode.window.showInformationMessage('会话数据更新成功！');

          const showData = await vscode.window.showInformationMessage(
            '会话数据更新成功！',
            '显示更新后的数据'
          );

          if (showData === '显示更新后的数据') {
            const doc = await vscode.workspace.openTextDocument({
              content: JSON.stringify(result.data, null, 2),
              language: 'json'
            });
            await vscode.window.showTextDocument(doc);
          }
        } else {
          vscode.window.showErrorMessage('更新失败：' + result.error);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage('操作失败：' + error.message);
    }
  }

  /**
   * 获取登录 Webview 的 HTML 内容
   */
  getLoginWebviewContent() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Augment 登录</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .login-container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            width: 100%;
            max-width: 450px;
            animation: slideIn 0.5s ease-out;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .login-header {
            text-align: center;
            margin-bottom: 30px;
        }

        .login-title {
            font-size: 28px;
            font-weight: 700;
            color: #333;
            margin-bottom: 8px;
        }

        .login-subtitle {
            color: #666;
            font-size: 14px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
            font-size: 14px;
        }

        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 14px;
            transition: all 0.3s ease;
            background: #fff;
        }

        .form-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .form-input.error {
            border-color: #e74c3c;
            box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.1);
        }

        .error-message {
            color: #e74c3c;
            font-size: 12px;
            margin-top: 5px;
            display: none;
        }

        .error-message.show {
            display: block;
        }

        .button-group {
            display: flex;
            gap: 12px;
            margin-top: 30px;
        }

        .btn {
            flex: 1;
            padding: 12px 24px;
            border: none;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .btn-secondary {
            background: #f8f9fa;
            color: #666;
            border: 2px solid #e1e5e9;
        }

        .btn-secondary:hover {
            background: #e9ecef;
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
        }

        .loading-spinner {
            display: none;
            width: 20px;
            height: 20px;
            border: 2px solid transparent;
            border-top: 2px solid #fff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .success-message, .general-error {
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
            text-align: center;
            font-weight: 500;
        }

        .success-message {
            background: #d4edda;
            color: #155724;
        }

        .general-error {
            background: #f8d7da;
            color: #721c24;
        }

        .success-message.show, .general-error.show {
            display: block;
        }

        .form-help {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <h1 class="login-title">🔑 Augment 登录</h1>
            <p class="login-subtitle">输入您的租户URL和访问令牌</p>
        </div>

        <div class="success-message" id="successMessage"></div>
        <div class="general-error" id="generalError"></div>

        <form id="loginForm">
            <div class="form-group">
                <label class="form-label" for="tenantURL">租户URL</label>
                <input
                    type="url"
                    id="tenantURL"
                    class="form-input"
                    placeholder="https://your-tenant.augmentcode.com/"
                    required
                >
                <div class="error-message" id="tenantURLError"></div>
                <div class="form-help">请输入您的Augment租户URL地址</div>
            </div>

            <div class="form-group">
                <label class="form-label" for="accessToken">访问令牌</label>
                <input
                    type="password"
                    id="accessToken"
                    class="form-input"
                    placeholder="输入您的访问令牌..."
                    required
                >
                <div class="error-message" id="accessTokenError"></div>
                <div class="form-help">请输入您的Augment访问令牌</div>
            </div>

            <div class="button-group">
                <button type="button" class="btn btn-secondary" id="cancelBtn">取消</button>
                <button type="submit" class="btn btn-primary" id="loginBtn">
                    <span class="loading-spinner" id="loadingSpinner"></span>
                    <span id="loginBtnText">登录</span>
                </button>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('loginForm');
        const tenantURLInput = document.getElementById('tenantURL');
        const accessTokenInput = document.getElementById('accessToken');
        const loginBtn = document.getElementById('loginBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const loadingSpinner = document.getElementById('loadingSpinner');
        const loginBtnText = document.getElementById('loginBtnText');
        const successMessage = document.getElementById('successMessage');
        const generalError = document.getElementById('generalError');

        function clearErrors() {
            document.querySelectorAll('.form-input').forEach(input => {
                input.classList.remove('error');
            });
            document.querySelectorAll('.error-message').forEach(msg => {
                msg.classList.remove('show');
            });
            generalError.classList.remove('show');
        }

        function showError(field, message) {
            if (field === 'general') {
                generalError.textContent = message;
                generalError.classList.add('show');
            } else {
                const input = document.getElementById(field);
                const errorMsg = document.getElementById(field + 'Error');
                if (input && errorMsg) {
                    input.classList.add('error');
                    errorMsg.textContent = message;
                    errorMsg.classList.add('show');
                }
            }
        }

        function setLoading(loading, message = '') {
            loginBtn.disabled = loading;
            cancelBtn.disabled = loading;
            tenantURLInput.disabled = loading;
            accessTokenInput.disabled = loading;

            if (loading) {
                loadingSpinner.style.display = 'inline-block';
                loginBtnText.textContent = message || '登录中...';
            } else {
                loadingSpinner.style.display = 'none';
                loginBtnText.textContent = '登录';
            }
        }

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            clearErrors();

            const tenantURL = tenantURLInput.value.trim();
            const accessToken = accessTokenInput.value.trim();

            if (!tenantURL || !accessToken) {
                if (!tenantURL) showError('tenantURL', '请输入租户URL');
                if (!accessToken) showError('accessToken', '请输入访问令牌');
                return;
            }

            setLoading(true);
            vscode.postMessage({
                command: 'login',
                data: { tenantURL, accessToken }
            });
        });

        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'error':
                    setLoading(false);
                    showError(message.field, message.message);
                    break;

                case 'loading':
                    setLoading(true, message.message);
                    break;

                case 'success':
                    setLoading(false);
                    successMessage.textContent = message.message;
                    successMessage.classList.add('show');
                    form.style.display = 'none';
                    break;
            }
        });

        tenantURLInput.focus();
    </script>
</body>
</html>`;
  }

  /**
   * 设置 Token 注入
   */
  setupTokenInjection() {
    try {
      if (typeof window !== 'undefined' && window.fetch) {
        this.setupFetchInterception();
        this.logger.info('Token injection setup completed for browser environment');
      } else {
        this.logger.info('Not in browser environment, skipping token injection setup');
      }
    } catch (error) {
      this.logger.error('Failed to setup token injection:', error);
    }
  }

  /**
   * 设置 Fetch 拦截
   */
  setupFetchInterception() {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(url, options = {}) {
      try {
        const modifiedOptions = await self.injectTokenToRequest(url, options);
        return originalFetch.call(this, url, modifiedOptions);
      } catch (error) {
        self.logger.error('Token injection failed for fetch request:', error);
        return originalFetch.call(this, url, options);
      }
    };

    this.logger.info('Fetch API interception setup completed');
  }

  /**
   * 向请求注入 Token
   */
  async injectTokenToRequest(url, options = {}) {
    try {
      const result = await this.getAccessToken();

      if (!result.success || !result.accessToken) {
        return options;
      }

      if (this.isAugmentRequest(url, result.tenantURL)) {
        const headers = options.headers || {};
        const hasAuth = Object.keys(headers).some(
          key => key.toLowerCase() === 'authorization'
        );

        if (!hasAuth) {
          headers.Authorization = 'Bearer ' + result.accessToken;
          this.logger.info('Token injected to request:', url);
        }

        return {
          ...options,
          headers: headers
        };
      }

      return options;
    } catch (error) {
      this.logger.error('Failed to inject token to request:', error);
      return options;
    }
  }

  /**
   * 判断是否为 Augment 请求
   */
  isAugmentRequest(url, tenantURL) {
    if (!url || !tenantURL) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const tenantObj = new URL(tenantURL);
      return urlObj.hostname === tenantObj.hostname;
    } catch (error) {
      return (
        url.includes('augmentcode.com') ||
        url.includes('api.augment') ||
        (tenantURL && url.includes(tenantURL.replace(/https?:\/\//, '')))
      );
    }
  }

  /**
   * 释放资源
   */
  dispose() {
    this.isInitialized = false;
    this.logger.info('Enhanced module disposed');
  }
}

module.exports = AugmentTokenLoginEnhanced;

