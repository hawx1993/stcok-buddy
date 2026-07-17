import { app } from 'electron';
import { release } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostHog } from 'posthog-node';
import { getDeviceId } from '../config-store.js';

let _client: PostHog | null = null;

type TelemetryProperties = Record<string, unknown>;

function readPackagedTelemetryConfig() {
  const file = path.join(process.resourcesPath, 'telemetry.json');
  if (!app.isPackaged || !existsSync(file)) return {} as { posthogKey?: string; posthogHost?: string };
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { posthogKey?: string; posthogHost?: string };
  } catch {
    return {};
  }
}

export function getPostHogClient(): PostHog | null {
  if (_client) return _client;

  if (!app.isPackaged) return null;

  const packagedConfig = readPackagedTelemetryConfig();
  const apiKey = process.env.POSTHOG_API_KEY || packagedConfig.posthogKey;
  const host = process.env.POSTHOG_HOST || packagedConfig.posthogHost;

  if (!apiKey) return null;

  _client = new PostHog(apiKey, {
    host: host || 'https://us.i.posthog.com',
    flushAt: 5,
    flushInterval: 10000,
  });

  return _client;
}

export function getTelemetryBaseProperties(): TelemetryProperties {
  return {
    app_version: app.getVersion(),
    electron_version: process.versions.electron,
    os_version: release(),
    platform: process.platform,
    arch: process.arch,
    is_packaged: app.isPackaged,
    device_id: getDeviceId(),
  };
}

export function captureEvent(event: string, properties: TelemetryProperties = {}): void {
  const client = getPostHogClient();
  if (!client) return;
  client.capture({
    distinctId: getDeviceId(),
    event,
    properties: { ...getTelemetryBaseProperties(), ...properties },
  });
}

export function captureError(event: string, error: unknown, properties: TelemetryProperties = {}): void {
  captureEvent(event, {
    ...properties,
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: String(error instanceof Error ? error.message : error).slice(0, 500),
    error_stack: error instanceof Error ? error.stack?.slice(0, 1000) : undefined,
  });
}

export async function shutdownPostHog(): Promise<void> {
  if (_client) {
    await _client.shutdown();
    _client = null;
  }
}
