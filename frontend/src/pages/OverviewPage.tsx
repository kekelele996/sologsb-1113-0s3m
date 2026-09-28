import { useMemo } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Timeline, { type TimelineBar } from '../components/common/Timeline';
import StatusChip from '../components/common/StatusChip';
import ConflictBadge from '../components/common/ConflictBadge';
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { useNightStore } from '../stores/nightStore';
import { useSessionStore } from '../stores/sessionStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR } from '../types';
import { altitudeAt, axisMinutes, formatMinutes, isBelowThreshold, minutesToTime, moonBrightnessFactor, moonConflict, moonPhaseText, timelineTicks } from '../utils/astro';
import { summarizeExecution } from '../utils/execution';

/** 本夜编排总览：30 分钟刻度时间轴 + 月相条带 + 按实际执行登记展示完成情况与短拍差额 */
export default function OverviewPage() {
  usePersistentStore();
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const sessions = useSessionStore((s) => s.sessions);
  const targets = useTargetStore((s) => s.targets);
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const { conflictIds, conflictsOfNight } = useConflictCheck();

  const night = nights.find((item) => item.id === currentNightId) ?? nights[0];
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === night?.id), [sessions, night?.id]);
  const ids = useMemo(() => conflictIds(night?.id), [conflictIds, night?.id]);
  const conflicts = useMemo(() => conflictsOfNight(night?.id ?? ''), [conflictsOfNight, night?.id]);

  /** 以夜间 22:00 作为高度角评估时刻 */
  const evaluateDate = useMemo(() => new Date(`${night?.date ?? '2025-10-11'}T22:00:00`), [night?.date]);

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((item) => item.id === id);
  const instrumentById = (id: string) => instruments.find((item) => item.id === id);

  const altitudes = useMemo(() => {
    const map = new Map<string, { altitude: number; below: boolean }>();
    targets.forEach((target) => {
      const altitude = altitudeAt(target, evaluateDate, night?.siteLat ?? 0, night?.siteLng ?? 0);
      map.set(target.id, { altitude, below: isBelowThreshold(altitude, target.minAltitude) });
    });
    return map;
  }, [targets, evaluateDate, night?.siteLat, night?.siteLng]);

  const bars: TimelineBar[] = useMemo(
    () =>
      nightSessions.map((session) => {
        const target = targetById(session.targetId);
        const altitude = altitudes.get(session.targetId);
        const startMinute = Math.max(0, Math.min(NIGHT_TOTAL_MINUTES, axisMinutes(session.startTime)));
        const rawEnd = axisMinutes(session.endTime);
        const summary = summarizeExecution(session);
        const executionText = summary.finished
          ? `｜实际 ${session.execution?.actualStartTime}-${session.execution?.actualEndTime}｜有效 ${session.execution?.validFrames}/${session.plannedFrames} 帧｜短拍差额 ${
              summary.frameShortfall > 0 ? `-${summary.frameShortfall}` : -summary.frameShortfall
            }`
          : summary.ongoing
            ? `｜进行中，实际开始 ${session.execution?.actualStartTime}，完成情况未登记`
            : '｜执行未登记';
        return {
          id: session.id,
          startMinute,
          endMinute: Math.max(startMinute + 20, Math.min(NIGHT_TOTAL_MINUTES, rawEnd <= startMinute ? rawEnd + 1440 : rawEnd)),
          label: `${target?.name ?? '未知目标'} · ${telescopeById(session.telescopeId)?.code ?? '-'}`,
          color: target ? TARGET_COLOR[target.type] : '#607d8b',
          dimmed: session.status === '因云取消' || Boolean(altitude?.below),
          tooltip: `${session.startTime}-${session.endTime} ${target?.name ?? ''}｜${telescopeById(session.telescopeId)?.code ?? '-'} / ${
            instrumentById(session.instrumentId)?.model ?? '-'
          }｜${session.filterSlot}｜计划 ${session.plannedFrames} 帧｜${session.status}${executionText}｜评估高度角 ${altitude?.altitude ?? '-'}°`,
        };
      }),
    [nightSessions, targets, altitudes, telescopes, instruments],
  );

  /** 执行完成情况统计：有效帧数与短拍差额只统计完成登记的段，未登记不计入、不以计划帧顶替 */
  const executionStats = useMemo(() => {
    let plannedTotal = 0;
    let finishedCount = 0;
    let ongoingCount = 0;
    let unregisteredCount = 0;
    let validTotal = 0;
    let finishedPlanned = 0;
    let shortfallTotal = 0;
    const unregisteredSessions: typeof nightSessions = [];
    const shortSessions: typeof nightSessions = [];
    nightSessions.forEach((session) => {
      plannedTotal += session.plannedFrames;
      const summary = summarizeExecution(session);
      if (summary.finished) {
        finishedCount += 1;
        validTotal += session.execution?.validFrames ?? 0;
        finishedPlanned += session.plannedFrames;
        shortfallTotal += Math.max(0, summary.frameShortfall);
        if (summary.needsShortReason) shortSessions.push(session);
      } else if (summary.ongoing) {
        ongoingCount += 1;
      } else if (session.status !== '因云取消') {
        unregisteredCount += 1;
        unregisteredSessions.push(session);
      }
    });
    return { plannedTotal, finishedCount, ongoingCount, unregisteredCount, validTotal, finishedPlanned, shortfallTotal, unregisteredSessions, shortSessions };
  }, [nightSessions]);

  const dimmedTargets = useMemo(
    () => Array.from(new Set(nightSessions.map((session) => session.targetId))).filter((id) => altitudes.get(id)?.below),
    [nightSessions, altitudes],
  );
  const moonConflicts = useMemo(
    () =>
      Array.from(new Set(nightSessions.map((session) => session.targetId)))
        .map((id) => targetById(id))
        .map((target) => (target ? { target, text: moonConflict(target, night?.moonPhasePct ?? 0) } : null))
        .filter((item): item is { target: NonNullable<ReturnType<typeof targetById>>; text: string } => Boolean(item && item.text)),
    [nightSessions, targets, night?.moonPhasePct],
  );

  if (!night) {
    return <Alert severity="info">暂无观测夜数据</Alert>;
  }

  const ticks = timelineTicks(120);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        本夜编排总览
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        按 30 分钟刻度展示时间轴与已排程段，月相与月出月落条带悬浮于时间轴上方；低于最小地平高度阈值的目标自动标灰。完成情况、有效帧数与短拍差额均取自执行登记，未登记的段明确标注，不以计划帧数顶替。
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <TextField select size="small" label="观测夜" value={night.id} onChange={(event) => setCurrentNight(event.target.value)} sx={{ minWidth: 260 }}>
          {nights.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {`${item.date} · ${item.siteName} · ${item.cloudText} · 月相 ${item.moonPhasePct}%`}
              {item.primary ? ' · 主夜' : item.backup ? ' · 备用夜' : ''}
            </MenuItem>
          ))}
        </TextField>
        <Chip label={`值班人 ${night.dutyOfficer}`} size="small" />
        <Chip label={`月相 ${night.moonPhasePct}%（${moonPhaseText(night.moonPhasePct)}）· 亮度折算 ${moonBrightnessFactor(night.moonPhasePct)}`} size="small" color="primary" variant="outlined" />
        <ConflictBadge conflicts={conflicts} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 2, mb: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              本夜排程段
            </Typography>
            <Typography variant="h5">{nightSessions.length}</Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              计划帧数
            </Typography>
            <Typography variant="h5">{executionStats.plannedTotal}</Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              有效帧数（完成登记）
            </Typography>
            <Typography variant="h5" color={executionStats.finishedCount ? 'success.main' : 'text.secondary'}>
              {executionStats.finishedCount ? executionStats.validTotal : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              已完成 {executionStats.finishedCount} 段
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              短拍差额（少拍帧数）
            </Typography>
            <Typography variant="h5" color={executionStats.shortfallTotal ? 'warning.main' : executionStats.finishedCount ? 'success.main' : 'text.secondary'}>
              {executionStats.finishedCount ? executionStats.shortfallTotal : '—'}
            </Typography>
            {executionStats.finishedCount ? (
              <Typography variant="caption" color="text.secondary">
                {executionStats.shortfallTotal ? `完成段计划 ${executionStats.finishedPlanned} 帧` : '完成段均足额'}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                尚无完成登记
              </Typography>
            )}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              进行中 / 未登记
            </Typography>
            <Typography variant="h5" color={executionStats.unregisteredCount ? 'warning.main' : 'text.primary'}>
              {executionStats.ongoingCount} / {executionStats.unregisteredCount}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              未登记段需观测后补录
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              设备冲突 / 低高度角
            </Typography>
            <Typography variant="h5" color={conflicts.length ? 'error.main' : 'success.main'}>
              {conflicts.length} / {dimmedTargets.length}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {executionStats.unregisteredSessions.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>{executionStats.unregisteredSessions.length} 个排程段尚未做执行登记</AlertTitle>
          {executionStats.unregisteredSessions.map((session) => {
            const target = targetById(session.targetId);
            return (
              <div key={session.id}>
                {session.startTime}-{session.endTime} {target?.name ?? '未知目标'}（计划 {session.plannedFrames} 帧）：观测结束后请到「排程段列表」登记实际开始/结束与有效帧数
              </div>
            );
          })}
        </Alert>
      ) : null}

      {executionStats.shortSessions.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>{executionStats.shortSessions.length} 个已完成段出现帧数不足或提前结束，短拍差额合计 {executionStats.shortfallTotal} 帧</AlertTitle>
          {executionStats.shortSessions.map((session) => {
            const target = targetById(session.targetId);
            const summary = summarizeExecution(session);
            const bits: string[] = [];
            if (summary.framesShort) bits.push(`有效 ${session.execution?.validFrames}/${session.plannedFrames} 帧（少 ${summary.frameShortfall}）`);
            if (summary.endedEarly) bits.push(`提前 ${formatMinutes(summary.plannedDuration - (summary.actualDuration ?? 0))} 结束`);
            return (
              <div key={session.id}>
                {session.startTime}-{session.endTime} {target?.name ?? '未知目标'}：{bits.join('，')}；原因：{session.execution?.shortReason ?? '（未填写）'}
              </div>
            );
          })}
        </Alert>
      ) : null}

      {conflicts.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          <AlertTitle>检测到 {conflicts.length} 处设备时段冲突</AlertTitle>
          {conflicts.map((conflict) => (
            <div key={`${conflict.sessionId}-${conflict.otherId}`}>
              排程段 {conflict.sessionId} 与 {conflict.otherId} 在同一望远镜（{telescopeById(conflict.telescopeId)?.code ?? conflict.telescopeId}）上{conflict.overlapText}
            </div>
          ))}
        </Alert>
      ) : null}

      {dimmedTargets.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>目标高度角低于阈值，已在时间轴上标灰</AlertTitle>
          {dimmedTargets.map((id) => {
            const target = targetById(id);
            const altitude = altitudes.get(id);
            return target ? (
              <div key={id}>
                {target.name}：评估高度角 {altitude?.altitude}°，阈值 {target.minAltitude}°
              </div>
            ) : null;
          })}
        </Alert>
      ) : null}

      {moonConflicts.length > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          <AlertTitle>月相与目标亮度冲突提示</AlertTitle>
          {moonConflicts.map((item) => (
            <div key={item.target.id}>{item.text}</div>
          ))}
        </Alert>
      ) : null}

      <Timeline
        bars={bars}
        ticks={ticks}
        totalMinutes={NIGHT_TOTAL_MINUTES}
        conflictIds={ids}
        height={120}
        strip={
          <Box sx={{ position: 'relative', height: 42, bgcolor: 'grey.900', borderRadius: 1, overflow: 'hidden' }}>
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${night.moonPhasePct}%`,
                background: 'linear-gradient(90deg, rgba(255,241,196,0.15), rgba(255,241,196,0.55))',
              }}
            />
            {[
              { time: night.sunset, label: '日落' },
              { time: night.moonrise, label: '月出' },
              { time: night.moonset, label: '月落' },
              { time: night.sunrise, label: '日出' },
            ].map((marker) => (
              <Box
                key={marker.label}
                sx={{
                  position: 'absolute',
                  left: Math.min(99, Math.max(0, (axisMinutes(marker.time) / NIGHT_TOTAL_MINUTES) * 100)) + '%',
                  top: 0,
                  bottom: 0,
                  borderLeft: '1px solid #ffd54f',
                }}
              >
                <Typography variant="caption" sx={{ color: '#ffd54f', pl: 0.5, whiteSpace: 'nowrap' }}>
                  {marker.label} {marker.time}
                </Typography>
              </Box>
            ))}
            <Typography variant="caption" sx={{ position: 'absolute', right: 8, bottom: 2, color: '#b0bec5' }}>
              云量预报：{night.cloudText} · 时间轴 {minutesToTime(0)} → {minutesToTime(NIGHT_TOTAL_MINUTES)}
            </Typography>
          </Box>
        }
      />

      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          本夜排程段（{nightSessions.length} 段）
        </Typography>
        <Stack spacing={1}>
          {[...nightSessions]
            .sort((a, b) => axisMinutes(a.startTime) - axisMinutes(b.startTime))
            .map((session) => {
              const target = targetById(session.targetId);
              const altitude = altitudes.get(session.targetId);
              const summary = summarizeExecution(session);
              return (
                <Card key={session.id} variant="outlined">
                  <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                      <Chip size="small" label={`计划 ${session.startTime}-${session.endTime}`} />
                      <Typography variant="subtitle2">{target ? `${target.name}（${target.catalog}）` : '未知目标'}</Typography>
                      <Chip size="small" variant="outlined" label={`${telescopeById(session.telescopeId)?.code ?? '-'} / ${instrumentById(session.instrumentId)?.model ?? '-'}`} />
                      <Chip size="small" variant="outlined" label={`滤镜 ${session.filterSlot}`} />
                      <Chip size="small" variant="outlined" label={`计划 ${session.plannedFrames} 帧 × ${target?.exposureSec ?? '-'}s`} />
                      <StatusChip status={session.status} />
                      {ids.has(session.id) ? <Chip size="small" color="error" label="时段冲突" /> : null}
                      {altitude?.below ? <Chip size="small" color="warning" label={`高度角 ${altitude.altitude}° 低于阈值 ${target?.minAltitude}°`} /> : <Chip size="small" color="success" variant="outlined" label={`高度角 ${altitude?.altitude ?? '-'}°`} />}
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mt: 1 }}>
                      {summary.finished && session.execution ? (
                        <>
                          <Chip size="small" color="success" label="已完成登记" />
                          <Chip size="small" variant="outlined" label={`实际 ${session.execution.actualStartTime}-${session.execution.actualEndTime}（${formatMinutes(summary.actualDuration ?? 0)}）`} />
                          <Chip
                            size="small"
                            color={summary.framesShort ? 'warning' : 'success'}
                            label={`有效 ${session.execution.validFrames} / 计划 ${session.plannedFrames} 帧`}
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            color={summary.frameShortfall > 0 ? 'warning' : 'success'}
                            label={
                              summary.frameShortfall > 0
                                ? `短拍差额 -${summary.frameShortfall} 帧`
                                : summary.frameShortfall < 0
                                  ? `超额 +${-summary.frameShortfall} 帧`
                                  : '帧数足额'
                            }
                          />
                          {summary.endedEarly ? <Chip size="small" color="warning" variant="outlined" label={`提前 ${formatMinutes(summary.plannedDuration - (summary.actualDuration ?? 0))} 结束`} /> : null}
                          {session.execution.shortReason ? (
                            <Typography variant="caption" color="warning.dark">
                              短拍原因：{session.execution.shortReason}
                            </Typography>
                          ) : null}
                        </>
                      ) : summary.ongoing ? (
                        <>
                          <Chip size="small" color="primary" label="进行中（已登记开始）" />
                          <Chip size="small" variant="outlined" label={`实际开始 ${session.execution?.actualStartTime}`} />
                          <Typography variant="caption" color="text.secondary">
                            实际结束与有效帧数待补录
                          </Typography>
                        </>
                      ) : (
                        <Chip
                          size="small"
                          color={session.status === '因云取消' ? 'default' : 'warning'}
                          variant="outlined"
                          label={session.status === '因云取消' ? '未登记（已改期取消）' : '执行未登记（计划帧数仅供参考）'}
                        />
                      )}
                      {session.rescheduleReason ? <Typography variant="caption" color="text.secondary">改期：{session.rescheduleReason}</Typography> : null}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
        </Stack>
      </Box>
    </Box>
  );
}
