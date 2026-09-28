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
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR, endedEarly, frameShortfall, hasExecutionRecord, isExecutionComplete } from '../types';
import { altitudeAt, axisMinutes, isBelowThreshold, minutesToTime, moonBrightnessFactor, moonConflict, moonPhaseText, timelineTicks } from '../utils/astro';

/** 本夜编排总览：30 分钟刻度时间轴 + 月相与月出月落条带 + 冲突与标灰提示 */
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
        const endMinute = Math.max(startMinute + 20, Math.min(NIGHT_TOTAL_MINUTES, rawEnd <= startMinute ? rawEnd + 1440 : rawEnd));
        const registered = hasExecutionRecord(session);
        const complete = isExecutionComplete(session);
        const shortfall = complete ? frameShortfall(session) : 0;
        const executionText = registered
          ? complete
            ? `｜实际 ${session.actualStartTime}-${session.actualEndTime}｜有效 ${session.actualFrames}/${session.plannedFrames} 帧${shortfall > 0 ? `（短拍 -${shortfall}）` : ''}`
            : `｜实际开始 ${session.actualStartTime}（进行中，结束与帧数未登记）`
          : '｜执行未登记';
        return {
          id: session.id,
          startMinute,
          endMinute,
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

  const totalFrames = nightSessions.reduce((sum, session) => sum + session.plannedFrames, 0);
  const registeredSessions = useMemo(() => nightSessions.filter(hasExecutionRecord), [nightSessions]);
  const completedExecutions = useMemo(() => nightSessions.filter(isExecutionComplete), [nightSessions]);
  const actualFramesTotal = completedExecutions.reduce((sum, session) => sum + (session.actualFrames ?? 0), 0);
  const shortfallTotal = completedExecutions.reduce((sum, session) => sum + frameShortfall(session), 0);
  const unregisteredCount = nightSessions.length - registeredSessions.length;
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
        按 30 分钟刻度展示时间轴与已排程段，月相与月出月落条带悬浮于时间轴上方；低于最小地平高度阈值的目标自动标灰。
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

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              本夜排程段（已登记 / 总数）
            </Typography>
            <Typography variant="h5">
              {registeredSessions.length} / {nightSessions.length}
            </Typography>
            {unregisteredCount > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {unregisteredCount} 段未登记
              </Typography>
            ) : (
              <Typography variant="caption" color="success.main">
                全部已登记
              </Typography>
            )}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              计划帧数
            </Typography>
            <Typography variant="h5">{totalFrames}</Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              实际有效帧数（{completedExecutions.length} 段已完结）
            </Typography>
            <Typography variant="h5" color={shortfallTotal > 0 ? 'warning.main' : 'success.main'}>
              {completedExecutions.length > 0 ? actualFramesTotal : '—'}
            </Typography>
            {completedExecutions.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                暂无完结登记
              </Typography>
            ) : shortfallTotal > 0 ? (
              <Typography variant="caption" color="error.main">
                短拍差额 -{shortfallTotal} 帧
              </Typography>
            ) : (
              <Typography variant="caption" color="success.main">
                已完结段均足额
              </Typography>
            )}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              短拍差额合计
            </Typography>
            <Typography variant="h5" color={shortfallTotal ? 'error.main' : 'success.main'}>
              {completedExecutions.length > 0 ? shortfallTotal : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              计划 − 有效，未登记不计入
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              设备冲突
            </Typography>
            <Typography variant="h5" color={conflicts.length ? 'error.main' : 'success.main'}>
              {conflicts.length}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              低于高度阈值（标灰）
            </Typography>
            <Typography variant="h5" color={dimmedTargets.length ? 'warning.main' : 'success.main'}>
              {dimmedTargets.length}
            </Typography>
          </CardContent>
        </Card>
      </Box>

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
              const registered = hasExecutionRecord(session);
              const complete = isExecutionComplete(session);
              const shortfall = complete ? frameShortfall(session) : 0;
              const early = complete ? endedEarly(session) : false;
              return (
                <Card key={session.id} variant="outlined">
                  <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`${session.startTime}-${session.endTime}`} />
                      <Typography variant="subtitle2">{target ? `${target.name}（${target.catalog}）` : '未知目标'}</Typography>
                      <Chip size="small" variant="outlined" label={`${telescopeById(session.telescopeId)?.code ?? '-'} / ${instrumentById(session.instrumentId)?.model ?? '-'}`} />
                      <Chip size="small" variant="outlined" label={`滤镜 ${session.filterSlot}`} />
                      <Chip size="small" variant="outlined" label={`计划 ${session.plannedFrames} 帧 × ${target?.exposureSec ?? '-'}s`} />
                      <StatusChip status={session.status} />
                      {ids.has(session.id) ? <Chip size="small" color="error" label="时段冲突" /> : null}
                      {altitude?.below ? <Chip size="small" color="warning" label={`高度角 ${altitude.altitude}° 低于阈值 ${target?.minAltitude}°`} /> : <Chip size="small" color="success" variant="outlined" label={`高度角 ${altitude?.altitude ?? '-'}°`} />}
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                      {!registered ? (
                        <Chip size="small" variant="outlined" color="default" label="执行未登记（不计入实际帧数）" />
                      ) : complete ? (
                        <>
                          <Chip size="small" color="primary" variant="outlined" label={`实际 ${session.actualStartTime}-${session.actualEndTime}`} />
                          <Chip size="small" color={shortfall > 0 ? 'error' : 'success'} variant="outlined" label={shortfall > 0 ? `有效 ${session.actualFrames} 帧 · 短拍 -${shortfall}` : `有效 ${session.actualFrames} 帧 · 足额`} />
                          {early ? <Chip size="small" color="warning" label="提前结束" /> : null}
                          {session.shortReason ? (
                            <Typography variant="caption" color="text.secondary">
                              原因：{session.shortReason}
                            </Typography>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <Chip size="small" color="primary" label={`实际开始 ${session.actualStartTime} · 进行中`} />
                          <Typography variant="caption" color="text.secondary">
                            结束时间与有效帧数待补录
                          </Typography>
                        </>
                      )}
                      {session.rescheduleReason ? (
                        <Typography variant="caption" color="text.secondary">
                          改期：{session.rescheduleReason}
                        </Typography>
                      ) : null}
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
