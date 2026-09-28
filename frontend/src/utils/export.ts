import type { Instrument, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';
import { endedEarly, frameShortfall, hasExecutionRecord, isExecutionComplete } from '../types';

export interface PlanContext {
  night?: ObsNight;
  sessions: ObsSession[];
  targets: ObsTarget[];
  telescopes: Telescope[];
  instruments: Instrument[];
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 执行登记情况文案：未登记显式标注，绝不用计划帧数顶替 */
function executionSummary(session: ObsSession): { time: string; frames: string; shortfall: string; remark: string } {
  if (!hasExecutionRecord(session)) {
    return { time: '未登记', frames: '未登记', shortfall: '未登记', remark: '' };
  }
  if (!isExecutionComplete(session)) {
    return { time: `${session.actualStartTime} 起（进行中）`, frames: '进行中', shortfall: ' -', remark: '' };
  }
  const shortfall = frameShortfall(session);
  const early = endedEarly(session);
  const parts: string[] = [];
  if (shortfall > 0) parts.push(`短拍 ${shortfall} 帧`);
  if (early) parts.push('提前结束');
  if (shortfall === 0 && !early) parts.push('足额完成');
  if (session.shortReason) parts.push(session.shortReason);
  return {
    time: `${session.actualStartTime}-${session.actualEndTime}`,
    frames: String(session.actualFrames),
    shortfall: shortfall > 0 ? `-${shortfall}` : '0',
    remark: parts.join('；'),
  };
}

/** 生成当晚观测清单文本（目标、时刻、滤镜、帧数与执行结果） */
export function buildNightPlanText(context: PlanContext): string {
  const { night, sessions, targets, telescopes, instruments } = context;
  const lines: string[] = [];
  lines.push('天文观测夜执行清单');
  lines.push(`观测夜：${night?.date ?? '-'}　站点：${night?.siteName ?? '-'}　值班人：${night?.dutyOfficer ?? '-'}`);
  lines.push(
    `月相：${night ? `${night.moonPhasePct}%（${night.moonrise} 月出 / ${night.moonset} 月落）` : '-'}　日落日出：${
      night ? `${night.sunset} / ${night.sunrise}` : '-'
    }　云量预报：${night?.cloudText ?? '-'}`,
  );
  lines.push('-'.repeat(118));
  lines.push('序 计划时段       实际时段              目标            望远镜   终端            滤镜  计划  有效  差额 状态      备注');
  const ordered = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  ordered.forEach((session, index) => {
    const target = targets.find((item) => item.id === session.targetId);
    const telescope = telescopes.find((item) => item.id === session.telescopeId);
    const instrument = instruments.find((item) => item.id === session.instrumentId);
    const execution = executionSummary(session);
    const reason = [execution.remark, session.rescheduleReason ? `改期：${session.rescheduleReason}` : ''].filter(Boolean).join('；');
    lines.push(
      [
        pad(index + 1),
        `${session.startTime}-${session.endTime}`.padEnd(14, ' '),
        execution.time.padEnd(20, ' '),
        `${target?.name ?? '未知目标'}（${target?.catalog ?? '-'}）`.padEnd(24, ' '),
        (telescope?.code ?? '-').padEnd(8, ' '),
        (instrument?.model ?? '-').padEnd(16, ' '),
        session.filterSlot.padEnd(4, ' '),
        pad(session.plannedFrames, 4),
        execution.frames.padStart(4, ' '),
        execution.shortfall.padStart(4, ' '),
        session.status.padEnd(8, ' '),
        reason,
      ].join(' '),
    );
  });
  lines.push('-'.repeat(118));

  const registered = ordered.filter(hasExecutionRecord);
  const completed = ordered.filter(isExecutionComplete);
  const totalPlanned = ordered.reduce((sum, session) => sum + session.plannedFrames, 0);
  const totalActual = completed.reduce((sum, session) => sum + (session.actualFrames ?? 0), 0);
  const totalShortfall = completed.reduce((sum, session) => sum + frameShortfall(session), 0);
  const totalExposure = completed.reduce((sum, session) => {
    const target = targets.find((item) => item.id === session.targetId);
    return sum + (target ? ((session.actualFrames ?? 0) * target.exposureSec) / 60 : 0);
  }, 0);
  lines.push(`排程段合计 ${ordered.length} 段，已登记 ${registered.length} 段（其中完结 ${completed.length} 段，进行中 ${registered.length - completed.length} 段），未登记 ${ordered.length - registered.length} 段`);
  lines.push(`计划帧数 ${totalPlanned} 帧；已完结段实际有效帧数 ${totalActual} 帧，短拍差额 ${totalShortfall} 帧，实际曝光 ${totalExposure.toFixed(1)} 分钟（未登记段不计入）`);
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

/** 生成 CSV */
export function buildPlanCsv(context: PlanContext): string {
  const { sessions, targets, telescopes, instruments } = context;
  const header = [
    '观测夜',
    '计划时段',
    '实际开始',
    '实际结束',
    '目标名',
    '星表编号',
    '类型',
    '视星等',
    '望远镜',
    '终端',
    '滤镜',
    '计划帧数',
    '实际有效帧数',
    '短拍差额',
    '执行登记',
    '状态',
    '短拍/提前结束原因',
    '改期原因',
  ];
  const rows = [...sessions]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((session) => {
      const target = targets.find((item) => item.id === session.targetId);
      const telescope = telescopes.find((item) => item.id === session.telescopeId);
      const instrument = instruments.find((item) => item.id === session.instrumentId);
      const registered = hasExecutionRecord(session);
      const complete = isExecutionComplete(session);
      return [
        session.nightId,
        `${session.startTime}-${session.endTime}`,
        session.actualStartTime ?? '',
        session.actualEndTime ?? '',
        target?.name ?? '',
        target?.catalog ?? '',
        target?.type ?? '',
        target ? String(target.magnitude) : '',
        telescope?.code ?? '',
        instrument?.model ?? '',
        session.filterSlot,
        String(session.plannedFrames),
        complete ? String(session.actualFrames) : '',
        complete ? String(frameShortfall(session)) : '',
        !registered ? '未登记' : complete ? '已完结' : '进行中',
        session.status,
        session.shortReason ?? '',
        session.rescheduleReason ?? '',
      ];
    });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return `﻿${csv}`;
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 打印当前视图（打印视图） */
export function printPage(): void {
  window.print();
}
