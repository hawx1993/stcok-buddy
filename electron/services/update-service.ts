import { app, shell } from 'electron';
import { copyFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import type { IAppUpdateProgress, IAppUpdateSettings, IAppUpdateState, TAppUpdateChannel } from '../../src/shared/types.js';
import { getConfig } from './config-store.js';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GITHUB_RELEASES_URL = 'https://github.com/hawx1993/stcok-buddy/releases';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/hawx1993/stcok-buddy/releases';

function getPackageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).version as string;
  } catch {
    return app.getVersion();
  }
}

function getCurrentVersion() {
  return app.isPackaged ? app.getVersion() : getPackageVersion();
}

type TReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type TGitHubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  prerelease?: boolean;
  assets: TReleaseAsset[];
};

const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseVersion(version: string) {
  const match = version.trim().match(versionPattern);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function releaseTagToVersion(tag: string) {
  return tag.replace(/^v/, '');
}

function getLatestYmlAssetName(channel: TAppUpdateChannel) {
  const prefix = channel === 'beta' ? 'beta' : 'latest';
  return process.platform === 'darwin' ? `${prefix}-mac.yml` : `${prefix}.yml`;
}

function getUpdateSettings(override?: IAppUpdateSettings) {
  return override ?? getConfig().appUpdate ?? { channel: 'stable' as const, downloadDirectory: '' };
}

function applyUpdaterSettings(override?: IAppUpdateSettings) {
  const { channel } = getUpdateSettings(override);
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
}

async function fetchGitHubReleases(channel: TAppUpdateChannel) {
  const endpoint = channel === 'stable' ? `${GITHUB_RELEASES_API}/latest` : `${GITHUB_RELEASES_API}?per_page=20`;
  const response = await fetch(endpoint, { headers: { accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub Release 检查失败：${response.status}`);
  if (channel === 'stable') return (await response.json()) as TGitHubRelease;
  const releases = (await response.json()) as TGitHubRelease[];
  const betaRelease = releases.find((release) => release.prerelease);
  if (!betaRelease) throw new Error('未找到可用的 GitHub 测试 Release，请确认测试版本已发布。');
  return betaRelease;
}

async function checkDevGitHubRelease(settings?: IAppUpdateSettings) {
  const { channel } = getUpdateSettings(settings);
  const metadataAssetName = getLatestYmlAssetName(channel);
  updateState({ status: 'checking', error: undefined, message: '正在检查更新…' });
  const release = await fetchGitHubReleases(channel);
  const latestVersion = releaseTagToVersion(release.tag_name);
  const hasPlatformMetadata = release.assets.some((asset) => asset.name === metadataAssetName);
  if (!hasPlatformMetadata) throw new Error(`最新 Release 缺少 ${metadataAssetName}，请用打包命令生成并上传更新元数据`);
  if (compareVersions(latestVersion, getCurrentVersion()) <= 0) {
    return updateState({
      status: 'not-available',
      latestVersion,
      releaseName: release.name ?? undefined,
      releaseNotes: release.body ?? undefined,
      progress: undefined,
      error: undefined,
      message: '已是最新版本',
    });
  }
  return updateState({
    status: 'available',
    latestVersion,
    releaseName: release.name ?? undefined,
    releaseNotes: release.body ?? undefined,
    progress: undefined,
    error: undefined,
    message: `发现新版本 v${latestVersion}`,
  });
}

type TAppUpdateListener = (state: IAppUpdateState) => void;

const listeners = new Set<TAppUpdateListener>();
let installHandler: (() => void) | undefined;
let checkingPromise: Promise<IAppUpdateState> | undefined;
let downloadPromise: Promise<IAppUpdateState> | undefined;
let downloadSettingsOverride: IAppUpdateSettings | undefined;
let state: IAppUpdateState = {
  status: 'idle',
  currentVersion: getCurrentVersion(),
};

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = console;
applyUpdaterSettings();

function toReleaseNotesText(notes: UpdateInfo['releaseNotes']) {
  if (!notes) return undefined;
  if (typeof notes === 'string') return notes;
  return notes.map((item) => `${item.version}\n${item.note}`).join('\n\n');
}

function normalizeProgress(progress: ProgressInfo): IAppUpdateProgress {
  return {
    percent: Math.max(0, Math.min(100, progress.percent)),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  };
}

function updateState(next: Partial<IAppUpdateState>) {
  state = {
    ...state,
    ...next,
    currentVersion: getCurrentVersion(),
  };
  for (const listener of listeners) listener(state);
  return state;
}

function updateAvailableState(info: UpdateInfo) {
  return updateState({
    status: 'available',
    latestVersion: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseNotes: toReleaseNotesText(info.releaseNotes),
    progress: undefined,
    error: undefined,
    message: `发现新版本 v${info.version}`,
  });
}

function copyDownloadedUpdate(event: UpdateDownloadedEvent, settings?: IAppUpdateSettings) {
  const downloadDirectory = getUpdateSettings(settings).downloadDirectory?.trim();
  if (!downloadDirectory) return undefined;
  const targetPath = path.join(downloadDirectory, path.basename(event.downloadedFile));
  copyFileSync(event.downloadedFile, targetPath);
  return targetPath;
}

function updateDownloadedState(event: UpdateDownloadedEvent) {
  const baseState = updateState({
    status: 'downloaded',
    latestVersion: event.version,
    releaseName: event.releaseName ?? undefined,
    releaseNotes: toReleaseNotesText(event.releaseNotes),
    progress: undefined,
    error: undefined,
    message: '下载完成，点击安装后将退出当前软件',
  });
  try {
    const copiedPath = copyDownloadedUpdate(event, downloadSettingsOverride);
    if (!copiedPath) return baseState;
    return updateState({ message: `下载完成，安装包已保存到 ${copiedPath}` });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return updateState({ error: `更新已下载，但复制到指定目录失败：${detail}`, message: `更新已下载，但复制到指定目录失败：${detail}` });
  }
}

function formatUpdateError(error: Error) {
  const firstLine = error.message.split('\n').find((line) => line.trim());
  const message = firstLine?.trim() || '更新检查失败，请稍后重试';
  if (message.includes('Code signature') && message.includes('did not pass validation')) {
    return `更新包签名校验失败，请等待重新发布的安装包；当前版本不会被替换。原始错误：${message.length > 120 ? `${message.slice(0, 120)}…` : message}`;
  }
  if (message.includes('Cannot find beta-mac.yml')) {
    return '最新 GitHub 测试 Release 缺少 beta-mac.yml。请用测试版本打包命令重新生成，并上传 beta-mac.yml 与 zip/dmg 资产。';
  }
  if (message.includes('Cannot find beta.yml')) {
    return '最新 GitHub 测试 Release 缺少 beta.yml。请用 Windows 测试版本打包命令重新生成，并上传 beta.yml 与安装包。';
  }
  if (message.includes('Cannot find latest-mac.yml')) {
    return '最新 GitHub Release 缺少 latest-mac.yml。请用 pnpm run dist:mac 重新打包，并上传生成的 latest-mac.yml 与 zip/dmg 资产。';
  }
  if (message.includes('Cannot find latest.yml')) {
    return '最新 GitHub Release 缺少 latest.yml。请用 Windows 打包命令重新生成，并上传 latest.yml 与安装包。';
  }
  if (message.includes('Unable to find latest version on GitHub')) {
    return '未找到可用的 GitHub 生产 Release，请确认最新版本已发布且包含更新元数据。';
  }
  if (message.includes('GitHub Release 检查失败：404')) {
    return '无法访问 GitHub Release，请确认仓库或 Release 可公开访问。';
  }
  if (message.includes('GitHub Release 检查失败：406')) {
    return 'GitHub Release 返回不可用响应，请稍后重试或检查发布配置。';
  }
  return message.length > 180 ? `${message.slice(0, 180)}…` : message;
}

function updateErrorState(error: Error) {
  const message = formatUpdateError(error);
  return updateState({
    status: 'error',
    error: message,
    message: `更新失败：${message}`,
  });
}

autoUpdater.on('checking-for-update', () => {
  updateState({ status: 'checking', error: undefined, message: '正在检查更新…' });
});

autoUpdater.on('update-available', updateAvailableState);

autoUpdater.on('update-not-available', (info) => {
  updateState({
    status: 'not-available',
    latestVersion: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseNotes: toReleaseNotesText(info.releaseNotes),
    progress: undefined,
    error: undefined,
    message: '已是最新版本',
  });
});

autoUpdater.on('download-progress', (progress) => {
  updateState({ status: 'downloading', progress: normalizeProgress(progress), error: undefined, message: '正在下载更新…' });
});

autoUpdater.on('update-downloaded', updateDownloadedState);

autoUpdater.on('error', updateErrorState);

export function getAppUpdateState() {
  return state;
}

export function onAppUpdateStateChanged(listener: TAppUpdateListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setInstallUpdateHandler(handler: () => void) {
  installHandler = handler;
}

export async function checkAppUpdate(options: { silent?: boolean; settings?: IAppUpdateSettings } = {}) {
  applyUpdaterSettings(options.settings);
  if (!app.isPackaged) {
    if (checkingPromise) return checkingPromise;
    checkingPromise = checkDevGitHubRelease(options.settings)
      .catch((error: Error) => updateErrorState(error))
      .finally(() => {
        checkingPromise = undefined;
      });
    return checkingPromise;
  }
  if (checkingPromise) return checkingPromise;
  checkingPromise = autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result) return getAppUpdateState();
      return result.isUpdateAvailable ? updateAvailableState(result.updateInfo) : getAppUpdateState();
    })
    .catch((error: Error) => updateErrorState(error))
    .finally(() => {
      checkingPromise = undefined;
    });
  return checkingPromise;
}

export async function downloadAppUpdate(settings?: IAppUpdateSettings) {
  downloadSettingsOverride = settings;
  applyUpdaterSettings(settings);
  if (!app.isPackaged) {
    return updateState({ status: 'error', error: '自动升级仅在 Electron 打包应用中可用', message: '自动升级仅在 Electron 打包应用中可用' });
  }
  if (state.status === 'downloaded') return state;
  if (downloadPromise) return downloadPromise;
  updateState({ status: 'downloading', error: undefined, message: '正在下载更新…' });
  downloadPromise = autoUpdater
    .downloadUpdate()
    .then(() => getAppUpdateState())
    .catch((error: Error) => updateErrorState(error))
    .finally(() => {
      downloadPromise = undefined;
    });
  return downloadPromise;
}

export async function installAppUpdate() {
  if (state.status !== 'downloaded') {
    return updateState({ status: 'error', error: '更新尚未下载完成', message: '更新尚未下载完成' });
  }
  installHandler?.();
  autoUpdater.quitAndInstall(false, true);
  return state;
}

export async function openAppReleaseNotes() {
  await shell.openExternal(GITHUB_RELEASES_URL);
}
