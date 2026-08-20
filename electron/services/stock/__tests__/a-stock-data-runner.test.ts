import type { ExecFileException, ExecFileOptions } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => '/workspace/stock-agents'),
    isPackaged: false,
  },
  execFile: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('../../../electron-runtime', () => ({
  app: mocks.app,
}));

import { runAStockDataFn } from '../a-stock-data-runner.js';

const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

type TExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

function mockSuccessfulExecFile(result: object) {
  mocks.execFile.mockImplementation(
    (_executable: string, _args: string[], _options: ExecFileOptions, callback: TExecFileCallback) => {
      callback(null, JSON.stringify(result), '');
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app.getAppPath.mockReturnValue('/workspace/stock-agents');
  mocks.app.isPackaged = false;
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: '/Applications/StockBuddy.app/Contents/Resources',
  });
});

afterAll(() => {
  if (originalResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  } else {
    Reflect.deleteProperty(process, 'resourcesPath');
  }
});

describe('a-stock-data 运行时路径', () => {
  it('开发态从 appPath 解析脚本和虚拟环境，不依赖当前工作目录', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    const scriptPath = '/workspace/stock-agents/electron/python/a-stock-data.py';
    const pythonPath = '/workspace/stock-agents/.venv/bin/python';
    mocks.existsSync.mockImplementation((filePath) => filePath === scriptPath || filePath === pythonPath);
    mockSuccessfulExecFile({ ok: true });

    await expect(runAStockDataFn('tencent_quote', { codes: '000001' })).resolves.toEqual({ ok: true });

    expect(mocks.execFile).toHaveBeenCalledWith(
      pythonPath,
      [scriptPath, 'tencent_quote', '--codes', '000001'],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it('打包态从 resourcesPath 解析脚本并使用系统 Python', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    mocks.app.isPackaged = true;
    const scriptPath = '/Applications/StockBuddy.app/Contents/Resources/python/a-stock-data.py';
    mocks.existsSync.mockImplementation((filePath) => filePath === scriptPath);
    mockSuccessfulExecFile({ ok: true });

    await runAStockDataFn('tencent_quote', { codes: '000001,000002' });

    expect(mocks.existsSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFile).toHaveBeenCalledWith(
      'python3',
      [scriptPath, 'tencent_quote', '--codes', '000001,000002'],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it('脚本不存在时暴露目标路径且不启动 Python', async () => {
    mocks.app.isPackaged = true;
    mocks.existsSync.mockReturnValue(false);

    await expect(runAStockDataFn('tencent_quote', { codes: '000001' })).rejects.toThrow(
      'a-stock-data 脚本不存在: /Applications/StockBuddy.app/Contents/Resources/python/a-stock-data.py',
    );
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
