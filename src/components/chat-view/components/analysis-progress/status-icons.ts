import { CheckCircle, Circle, CircleMinus, LoaderCircle, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { IAgentStatus, IDataSource, IStep } from './types';

interface IStatusIconConfig {
  Icon: LucideIcon;
  label: string;
  spin?: boolean;
}

const pending: IStatusIconConfig = { Icon: Circle, label: '等待中' };
const running: IStatusIconConfig = { Icon: LoaderCircle, label: '进行中', spin: true };
const completed: IStatusIconConfig = { Icon: CheckCircle, label: '已完成' };
const skipped: IStatusIconConfig = { Icon: CircleMinus, label: '已跳过' };
const error: IStatusIconConfig = { Icon: XCircle, label: '失败' };

export const STEP_STATUS_ICONS: Record<IStep['status'], IStatusIconConfig> = {
  pending,
  running,
  completed,
  skipped,
  error,
};

export const AGENT_STATUS_ICONS: Record<IAgentStatus['status'], IStatusIconConfig> = {
  pending,
  running,
  completed,
  error,
};

export const DATA_SOURCE_STATUS_ICONS: Record<IDataSource['status'], IStatusIconConfig> = {
  pending,
  loading: running,
  done: completed,
  error,
};
