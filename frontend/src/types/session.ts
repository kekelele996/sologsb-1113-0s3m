import { NIGHT_START_MINUTES } from './night';

/** 排程段状态 */
export type SessionStatus = '待执行' | '进行中' | '已完成' | '因云取消';

/** 观测排程段 */
export interface ObsSession {
  id: string;
  /** 观测夜 ID */
  nightId: string;
  /** 观测目标 ID */
  targetId: string;
  /** 开始时刻 HH:mm */
  startTime: string;
  /** 结束时刻 HH:mm（可跨零点） */
  endTime: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 终端 ID */
  instrumentId: string;
  /** 滤镜轮位 */
  filterSlot: string;
  /** 计划帧数 */
  plannedFrames: number;
  /** 状态 */
  status: SessionStatus;
  /** 改期原因 */
  rescheduleReason?: string;
  /** 替补夜 ID（迁移时补齐） */
  backupNightId?: string;
  /** 实际开始时刻 HH:mm（执行登记；存在即视为已登记，进行中可只填此项） */
  actualStartTime?: string;
  /** 实际结束时刻 HH:mm（观测完成后补录，可跨零点） */
  actualEndTime?: string;
  /** 实际有效帧数（观测完成后补录，不用计划帧数顶替） */
  actualFrames?: number;
  /** 短拍 / 提前结束原因（帧数不足或提前结束时必填） */
  shortReason?: string;
  /** 数据结构版本 */
  schemaVersion: number;
}

/** 冲突项 */
export interface ConflictItem {
  /** 当前排程段 */
  sessionId: string;
  /** 与之冲突的排程段 */
  otherId: string;
  nightId: string;
  telescopeId: string;
  /** 重叠分钟数 */
  overlapMinutes: number;
  /** 重叠区间文案 */
  overlapText: string;
}

export const SESSION_STATUSES: SessionStatus[] = ['待执行', '进行中', '已完成', '因云取消'];

/** 4 种状态配色（MUI Chip color） */
export const STATUS_CHIP_COLOR: Record<SessionStatus, 'default' | 'primary' | 'success' | 'error'> = {
  待执行: 'default',
  进行中: 'primary',
  已完成: 'success',
  因云取消: 'error',
};

/** 夜间时间轴以 NIGHT_START_MINUTES 起算，跨零点自动 +1440（与 utils/astro 的 axisMinutes 保持一致） */
function sessionAxisMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((value) => Number(value) || 0);
  const clock = h * 60 + m;
  return clock >= NIGHT_START_MINUTES ? clock - NIGHT_START_MINUTES : clock + (1440 - NIGHT_START_MINUTES);
}

/** 两个 HH:mm 时刻之间的时长（分钟，支持跨零点） */
function sessionDurationMinutes(startTime: string, endTime: string): number {
  const start = sessionAxisMinutes(startTime);
  let end = sessionAxisMinutes(endTime);
  if (end <= start) end += 1440;
  return end - start;
}

/** 是否已执行登记：有实际开始时间即视为已登记（进行中也可先只留开始时间） */
export function hasExecutionRecord(session: ObsSession): boolean {
  return Boolean(session.actualStartTime);
}

/** 登记是否已完结（实际起止与有效帧数齐全，可据此核对帧数与时长） */
export function isExecutionComplete(session: ObsSession): boolean {
  return Boolean(session.actualStartTime && session.actualEndTime && session.actualFrames !== undefined);
}

/** 短拍帧差：计划帧数 - 实际有效帧数（不足返回正数差额，足额/超额/未登记返回 0） */
export function frameShortfall(session: ObsSession): number {
  if (session.actualFrames === undefined) return 0;
  return Math.max(0, session.plannedFrames - session.actualFrames);
}

/** 是否提前结束：实际时长短于计划时长（需实际起止均已登记） */
export function endedEarly(session: ObsSession): boolean {
  if (!session.actualStartTime || !session.actualEndTime) return false;
  return sessionDurationMinutes(session.actualStartTime, session.actualEndTime) < sessionDurationMinutes(session.startTime, session.endTime);
}

/** 执行登记是否缺少必填的短拍 / 提前结束原因（供页面校验与提示复用） */
export function missingShortReason(session: ObsSession): boolean {
  if (!isExecutionComplete(session)) return false;
  return (frameShortfall(session) > 0 || endedEarly(session)) && !session.shortReason?.trim();
}
