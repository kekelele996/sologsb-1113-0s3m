import type { ExecutionRecord, ObsSession } from '../types';
import { durationMinutes } from './astro';

/** 执行登记状态（区分于排程状态，只看登记记录本身） */
export type ExecutionState = 'finished' | 'ongoing' | 'unregistered';

/** 执行登记汇总信息，供总览、列表与导出统一消费，避免各处口径不一致 */
export interface ExecutionSummary {
  state: ExecutionState;
  /** 是否已完成登记（有实际结束与有效帧数） */
  finished: boolean;
  /** 是否进行中（只登记了实际开始） */
  ongoing: boolean;
  /** 是否未登记（无执行记录，不能拿计划帧数顶替） */
  unregistered: boolean;
  /** 短拍差额 = 计划帧数 - 有效帧数，仅完成登记时计算；为正即短拍 */
  frameShortfall: number;
  /** 有效帧数是否不足计划 */
  framesShort: boolean;
  /** 实际时长是否短于计划时长（提前结束） */
  endedEarly: boolean;
  /** 是否需要填写短拍原因（帧数不足或提前结束） */
  needsShortReason: boolean;
  /** 已登记的短拍 / 提前结束原因是否缺失 */
  missingShortReason: boolean;
  /** 实际时长（分钟，跨零点安全）；仅完成登记时可得 */
  actualDuration: number | null;
  /** 计划时长（分钟） */
  plannedDuration: number;
}

/** HH:mm 格式校验 */
export function isValidHHmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** 提前结束判定容差（分钟）：实际短于计划超过该值才算提前结束，规避取整误差 */
const EARLY_END_TOLERANCE_MINUTES = 1;

/** 汇总单段执行登记结果 */
export function summarizeExecution(session: ObsSession): ExecutionSummary {
  const plannedDuration = durationMinutes(session.startTime, session.endTime);
  const record: ExecutionRecord | undefined = session.execution;

  if (!record) {
    return {
      state: 'unregistered',
      finished: false,
      ongoing: false,
      unregistered: true,
      frameShortfall: 0,
      framesShort: false,
      endedEarly: false,
      needsShortReason: false,
      missingShortReason: false,
      actualDuration: null,
      plannedDuration,
    };
  }

  const hasEnd = Boolean(record.actualEndTime && record.actualEndTime.trim());
  const hasFrames = typeof record.validFrames === 'number';

  // 只登记开始时间：进行中
  if (!hasEnd || !hasFrames) {
    return {
      state: 'ongoing',
      finished: false,
      ongoing: true,
      unregistered: false,
      frameShortfall: 0,
      framesShort: false,
      endedEarly: false,
      needsShortReason: false,
      missingShortReason: false,
      actualDuration: null,
      plannedDuration,
    };
  }

  const validFrames = record.validFrames as number;
  const actualDuration = durationMinutes(record.actualStartTime, record.actualEndTime as string);
  const framesShort = validFrames < session.plannedFrames;
  const endedEarly = plannedDuration - actualDuration > EARLY_END_TOLERANCE_MINUTES;
  const needsShortReason = framesShort || endedEarly;
  return {
    state: 'finished',
    finished: true,
    ongoing: false,
    unregistered: false,
    frameShortfall: session.plannedFrames - validFrames,
    framesShort,
    endedEarly,
    needsShortReason,
    missingShortReason: needsShortReason && !record.shortReason?.trim(),
    actualDuration,
    plannedDuration,
  };
}

/** 执行登记校验输入 */
export interface ExecutionInput {
  actualStartTime: string;
  actualEndTime: string;
  validFrames: string;
  shortReason: string;
}

export interface ExecutionValidation {
  ok: boolean;
  error: string;
  /** 归一化后的登记记录（校验通过时可用） */
  record?: ExecutionRecord;
  /** 是否完成登记（false 表示仅登记开始时间的进行中记录） */
  finished: boolean;
  /** 帧数不足或提前结束（用于保存后的提示） */
  short: boolean;
}

/**
 * 校验执行登记表单：
 * - 实际开始必填；
 * - 结束时间与有效帧数都留空时视为「进行中」，只保存开始时间；
 * - 只要填了结束或帧数其中一个，就按完成登记要求另一个必填；
 * - 完成登记时帧数不足或提前结束必须填写原因。
 */
export function validateExecution(session: ObsSession, input: ExecutionInput, now = new Date()): ExecutionValidation {
  const start = input.actualStartTime.trim();
  const end = input.actualEndTime.trim();
  const framesText = input.validFrames.trim();
  const reason = input.shortReason.trim();

  if (!isValidHHmm(start)) {
    return { ok: false, error: '请填写实际开始时间（HH:mm）', finished: false, short: false };
  }
  if (end && !isValidHHmm(end)) {
    return { ok: false, error: '实际结束时间格式应为 HH:mm', finished: false, short: false };
  }
  if (framesText && (!/^\d+$/.test(framesText) || Number(framesText) < 0)) {
    return { ok: false, error: '有效帧数需为不小于 0 的整数；进行中可留空', finished: false, short: false };
  }

  // 进行中：只留开始时间
  if (!end && !framesText) {
    return {
      ok: true,
      error: '',
      finished: false,
      short: false,
      record: {
        actualStartTime: start,
        registeredAt: now.toISOString(),
      },
    };
  }

  if (!end) {
    return { ok: false, error: '已填写有效帧数，请同时填写实际结束时间（完成登记）', finished: false, short: false };
  }
  if (!framesText) {
    return { ok: false, error: '已填写实际结束时间，请同时填写有效帧数（完成登记）', finished: false, short: false };
  }
  if (durationMinutes(start, end) <= 0) {
    return { ok: false, error: '实际结束时刻必须晚于实际开始时刻', finished: false, short: false };
  }

  const validFrames = Number(framesText);
  const plannedDuration = durationMinutes(session.startTime, session.endTime);
  const actualDuration = durationMinutes(start, end);
  const framesShort = validFrames < session.plannedFrames;
  const endedEarly = plannedDuration - actualDuration > EARLY_END_TOLERANCE_MINUTES;
  if ((framesShort || endedEarly) && !reason) {
    const bits: string[] = [];
    if (framesShort) bits.push(`有效帧数 ${validFrames} 少于计划 ${session.plannedFrames}`);
    if (endedEarly) bits.push(`实际时长 ${actualDuration} 分钟短于计划 ${plannedDuration} 分钟（提前结束）`);
    return { ok: false, error: `${bits.join('；')}，请填写短拍 / 提前结束原因`, finished: true, short: true };
  }

  return {
    ok: true,
    error: '',
    finished: true,
    short: framesShort || endedEarly,
    record: {
      actualStartTime: start,
      actualEndTime: end,
      validFrames,
      shortReason: reason || undefined,
      registeredAt: now.toISOString(),
    },
  };
}
