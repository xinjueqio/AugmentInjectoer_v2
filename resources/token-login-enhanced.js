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
      
      // 注册深链接处理器
      this.registerDeepLinkHandler();
      
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
      this.logger.warn('Failed to register URI handler:', error);
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
   * 直接登录（输入框方式）
   */
  async handleDirectLogin() {
    try {
      // 输入租户 URL
      const tenantURL = await vscode.window.showInputBox({
        prompt: '输入租户 URL',
        placeHolder: 'https://d5.api.augmentcode.com/',
        validateInput: (value) => {
          const validation = this.validateURL(value);
          return validation.valid ? null : validation.error;
        }
      });

      if (!tenantURL) return;

      // 输入 accessToken
      const accessToken = await vscode.window.showInputBox({
        prompt: '输入 accessToken',
        placeHolder: '粘贴您的访问令牌...',
        password: true,
        validateInput: (value) => {
          const validation = this.validateToken(value);
          return validation.valid ? null : validation.error;
        }
      });

      if (!accessToken) return;

      // 验证并更新
      const urlValidation = this.validateURL(tenantURL);
      const tokenValidation = this.validateToken(accessToken);

      if (!urlValidation.valid || !tokenValidation.valid) {
        vscode.window.showErrorMessage('输入的参数无效');
        return;
      }

      // 更新会话数据
      const result = await this.updateSessionsData(
        urlValidation.url,
        tokenValidation.token
      );

      if (result && result.success) {
        await this.triggerSessionChange();

        const choice = await vscode.window.showInformationMessage(
          '登录成功！建议重载窗口以使更改生效。',
          '重载窗口',
          '稍后'
        );

        if (choice === '重载窗口') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      } else {
        vscode.window.showErrorMessage('登录失败：' + result.error);
      }
    } catch (error) {
      this.logger.error('Direct login failed:', error);
      vscode.window.showErrorMessage('登录失败：' + error.message);
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
   * 释放资源
   */
  dispose() {
    this.isInitialized = false;
    this.logger.info('Enhanced module disposed');
  }
}

module.exports = { AugmentTokenLoginEnhanced };

