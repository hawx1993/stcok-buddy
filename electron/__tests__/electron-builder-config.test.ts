import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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

describe('Electron 打包资源', () => {
  it('将 a-stock-data Python 脚本复制到 ASAR 外', () => {
    expect(config.extraResources).toContainEqual({
      from: 'electron/python/a-stock-data.py',
      to: 'python/a-stock-data.py',
    });
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
