#!/usr/bin/env node

/**
 * Augment Injector v2.0
 * 基于官方 v0.633.0 分析和 AugmentInjectoer_release1 改进
 * 
 * 核心功能：
 * 1. Token 直接登录
 * 2. 余额监控（Orb API）
 * 3. 智能风控绕过
 * 4. 保留聊天上下文
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  extensionId: 'augment.vscode-augment',
  resourcesDir: path.join(__dirname, 'resources'),
  backupSuffix: '.backup',
};

// 日志工具
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ✓ ${msg}`),
  error: (msg) => console.error(`[ERROR] ✗ ${msg}`),
  warn: (msg) => console.warn(`[WARN] ⚠ ${msg}`),
};

/**
 * 查找扩展目录
 */
function findExtensionDir() {
  const homeDir = require('os').homedir();
  const possiblePaths = [
    path.join(homeDir, '.vscode', 'extensions'),
    path.join(homeDir, '.vscode-insiders', 'extensions'),
    path.join(homeDir, '.cursor', 'extensions'),
  ];

  for (const basePath of possiblePaths) {
    if (!fs.existsSync(basePath)) continue;
    
    const dirs = fs.readdirSync(basePath);
    const extensionDir = dirs.find(dir => dir.startsWith(CONFIG.extensionId));
    
    if (extensionDir) {
      return path.join(basePath, extensionDir);
    }
  }
  
  return null;
}

/**
 * 备份文件
 */
function backupFile(filePath) {
  const backupPath = filePath + CONFIG.backupSuffix;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
    logger.info(`已备份: ${path.basename(filePath)}`);
  }
}

/**
 * 注入拦截器到 extension.js
 */
function injectInterceptor(extensionDir) {
  // ✅ 修复：正确的路径是 out/extension.js
  const extensionJsPath = path.join(extensionDir, 'out', 'extension.js');

  if (!fs.existsSync(extensionJsPath)) {
    throw new Error(`找不到 extension.js: ${extensionJsPath}`);
  }

  backupFile(extensionJsPath);

  const interceptorCode = fs.readFileSync(
    path.join(CONFIG.resourcesDir, 'interceptor.js'),
    'utf8'
  );

  let extensionCode = fs.readFileSync(extensionJsPath, 'utf8');

  // 移除旧的注入代码（release1 或之前的 v2）
  if (extensionCode.includes('// === Augment Interceptor Injection Start ===')) {
    logger.info('检测到旧版本注入代码，正在移除...');
    const startMarker = '// === Augment Interceptor Injection Start ===';
    const endMarker = '// === Augment Interceptor Injection End ===';
    const startIndex = extensionCode.indexOf(startMarker);
    const endIndex = extensionCode.indexOf(endMarker);
    if (startIndex !== -1 && endIndex !== -1) {
      extensionCode = extensionCode.substring(0, startIndex) + extensionCode.substring(endIndex + endMarker.length);
      logger.success('已移除旧版本注入代码');
    }
  }

  // 在文件开头注入拦截器
  if (!extensionCode.includes('// AUGMENT_INJECTOR_V2')) {
    extensionCode = `// AUGMENT_INJECTOR_V2\n${interceptorCode}\n\n${extensionCode}`;
    fs.writeFileSync(extensionJsPath, extensionCode);
    logger.success('已注入拦截器 v2');
  } else {
    logger.warn('拦截器 v2 已存在，跳过注入');
  }
}

/**
 * 注入 Token 登录功能
 */
function injectTokenLogin(extensionDir) {
  const tokenLoginCode = fs.readFileSync(
    path.join(CONFIG.resourcesDir, 'token-login-enhanced.js'),
    'utf8'
  );

  // ✅ 修复：正确的路径是 out/token-login.js
  const targetPath = path.join(extensionDir, 'out', 'token-login.js');
  fs.writeFileSync(targetPath, tokenLoginCode);
  logger.success('已注入 Token 登录功能');
}

/**
 * 注入余额监控功能
 */
function injectBalanceMonitor(extensionDir) {
  const balanceCode = fs.readFileSync(
    path.join(CONFIG.resourcesDir, 'augment-balance-enhanced.js'),
    'utf8'
  );

  // ✅ 修复：正确的路径是 out/balance-monitor.js
  const targetPath = path.join(extensionDir, 'out', 'balance-monitor.js');
  fs.writeFileSync(targetPath, balanceCode);
  logger.success('已注入余额监控功能');
}

/**
 * 修改 package.json 添加命令
 */
function modifyPackageJson(extensionDir) {
  const packageJsonPath = path.join(extensionDir, 'extension', 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('找不到 package.json');
  }

  backupFile(packageJsonPath);

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const newCommands = JSON.parse(
    fs.readFileSync(path.join(CONFIG.resourcesDir, 'package-json-commands.json'), 'utf8')
  );

  // 合并命令
  if (!packageJson.contributes) packageJson.contributes = {};
  if (!packageJson.contributes.commands) packageJson.contributes.commands = [];
  
  for (const cmd of newCommands.commands) {
    const exists = packageJson.contributes.commands.some(c => c.command === cmd.command);
    if (!exists) {
      packageJson.contributes.commands.push(cmd);
    }
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  logger.success('已修改 package.json');
}

/**
 * 主函数
 */
async function main() {
  try {
    logger.info('开始注入 Augment Injector v2.0...');
    
    const extensionDir = findExtensionDir();
    if (!extensionDir) {
      throw new Error('找不到 Augment 扩展目录');
    }
    
    logger.info(`找到扩展目录: ${extensionDir}`);
    
    // 执行注入
    injectInterceptor(extensionDir);
    injectTokenLogin(extensionDir);
    injectBalanceMonitor(extensionDir);
    modifyPackageJson(extensionDir);
    
    logger.success('注入完成！请重启 VSCode');
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
}

main();

