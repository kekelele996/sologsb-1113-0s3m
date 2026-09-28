import type { Instrument, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';
import { summarizeExecution } from './execution';
import { durationMinutes } from './astro';

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

/** 字符串显示宽度：CJK 字符按 2 个 ASCII 宽度计，保证列对齐 */
function displayWidth(text: string): number {
  return Array.from(text).reduce((sum, ch) => sum + (ch.codePointAt(0) !== undefined && (ch.codePointAt(0) as number) > 0xff ? 2 : 1), 0);
}

function padEndCJK(text: string, width: number): string {
  const rest = width - displayWidth(text);
  return rest > 0 ? text + ' '.repeat(rest) : text;
}

/** 完成情况文案（与总览、列表口径一致；无执行记录一律「未登记」） */
function completionText(session: ObsSession): string {
  const summary = summarizeExecution(session);
  if (summary.finished) return '已完成';
  if (summary.ongoing) return '进行中';
  return '未登记';
}

/** 有效帧数文案 */
function validFramesText(session: ObsSession): string {
  const record = session.execution;
  if (!record) return '未登记';
  if (typeof record.validFrames !== 'number') return '进行中';
  return String(record.validFrames);
}

/** 短拍差额文案：计划 - 有效（仅完成登记；负为超额，其余显示 -） */
function deltaText(session: ObsSession): string {
  const summary = summarizeExecution(session);
  if (!summary.finished) return '-';
  if (summary.frameShortfall === 0) return '0';
  return summary.frameShortfall > 0 ? `-${summary.frameShortfall}` : `+${-summary.frameShortfall}`;
}

/** 实际时段文案 */
function actualRangeText(session: ObsSession): string {
  const record = session.execution;
  if (!record) return '未登记';
  if (!record.actualEndTime) return `${record.actualStartTime}-进行中`;
  return `${record.actualStartTime}-${record.actualEndTime}`;
}

/** 生成当晚观测清单文本（计划时段、实际时段、计划/有效帧数、短拍差额与原因） */
export function buildNightPlanText(context: PlanContext): string {
  const { night, sessions, targets, telescopes, instruments } = context;
  const lines: string[] = [];
  lines.push('天文观测夜执行结果表');
  lines.push(`观测夜：${night?.date ?? '-'}　站点：${night?.siteName ?? '-'}　值班人：${night?.dutyOfficer ?? '-'}`);
  lines.push(
    `月相：${night ? `${night.moonPhasePct}%（${night.moonrise} 月出 / ${night.moonset} 月落）` : '-'}　日落日出：${
      night ? `${night.sunset} / ${night.sunrise}` : '-'
    }　云量预报：${night?.cloudText ?? '-'}`,
  );
  lines.push('-'.repeat(132));
  const header =
    [
      padEndCJK('序', 3),
      padEndCJK('计划时段', 13),
      padEndCJK('实际时段', 14),
      padEndCJK('目标', 22),
      padEndCJK('望远镜', 7),
      padEndCJK('终端', 15),
      padEndCJK('滤镜', 7),
      padEndCJK('计划帧', 6),
      padEndCJK('有效帧', 7),
      padEndCJK('短拍差额', 8),
      padEndCJK('完成情况', 8),
      padEndCJK('排程状态', 8),
    ]
      .map((cell) => `${cell} `)
      .join('') + '短拍 / 提前结束原因';
  lines.push(header);
  const ordered = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  ordered.forEach((session, index) => {
    const target = targets.find((item) => item.id === session.targetId);
    const telescope = telescopes.find((item) => item.id === session.telescopeId);
    const instrument = instruments.find((item) => item.id === session.instrumentId);
    const reason = session.execution?.shortReason ?? '';
    const cells = [
      padEndCJK(pad(index + 1), 3),
      padEndCJK(`${session.startTime}-${session.endTime}`, 13),
      padEndCJK(actualRangeText(session), 14),
      padEndCJK(`${target?.name ?? '未知目标'}（${target?.catalog ?? '-'}）`, 22),
      padEndCJK(telescope?.code ?? '-', 7),
      padEndCJK(instrument?.model ?? '-', 15),
      padEndCJK(session.filterSlot, 7),
      padEndCJK(String(session.plannedFrames), 6),
      padEndCJK(validFramesText(session), 7),
      padEndCJK(deltaText(session), 8),
      padEndCJK(completionText(session), 8),
      padEndCJK(session.status, 8),
    ].map((cell) => `${cell} `);
    lines.push(cells.join('') + reason);
  });
  lines.push('-'.repeat(132));

  const finishedSessions = ordered.filter((session) => summarizeExecution(session).finished);
  const ongoingSessions = ordered.filter((session) => summarizeExecution(session).ongoing);
  const unregistered = ordered.filter((session) => {
    const summary = summarizeExecution(session);
    return summary.unregistered && session.status !== '因云取消';
  });
  const cancelled = ordered.filter((session) => session.status === '因云取消');
  const totalPlanned = ordered.reduce((sum, session) => sum + session.plannedFrames, 0);
  const totalValid = finishedSessions.reduce((sum, session) => sum + (session.execution?.validFrames ?? 0), 0);
  const totalShortfall = finishedSessions.reduce((sum, session) => sum + Math.max(0, summarizeExecution(session).frameShortfall), 0);
  const finishedPlanned = finishedSessions.reduce((sum, session) => sum + session.plannedFrames, 0);

  lines.push(
    `合计排程段 ${ordered.length} 段：完成登记 ${finishedSessions.length} 段，进行中 ${ongoingSessions.length} 段，未登记 ${unregistered.length} 段${
      cancelled.length ? `，因云取消 ${cancelled.length} 段` : ''
    }`,
  );
  lines.push(`计划帧数合计 ${totalPlanned} 帧`);
  if (finishedSessions.length) {
    lines.push(
      `已完成登记计划 ${finishedPlanned} 帧、有效 ${totalValid} 帧，短拍差额合计 ${totalShortfall} 帧${totalShortfall > 0 ? `（有效帧少 ${totalShortfall}）` : '（无短拍）'}`,
    );
  } else {
    lines.push('尚无完成登记的排程段，有效帧数未登记，不以计划帧数顶替');
  }

  const shortSessions = ordered.filter((session) => {
    const summary = summarizeExecution(session);
    return summary.finished && summary.needsShortReason;
  });
  if (shortSessions.length) {
    lines.push('短拍 / 提前结束明细：');
    shortSessions.forEach((session) => {
      const target = targets.find((item) => item.id === session.targetId);
      const summary = summarizeExecution(session);
      const bits: string[] = [];
      if (summary.framesShort) bits.push(`帧数 ${session.execution?.validFrames}/${session.plannedFrames}（少 ${summary.frameShortfall} 帧）`);
      if (summary.endedEarly) bits.push(`提前 ${summary.plannedDuration - (summary.actualDuration ?? 0)} 分钟`);
      lines.push(`  · ${session.startTime}-${session.endTime} ${target?.name ?? '未知目标'}：${bits.join('，')}；原因：${session.execution?.shortReason ?? '（未填写）'}`);
    });
  }
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

/** 生成 CSV：计划与实际分列，未登记留空并在完成情况列显式标注 */
export function buildPlanCsv(context: PlanContext): string {
  const { sessions, targets, telescopes, instruments } = context;
  const header = [
    '观测夜',
    '计划开始',
    '计划结束',
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
    '有效帧数',
    '短拍差额(计划-有效)',
    '计划时长(分钟)',
    '实际时长(分钟)',
    '完成情况',
    '排程状态',
    '短拍/提前结束原因',
    '改期原因',
  ];
  const rows = [...sessions]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((session) => {
      const target = targets.find((item) => item.id === session.targetId);
      const telescope = telescopes.find((item) => item.id === session.telescopeId);
      const instrument = instruments.find((item) => item.id === session.instrumentId);
      const summary = summarizeExecution(session);
      const record = session.execution;
      const plannedDuration = durationMinutes(session.startTime, session.endTime);
      return [
        session.nightId,
        session.startTime,
        session.endTime,
        record?.actualStartTime ?? '',
        record?.actualEndTime ?? '',
        target?.name ?? '',
        target?.catalog ?? '',
        target?.type ?? '',
        target ? String(target.magnitude) : '',
        telescope?.code ?? '',
        instrument?.model ?? '',
        session.filterSlot,
        String(session.plannedFrames),
        summary.finished ? String(record?.validFrames ?? '') : '',
        summary.finished ? String(summary.frameShortfall) : '',
        String(plannedDuration),
        summary.finished ? String(summary.actualDuration ?? '') : '',
        completionText(session),
        session.status,
        summary.finished && summary.needsShortReason ? record?.shortReason ?? '' : '',
        session.rescheduleReason ?? '',
      ];
    });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return '\uFEFF' + csv;
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
