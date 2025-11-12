/**
 * Augment Balance Enhanced - 修复版本
 * 修复了 API 字段路径问题: customer.ledger_pricing_units -> account.custom_pricing_units
 */

const vscode = require('vscode');

/**
 * Orb API 服务
 */
class BalanceApiService {
  static BASE_URL = 'https://portal.withorb.com/api/v1';
  static USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

  /**
   * 获取客户信息 - ✅ 已修复
   */
  static async getAccountInfo(token) {
    try {
      const url = this.BASE_URL + '/customer_from_link?token=' + encodeURIComponent(token);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        throw this.createApiError(
          response.status,
          'HTTP ' + response.status + ': ' + response.statusText,
          '获取账号信息失败'
        );
      }

      const data = await response.json();

      // 验证响应数据
      if (!data || !data.customer || !data.customer.id) {
        throw new Error('API响应格式错误：缺少customer信息');
      }

      // ✅ 修复: 使用正确的字段路径 account.custom_pricing_units
      if (!data.account || !data.account.custom_pricing_units || data.account.custom_pricing_units.length === 0) {
        throw new Error('API响应格式错误：缺少pricing_unit信息');
      }

      // ✅ 修复: 按名称查找 Credits 单元
      const creditsUnit = data.account.custom_pricing_units.find(
        unit => unit.name === 'credits' || unit.display_name === 'Credits'
      );

      if (!creditsUnit) {
        throw new Error('未找到Credits定价单元');
      }

      return {
        customer_id: data.customer.id,
        email: data.customer.email || '',
        plan_name: data.customer.plan?.name || '未知套餐',
        end_date: data.customer.end_date || null,
        pricing_unit_id: creditsUnit.id
      };
    } catch (error) {
      throw this.handleApiError(error, '获取账号信息失败');
    }
  }

  /**
   * 获取余额
   */
  static async getBalance(customerId, token, pricingUnitId) {
    try {
      if (!pricingUnitId) {
        throw new Error('无效的pricing unit ID');
      }

      const url = this.BASE_URL + '/customers/' + encodeURIComponent(customerId) + 
                  '/ledger_summary?pricing_unit_id=' + encodeURIComponent(pricingUnitId) + 
                  '&token=' + encodeURIComponent(token);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        throw this.createApiError(
          response.status,
          'HTTP ' + response.status + ': ' + response.statusText,
          '获取余额失败'
        );
      }

      const data = await response.json();

      if (!data || data.credits_balance === undefined) {
        throw new Error('API响应格式错误：缺少credits_balance字段');
      }

      return parseFloat(data.credits_balance);
    } catch (error) {
      throw this.handleApiError(error, '获取余额失败');
    }
  }

  static createApiError(statusCode, message, context) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.isNetworkError = false;
    error.context = context;
    return error;
  }

  static handleApiError(error, context) {
    if (error.name === 'TypeError' && error.message.includes('abort')) {
      const networkError = new Error('网络连接失败，请检查网络连接');
      networkError.isNetworkError = true;
      networkError.context = context;
      return networkError;
    }

    if (error.statusCode) {
      return error;
    }

    const apiError = new Error(error.message || '未知错误');
    apiError.isNetworkError = false;
    apiError.context = context;
    return apiError;
  }
}

/**
 * 配置管理器
 */
class BalanceConfigManager {
  static SECTION = 'augmentBalance';

  constructor() {
    this.onConfigChangedEmitter = new vscode.EventEmitter();
    this.onConfigChanged = this.onConfigChangedEmitter.event;

    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(BalanceConfigManager.SECTION)) {
        this.onConfigChangedEmitter.fire(this.getConfig());
      }
    });
  }

  extractTokenFromUrl(input) {
    if (!input || typeof input !== 'string') {
      return input;
    }

    const match = input.match(/[?&]token=([^&]+)/);
    if (match) {
      return match[1];
    }

    return input;
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration(BalanceConfigManager.SECTION);
    const rawToken = config.get('token', '');

    return {
      token: this.extractTokenFromUrl(rawToken),
      updateInterval: config.get('updateInterval', 600),
      enabled: config.get('enabled', true)
    };
  }

  validateConfig(config) {
    const errors = [];

    if (!config.token || config.token.trim() === '') {
      errors.push('API token不能为空');
    }

    if (config.updateInterval < 60 || config.updateInterval > 3600) {
      errors.push('更新间隔必须在60-3600秒之间');
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  openSettings() {
    vscode.commands.executeCommand('workbench.action.openSettings', BalanceConfigManager.SECTION);
  }

  showConfigError(errors) {
    const message = 'Augment Balance配置错误：\n' + errors.join('\n');
    vscode.window.showErrorMessage(message, '打开设置').then(selection => {
      if (selection === '打开设置') {
        this.openSettings();
      }
    });
  }

  showConfigSuccess() {
    vscode.window.showInformationMessage('Augment Balance配置已更新');
  }

  dispose() {
    this.onConfigChangedEmitter.dispose();
  }
}

/**
 * 状态管理器
 */
class BalanceStateManager {
  static CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时

  constructor(context) {
    this.context = context;
    this.onStateChangedEmitter = new vscode.EventEmitter();
    this.onStateChanged = this.onStateChangedEmitter.event;
  }

  getAccountCacheKey(token) {
    return token + '_AccountInfo';
  }

  getCachedAccountData(token) {
    try {
      const cacheKey = this.getAccountCacheKey(token);
      const cached = this.context.globalState.get(cacheKey);

      if (!cached) {
        return null;
      }

      const now = Date.now();

      if (now - cached.timestamp > BalanceStateManager.CACHE_EXPIRY_MS) {
        return null;
      }

      return cached;
    } catch (error) {
      console.error('[BalanceState] 获取缓存数据失败:', error);
      return null;
    }
  }

  async cacheAccountData(accountData) {
    try {
      const cacheKey = this.getAccountCacheKey(accountData.token);
      await this.context.globalState.update(cacheKey, accountData);
      this.onStateChangedEmitter.fire();
    } catch (error) {
      console.error('[BalanceState] 缓存账号数据失败:', error);
    }
  }

  async clearAccountCache(token) {
    try {
      const cacheKey = this.getAccountCacheKey(token);
      await this.context.globalState.update(cacheKey, undefined);
      this.onStateChangedEmitter.fire();
    } catch (error) {
      console.error('[BalanceState] 清除账号缓存失败:', error);
    }
  }

  validateCache(token) {
    const cached = this.getCachedAccountData(token);
    return {
      isAccountInfoValid: cached !== null && !cached.error
    };
  }

  async cleanupExpiredCache() {
    try {
      const keys = this.context.globalState.keys();
      const now = Date.now();

      for (const key of keys) {
        if (key.endsWith('_AccountInfo')) {
          const cached = this.context.globalState.get(key);
          if (cached && cached.timestamp && now - cached.timestamp > BalanceStateManager.CACHE_EXPIRY_MS) {
            await this.context.globalState.update(key, undefined);
          }
        }
      }
    } catch (error) {
      console.error('[BalanceState] 清理过期缓存失败:', error);
    }
  }

  async getOrFetchAccountInfo(token, forceRefresh = false) {
    const cached = this.getCachedAccountData(token);

    if (!forceRefresh && cached && !cached.error && cached.customer_id) {
      return {
        customer_id: cached.customer_id,
        email: cached.email,
        plan_name: cached.plan_name,
        end_date: cached.end_date,
        pricing_unit_id: cached.pricing_unit_id
      };
    }

    return await BalanceApiService.getAccountInfo(token);
  }

  async fetchAccountInfo(token, forceRefresh = false) {
    try {
      const accountInfo = await this.getOrFetchAccountInfo(token, forceRefresh);
      const balance = await BalanceApiService.getBalance(accountInfo.customer_id, token, accountInfo.pricing_unit_id);

      const accountData = {
        customer_id: accountInfo.customer_id,
        email: accountInfo.email,
        plan_name: accountInfo.plan_name,
        end_date: accountInfo.end_date,
        pricing_unit_id: accountInfo.pricing_unit_id,
        balance: balance,
        timestamp: Date.now(),
        token: token
      };

      await this.cacheAccountData(accountData);
      return accountData;
    } catch (error) {
      throw error;
    }
  }

  async cacheError(errorMessage, token) {
    try {
      const cached = this.getCachedAccountData(token) || {};
      const errorData = {
        ...cached,
        error: errorMessage,
        timestamp: Date.now(),
        token: token
      };

      const cacheKey = this.getAccountCacheKey(token);
      await this.context.globalState.update(cacheKey, errorData);
      this.onStateChangedEmitter.fire();
    } catch (error) {
      console.error('[BalanceState] 缓存错误信息失败:', error);
    }
  }

  dispose() {
    this.onStateChangedEmitter.dispose();
  }
}

/**
 * 状态栏管理器
 */
class BalanceStatusBarManager {
  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'augmentBalance.openSettings';
    this.setNotConfigured();
    this.statusBarItem.show();
  }

  setNormal(data) {
    if (!data || !data.balance) {
      this.setError('数据无效');
      return;
    }

    const balance = parseFloat(data.balance);
    let icon, color;

    if (balance <= 5000) {
      icon = '😟';
      color = '#ff4444';
    } else if (balance < 20000) {
      icon = '🙂';
      color = '#ffaa00';
    } else {
      icon = '😆';
      color = '#00aa00';
    }

    this.statusBarItem.text = icon + ' ' + balance.toFixed(2);
    this.statusBarItem.color = color;
    this.statusBarItem.tooltip = this.createTooltip(data);
    this.statusBarItem.backgroundColor = undefined;
  }

  setLoading(previousData = null) {
    this.statusBarItem.text = '⏳ 余额加载中...';
    this.statusBarItem.color = '#888888';
    this.statusBarItem.backgroundColor = undefined;

    if (previousData) {
      this.statusBarItem.tooltip = '正在更新余额...\n\n' + this.createTooltip(previousData);
    } else {
      this.statusBarItem.tooltip = '正在获取余额信息...';
    }
  }

  setNotConfigured() {
    this.statusBarItem.text = '⚙️ 余额未配置';
    this.statusBarItem.color = '#888888';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = '点击配置Augment余额显示\n\n需要设置API Token才能显示余额信息';
  }

  setError(errorMessage, previousData = null) {
    this.statusBarItem.text = '❌ 余额错误';
    this.statusBarItem.color = '#ff4444';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

    let tooltip = '余额获取失败: ' + errorMessage + '\n\n点击打开设置页面';

    if (previousData && previousData.balance) {
      tooltip += '\n\n上次余额: ' + parseFloat(previousData.balance).toFixed(2);
      tooltip += '\n更新时间: ' + new Date(previousData.timestamp).toLocaleString();
    }

    this.statusBarItem.tooltip = tooltip;
  }

  updateDisplay(data, isValid) {
    if (!isValid) {
      this.setNotConfigured();
      return;
    }

    if (!data) {
      this.setLoading();
      return;
    }

    if (data.error) {
      this.setError(data.error, data);
      return;
    }

    this.setNormal(data);
  }

  createTooltip(data) {
    if (!data) {
      return '暂无数据';
    }

    const balance = parseFloat(data.balance || '0');
    let tooltip = 'Augment 余额: ' + balance.toFixed(2) + '\n';

    if (data.email) {
      tooltip += '账号: ' + data.email + '\n';
    }

    if (data.plan_name) {
      tooltip += '套餐: ' + data.plan_name + '\n';
    }

    if (data.end_date) {
      tooltip += '到期时间: ' + new Date(data.end_date).toLocaleDateString() + '\n';
    }

    if (data.timestamp) {
      tooltip += '更新时间: ' + new Date(data.timestamp).toLocaleString() + '\n';
    }

    tooltip += '\n点击打开设置页面';

    return tooltip;
  }

  dispose() {
    this.statusBarItem.dispose();
  }
}

/**
 * Augment Balance Enhanced 主类
 */
class AugmentBalanceEnhanced {
  constructor() {
    this.context = null;
    this.logger = this.createLogger();
    this.isInitialized = false;
    this.configManager = null;
    this.stateManager = null;
    this.statusBarManager = null;
    this.updateTimer = null;
    this.isUpdating = false;
    this.lastToken = '';
  }

  createLogger() {
    return {
      info: (msg, ...args) => console.log('[BalanceEnhanced] ' + msg, ...args),
      warn: (msg, ...args) => console.warn('[BalanceEnhanced] ' + msg, ...args),
      error: (msg, ...args) => console.error('[BalanceEnhanced] ' + msg, ...args),
      debug: (msg, ...args) => console.debug('[BalanceEnhanced] ' + msg, ...args)
    };
  }

  async initialize(context) {
    if (this.isInitialized) {
      this.logger.warn('Already initialized');
      return;
    }

    try {
      this.context = context;

      this.configManager = new BalanceConfigManager();
      this.stateManager = new BalanceStateManager(context);
      this.statusBarManager = new BalanceStatusBarManager();

      this.registerCommands();

      this.configManager.onConfigChanged(config => {
        this.onConfigChanged(config);
      });

      this.stateManager.onStateChanged(() => {
        this.updateStatusBar();
      });

      await this.initializeState();

      this.isInitialized = true;
      this.logger.info('Enhanced module initialized successfully');
    } catch (error) {
      this.logger.error('Initialization failed:', error);
      throw error;
    }
  }

  registerCommands() {
    try {
      const openSettings = vscode.commands.registerCommand('augmentBalance.openSettings', () => {
        this.configManager.openSettings();
      });

      const refreshBalance = vscode.commands.registerCommand('augmentBalance.refreshBalance', () => {
        this.refreshBalance(true);
      });

      const toggleDisplay = vscode.commands.registerCommand('augmentBalance.toggleDisplay', () => {
        this.toggleDisplay();
      });

      this.context.subscriptions.push(openSettings);
      this.context.subscriptions.push(refreshBalance);
      this.context.subscriptions.push(toggleDisplay);

      this.logger.debug('Commands registered successfully');
    } catch (error) {
      this.logger.error('Failed to register commands:', error);
    }
  }

  async initializeState() {
    const config = this.configManager.getConfig();
    const validation = this.configManager.validateConfig(config);
    this.lastToken = config.token;

    await this.stateManager.cleanupExpiredCache();

    if (!validation.isValid || !config.enabled) {
      this.statusBarManager.setNotConfigured();
      return;
    }

    this.updateStatusBar();
    this.startPeriodicUpdate(config);
    await this.refreshBalance();
  }

  async onConfigChanged(config) {
    const validation = this.configManager.validateConfig(config);

    if (!validation.isValid || !config.enabled) {
      if (!validation.isValid) {
        this.configManager.showConfigError(validation.errors);
      }
      this.statusBarManager.setNotConfigured();
      this.stopPeriodicUpdate();
      return;
    }

    const tokenChanged = this.lastToken !== config.token;
    const oldToken = this.lastToken;
    this.lastToken = config.token;

    let forceRefresh = tokenChanged;

    if (tokenChanged) {
      this.logger.info('Token已变更，清除旧token缓存并强制刷新');
      if (oldToken) {
        await this.stateManager.clearAccountCache(oldToken);
      }
    } else {
      const state = this.stateManager.validateCache(config.token);
      if (!state.isAccountInfoValid) {
        this.logger.info('账号信息缓存无效，强制刷新');
        forceRefresh = true;
      }
    }

    this.configManager.showConfigSuccess();
    this.startPeriodicUpdate(config);
    await this.refreshBalance(forceRefresh);
  }

  startPeriodicUpdate(config) {
    this.stopPeriodicUpdate();

    if (!config.enabled) return;

    const intervalMs = config.updateInterval * 1000;
    this.updateTimer = setInterval(() => {
      this.refreshBalance();
    }, intervalMs);

    this.logger.info('Started periodic update with interval: ' + config.updateInterval + 's');
  }

  stopPeriodicUpdate() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
      this.logger.info('Stopped periodic update');
    }
  }

  async refreshBalance(forceRefresh = false) {
    if (this.isUpdating) return;

    const config = this.configManager.getConfig();
    const validation = this.configManager.validateConfig(config);

    if (!validation.isValid || !config.enabled) {
      this.statusBarManager.setNotConfigured();
      return;
    }

    this.isUpdating = true;

    try {
      const previousData = this.stateManager.getCachedAccountData(config.token);
      this.statusBarManager.setLoading(previousData);

      const accountData = await this.stateManager.fetchAccountInfo(config.token, forceRefresh);

      this.statusBarManager.setNormal(accountData);
    } catch (error) {
      const errorMessage = error.message || '未知错误';
      const previousData = this.stateManager.getCachedAccountData(config.token);

      await this.stateManager.cacheError(errorMessage, config.token);

      this.statusBarManager.setError(errorMessage, previousData);

      if (error.statusCode === 401 || error.statusCode === 403) {
        vscode.window.showErrorMessage(
          'Augment Balance认证失败: ' + errorMessage,
          '打开设置'
        ).then(selection => {
          if (selection === '打开设置') {
            this.configManager.openSettings();
          }
        });
      }
    } finally {
      this.isUpdating = false;
    }
  }

  updateStatusBar() {
    const config = this.configManager.getConfig();
    const validation = this.configManager.validateConfig(config);
    const cachedData = this.stateManager.getCachedAccountData(config.token);

    this.statusBarManager.updateDisplay(cachedData, validation.isValid && config.enabled);
  }

  async toggleDisplay() {
    const config = this.configManager.getConfig();
    const newEnabled = !config.enabled;
    const vsConfig = vscode.workspace.getConfiguration('augmentBalance');
    await vsConfig.update('enabled', newEnabled, vscode.ConfigurationTarget.Global);

    const status = newEnabled ? '已启用' : '已禁用';
    vscode.window.showInformationMessage('Augment余额显示' + status);
  }

  dispose() {
    this.stopPeriodicUpdate();
    if (this.configManager) this.configManager.dispose();
    if (this.stateManager) this.stateManager.dispose();
    if (this.statusBarManager) this.statusBarManager.dispose();
    this.isInitialized = false;
    this.logger.info('Enhanced module disposed');
  }
}

module.exports = AugmentBalanceEnhanced;

