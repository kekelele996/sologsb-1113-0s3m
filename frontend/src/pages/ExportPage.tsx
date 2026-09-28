import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Timeline, { type TimelineBar } from '../components/common/Timeline';
import ConflictBadge from '../components/common/ConflictBadge';
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR } from '../types';
import { axisMinutes, formatMinutes, timelineTicks } from '../utils/astro';
import { summarizeExecution } from '../utils/execution';
import { buildNightPlanText, buildPlanCsv, downloadText, printPage } from '../utils/export';

/** 导出当晚观测清单（文本 / CSV / 打印视图），完成情况与帧数按实际执行登记展示 */
export default function ExportPage() {
  usePersistentStore();
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const sessions = useSessionStore((s) => s.sessions);
  const targets = useTargetStore((s) => s.targets);
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const { conflictsOfNight, conflictIds } = useConflictCheck();
  const [notice, setNotice] = useState('');

  const night = nights.find((item) => item.id === currentNightId) ?? nights[0];
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === night?.id), [sessions, night?.id]);
  const conflicts = useMemo(() => conflictsOfNight(night?.id ?? ''), [conflictsOfNight, night?.id]);
  const ids = useMemo(() => conflictIds(night?.id), [conflictIds, night?.id]);

  /** 按执行登记统计完成情况：未登记不计入有效帧，绝不用计划帧数顶替 */
  const stats = useMemo(() => {
    let finishedCount = 0;
    let ongoingCount = 0;
    let unregisteredCount = 0;
    let plannedTotal = 0;
    let validTotal = 0;
    let finishedPlannedTotal = 0;
    let shortfallTotal = 0;
    nightSessions.forEach((session) => {
      const summary = summarizeExecution(session);
      plannedTotal += session.plannedFrames;
      if (summary.finished) {
        finishedCount += 1;
        validTotal += session.execution?.validFrames ?? 0;
        finishedPlannedTotal += session.plannedFrames;
        shortfallTotal += Math.max(0, summary.frameShortfall);
      } else if (summary.ongoing) {
        ongoingCount += 1;
      } else if (session.status !== '因云取消') {
        unregisteredCount += 1;
      }
    });
    return { finishedCount, ongoingCount, unregisteredCount, plannedTotal, validTotal, finishedPlannedTotal, shortfallTotal };
  }, [nightSessions]);

  const planText = useMemo(
    () => buildNightPlanText({ night, sessions: nightSessions, targets, telescopes, instruments }),
    [night, nightSessions, targets, telescopes, instruments],
  );
  const csv = useMemo(
    () => buildPlanCsv({ night, sessions: nightSessions, targets, telescopes, instruments }),
    [night, nightSessions, targets, telescopes, instruments],
  );

  const bars: TimelineBar[] = useMemo(
    () =>
      nightSessions.map((session) => {
        const target = targets.find((item) => item.id === session.targetId);
        const startMinute = Math.max(0, Math.min(NIGHT_TOTAL_MINUTES, axisMinutes(session.startTime)));
        const rawEnd = axisMinutes(session.endTime);
        const summary = summarizeExecution(session);
        return {
          id: session.id,
          startMinute,
          endMinute: Math.max(startMinute + 20, Math.min(NIGHT_TOTAL_MINUTES, rawEnd <= startMinute ? rawEnd + 1440 : rawEnd)),
          label: target?.name ?? '未知目标',
          color: target ? TARGET_COLOR[target.type] : '#607d8b',
          dimmed: session.status === '因云取消',
          tooltip:
            summary.finished && session.execution
              ? `${session.startTime}-${session.endTime} 计划 · 实际 ${session.execution.actualStartTime}-${session.execution.actualEndTime} · ${target?.name ?? ''} · 有效 ${session.execution.validFrames}/${session.plannedFrames} 帧 · 短拍差额 ${summary.frameShortfall > 0 ? `-${summary.frameShortfall}` : -summary.frameShortfall}`
              : `${session.startTime}-${session.endTime} · ${session.filterSlot} · 计划 ${session.plannedFrames} 帧 · ${summary.ongoing ? '进行中（未完成登记）' : '未登记'}`,
        };
      }),
    [nightSessions, targets],
  );

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        导出当晚观测清单
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        汇总计划与实际时段、计划/有效帧数、短拍差额与原因为文本与 CSV，并支持打印视图；未执行登记的排程段明确标注「未登记」，不以计划帧数顶替。
      </Typography>

      {notice ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
          {notice}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center" className="no-print">
        <TextField select size="small" label="观测夜" value={night?.id ?? ''} onChange={(event) => setCurrentNight(event.target.value)} sx={{ minWidth: 260 }}>
          {nights.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {`${item.date} · ${item.siteName} · ${item.cloudText}${item.primary ? '（主夜）' : item.backup ? '（备用夜）' : ''}`}
            </MenuItem>
          ))}
        </TextField>
        <Chip size="small" label={`排程段 ${nightSessions.length}`} />
        <Chip size="small" label={`计划帧数合计 ${stats.plannedTotal}`} />
        <Chip size="small" color="success" variant={stats.finishedCount ? 'filled' : 'outlined'} label={`已完成登记 ${stats.finishedCount} 段 · 有效 ${stats.validTotal} 帧`} />
        <Chip size="small" color="primary" variant="outlined" label={`进行中 ${stats.ongoingCount} 段`} />
        <Chip size="small" color="warning" variant={stats.unregisteredCount ? 'filled' : 'outlined'} label={`未登记 ${stats.unregisteredCount} 段`} />
        {stats.finishedCount ? <Chip size="small" color={stats.shortfallTotal > 0 ? 'warning' : 'success'} label={`短拍差额 ${stats.shortfallTotal} 帧`} /> : null}
        <ConflictBadge conflicts={conflicts} />
        <Button
          variant="contained"
          onClick={() => {
            downloadText(`观测清单-${night?.date ?? 'night'}.txt`, planText);
            setNotice('已下载观测清单文本文件');
          }}
        >
          下载文本
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => {
            downloadText(`观测清单-${night?.date ?? 'night'}.csv`, csv, 'text/csv');
            setNotice('已下载观测清单 CSV 文件');
          }}
        >
          下载 CSV
        </Button>
        <Button variant="outlined" onClick={() => printPage()}>
          打印视图
        </Button>
      </Stack>

      {stats.unregisteredCount > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          本夜还有 {stats.unregisteredCount} 个非取消排程段未做执行登记，导出与统计中其有效帧数按「未登记」处理，不会用计划帧数顶替；请在排程段列表补录后再导出。
        </Alert>
      ) : null}

      <Box className="no-print" sx={{ mb: 3 }}>
        <Timeline bars={bars} ticks={timelineTicks(120)} totalMinutes={NIGHT_TOTAL_MINUTES} conflictIds={ids} height={104} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            观测执行结果（文本预览）
          </Typography>
          <Box component="pre" sx={{ m: 0, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'Menlo, Consolas, monospace', maxHeight: 460, overflow: 'auto' }}>
            {planText}
          </Box>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            排程段执行核对
          </Typography>
          <Stack spacing={1}>
            {[...nightSessions]
              .sort((a, b) => axisMinutes(a.startTime) - axisMinutes(b.startTime))
              .map((session) => {
                const target = targets.find((item) => item.id === session.targetId);
                const summary = summarizeExecution(session);
                return (
                  <Stack key={session.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Chip size="small" label={`${session.startTime}-${session.endTime}`} />
                    <Typography variant="body2">{target?.name ?? '未知目标'}</Typography>
                    <Chip size="small" variant="outlined" label={session.filterSlot} />
                    {summary.finished && session.execution ? (
                      <>
                        <Chip
                          size="small"
                          color={summary.framesShort ? 'warning' : 'success'}
                          label={`有效 ${session.execution.validFrames}/${session.plannedFrames} 帧`}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          color={summary.frameShortfall > 0 ? 'warning' : 'success'}
                          label={
                            summary.frameShortfall > 0
                              ? `短拍 -${summary.frameShortfall}`
                              : summary.frameShortfall < 0
                                ? `超额 +${-summary.frameShortfall}`
                                : '足额'
                          }
                        />
                        <Typography variant="caption" color="text.secondary">
                          实际 {session.execution.actualStartTime}-{session.execution.actualEndTime}（{formatMinutes(summary.actualDuration ?? 0)}）
                        </Typography>
                        {summary.endedEarly ? <Chip size="small" color="warning" variant="outlined" label={`提前 ${formatMinutes(summary.plannedDuration - (summary.actualDuration ?? 0))}`} /> : null}
                        {session.execution.shortReason ? (
                          <Typography variant="caption" color="warning.main" sx={{ flexBasis: '100%' }}>
                            原因：{session.execution.shortReason}
                          </Typography>
                        ) : null}
                      </>
                    ) : summary.ongoing ? (
                      <Chip size="small" color="primary" label={`进行中 · 实际开始 ${session.execution?.actualStartTime}`} />
                    ) : (
                      <Chip size="small" color="warning" variant="outlined" label={`未登记（计划 ${session.plannedFrames} 帧）`} />
                    )}
                  </Stack>
                );
              })}
            {nightSessions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                该观测夜暂无排程段
              </Typography>
            ) : null}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
