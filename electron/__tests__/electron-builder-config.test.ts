import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface IExtraResourceEntry {
  from: string;
  to: string;
}

interface IElectronBuilderConfig {
  extraResources: Array<IExtraResourceEntry | string>;
}

const require = createRequire(import.meta.url);
const config = require('../../electron-builder.config.cjs') as IElectronBuilderConfig;
const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
const pythonScriptPath = fileURLToPath(new URL('../python/a-stock-data.py', import.meta.url));
const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Electron 打包资源', () => {
  it('将 a-stock-data Python 脚本复制到 ASAR 外', () => {
    expect(config.extraResources).toContainEqual({
      from: 'electron/python/a-stock-data.py',
      to: 'python/a-stock-data.py',
    });
  });

  it('本机存在 MCP 配置时复制到打包资源目录', () => {
    const hasLocalMcpConfig = existsSync(path.join(projectRoot, '.mcp.json'));
    const mcpResource = { from: '.mcp.json', to: '.mcp.json' };

    if (hasLocalMcpConfig) expect(config.extraResources).toContainEqual(mcpResource);
    else expect(config.extraResources).not.toContainEqual(mcpResource);
  });

  it('a-stock-data Python 脚本语法有效', () => {
    expect(() =>
      execFileSync(
        pythonExecutable,
        [
          '-c',
          'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
          pythonScriptPath,
        ],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });
});
