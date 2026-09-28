/** 排程段状态 */
export type SessionStatus = '待执行' | '进行中' | '已完成' | '因云取消';

/** 执行登记记录（观测结束后由值班员补录，独立于计划信息，编辑计划时段不会清除） */
export interface ExecutionRecord {
  /** 实际开始时刻 HH:mm */
  actualStartTime: string;
  /** 实际结束时刻 HH:mm（可跨零点）；进行中的段可先只登记开始时间，此时留空 */
  actualEndTime?: string;
  /** 有效帧数；完成登记时填写，进行中留空，禁止用计划帧数顶替 */
  validFrames?: number;
  /** 短拍 / 提前结束原因：帧数不足或实际时段短于计划时段时必填 */
  shortReason?: string;
  /** 最近一次登记时间 ISO 字符串 */
  registeredAt: string;
}

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
  /** 执行登记：无记录表示未登记，展示时不得用计划帧数顶替 */
  execution?: ExecutionRecord;
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
