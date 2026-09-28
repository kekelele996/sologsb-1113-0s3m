import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import StatusChip from '../components/common/StatusChip';
import ConflictBadge from '../components/common/ConflictBadge';
import FieldRow from '../components/common/FieldRow';
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import {
  endedEarly,
  frameShortfall,
  hasExecutionRecord,
  isExecutionComplete,
  missingShortReason,
  FILTER_NAMES,
  SESSION_STATUSES,
  type ObsSession,
  type SessionStatus,
} from '../types';
import { axisMinutes, durationMinutes, formatMinutes } from '../utils/astro';

interface SessionFormState {
  nightId: string;
  targetId: string;
  startTime: string;
  endTime: string;
  telescopeId: string;
  instrumentId: string;
  filterSlot: string;
  plannedFrames: number;
  status: SessionStatus;
  rescheduleReason: string;
}

interface ExecutionFormState {
  actualStartTime: string;
  actualEndTime: string;
  actualFrames: string;
  shortReason: string;
  markCompleted: boolean;
}

const HHMM_PATTERN = /^\d{2}:\d{2}$/;

function nowHHmm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** 排程段列表与冲突检测结果，支持批量改期到备用观测夜与执行登记 */
export default function SessionsPage() {
  usePersistentStore();
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const rescheduleToBackup = useSessionStore((s) => s.rescheduleToBackup);
  const saveExecutionRecord = useSessionStore((s) => s.saveExecutionRecord);
  const clearExecutionRecord = useSessionStore((s) => s.clearExecutionRecord);
  const nights = useNightStore((s) => s.nights);
  const targets = useTargetStore((s) => s.targets);
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const { findConflicts, conflictIds } = useConflictCheck();

  /** 支持从设备分配视图一键跳转：?night=<夜ID>&highlight=<排程段ID> */
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight') ?? '';
  const nightParam = searchParams.get('night') ?? '';
  const [nightFilter, setNightFilter] = useState(nightParam || '全部');
  const [statusFilter, setStatusFilter] = useState('全部');
  const [onlyConflict, setOnlyConflict] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleNight, setRescheduleNight] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [executionOpen, setExecutionOpen] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [executionSessionId, setExecutionSessionId] = useState('');
  const [executionForm, setExecutionForm] = useState<ExecutionFormState>({
    actualStartTime: '',
    actualEndTime: '',
    actualFrames: '',
    shortReason: '',
    markCompleted: false,
  });
  const [form, setForm] = useState<SessionFormState>({
    nightId: '',
    targetId: '',
    startTime: '20:00',
    endTime: '21:00',
    telescopeId: '',
    instrumentId: '',
    filterSlot: 'L',
    plannedFrames: 30,
    status: '待执行',
    rescheduleReason: '',
  });

  const conflictSet = useMemo(() => conflictIds(), [conflictIds]);
  const backupNights = useMemo(() => nights.filter((night) => night.backup), [nights]);

  const visible = useMemo(() => {
    return [...sessions]
      .filter((session) => {
        if (nightFilter !== '全部' && session.nightId !== nightFilter) return false;
        if (statusFilter !== '全部' && session.status !== statusFilter) return false;
        if (onlyConflict && !conflictSet.has(session.id)) return false;
        return true;
      })
      .sort((a, b) => a.nightId.localeCompare(b.nightId) || axisMinutes(a.startTime) - axisMinutes(b.startTime));
  }, [sessions, nightFilter, statusFilter, onlyConflict, conflictSet]);

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((item) => item.id === id);
  const instrumentById = (id: string) => instruments.find((item) => item.id === id);
  const nightById = (id: string) => nights.find((night) => night.id === id);

  const liveConflicts = useMemo(() => {
    if (!dialogOpen) return [];
    return findConflicts({
      nightId: form.nightId,
      telescopeId: form.telescopeId,
      startTime: form.startTime,
      endTime: form.endTime,
      ignoreSessionId: editingId || undefined,
    });
  }, [dialogOpen, findConflicts, form.nightId, form.telescopeId, form.startTime, form.endTime, editingId]);

  const executionSession = sessions.find((session) => session.id === executionSessionId);
  const editingSession = sessions.find((session) => session.id === editingId);

  /** 依据当前登记表单预判短拍 / 提前结束，驱动必填原因提示 */
  const executionPreview = useMemo(() => {
    if (!executionSession) return { complete: false, framesShort: 0, early: false, needsReason: false };
    const start = executionForm.actualStartTime.trim();
    const end = executionForm.actualEndTime.trim();
    const framesValue = executionForm.actualFrames === '' ? undefined : Number(executionForm.actualFrames);
    const complete = Boolean(start && end && framesValue !== undefined && !Number.isNaN(framesValue));
    const probe: ObsSession = {
      ...executionSession,
      actualStartTime: start || undefined,
      actualEndTime: end || undefined,
      actualFrames: framesValue,
      shortReason: executionForm.shortReason,
    };
    const framesShort = complete ? frameShortfall(probe) : 0;
    const early = start && end ? endedEarly(probe) : false;
    return { complete, framesShort, early, needsReason: complete && (framesShort > 0 || early) };
  }, [executionSession, executionForm]);

  function openCreate() {
    setEditingId('');
    setError('');
    const night = nights.find((item) => item.primary) ?? nights[0];
    const telescope = telescopes.find((item) => item.status === '可用') ?? telescopes[0];
    const instrument = instruments.find((item) => item.telescopeCode === telescope?.code);
    setForm({
      nightId: night?.id ?? '',
      targetId: targets[0]?.id ?? '',
      startTime: '20:00',
      endTime: '21:00',
      telescopeId: telescope?.id ?? '',
      instrumentId: instrument?.id ?? '',
      filterSlot: 'L',
      plannedFrames: 30,
      status: '待执行',
      rescheduleReason: '',
    });
    setDialogOpen(true);
  }

  function openEdit(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setEditingId(id);
    setError('');
    setForm({
      nightId: session.nightId,
      targetId: session.targetId,
      startTime: session.startTime,
      endTime: session.endTime,
      telescopeId: session.telescopeId,
      instrumentId: session.instrumentId,
      filterSlot: session.filterSlot,
      plannedFrames: session.plannedFrames,
      status: session.status,
      rescheduleReason: session.rescheduleReason ?? '',
    });
    setDialogOpen(true);
  }

  async function submit() {
    if (!form.nightId || !form.targetId || !form.telescopeId) {
      setError('观测夜、目标与望远镜均为必填');
      return;
    }
    if (durationMinutes(form.startTime, form.endTime) <= 0) {
      setError('结束时刻必须晚于开始时刻');
      return;
    }
    if (liveConflicts.length > 0) {
      setError('该望远镜在所选时段已有排程，请调整时段或改期到备用观测夜');
      return;
    }
    if (editingId) {
      // 仅提交计划字段：updateSession 以 patch 合并，已登记的执行结果原样保留
      await updateSession(editingId, { ...form, rescheduleReason: form.rescheduleReason });
      setNotice('已更新排程段（执行登记结果保留不变）');
    } else {
      await addSession({ ...form, rescheduleReason: form.rescheduleReason });
      setNotice('已新增排程段');
    }
    setDialogOpen(false);
  }

  function openExecution(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setExecutionSessionId(id);
    setExecutionError('');
    setExecutionForm({
      actualStartTime: session.actualStartTime ?? '',
      actualEndTime: session.actualEndTime ?? '',
      actualFrames: session.actualFrames === undefined ? '' : String(session.actualFrames),
      shortReason: session.shortReason ?? '',
      markCompleted: false,
    });
    setExecutionOpen(true);
  }

  async function submitExecution() {
    if (!executionSession) return;
    const start = executionForm.actualStartTime.trim();
    const end = executionForm.actualEndTime.trim();
    const framesRaw = executionForm.actualFrames.trim();

    if (!start) {
      setExecutionError('请至少填写实际开始时间（进行中的段可只留开始时间）');
      return;
    }
    if (!HHMM_PATTERN.test(start) || (end && !HHMM_PATTERN.test(end))) {
      setExecutionError('时刻格式应为 HH:mm，例如 21:05');
      return;
    }
    if (end && durationMinutes(start, end) <= 0) {
      setExecutionError('实际结束时刻必须晚于实际开始时刻');
      return;
    }
    if (framesRaw && (!/^\d+$/.test(framesRaw) || Number(framesRaw) < 0)) {
      setExecutionError('有效帧数应为不小于 0 的整数');
      return;
    }

    // 结束时刻与有效帧数需同时补录，避免出现「有帧数无结束」的半截登记
    const completionFields = [end, framesRaw].filter(Boolean).length;
    if (completionFields === 1) {
      setExecutionError('观测结束时请同时填写实际结束时间与有效帧数；进行中则两项都先留空');
      return;
    }

    const complete = completionFields === 2;
    const frames = complete ? Number(framesRaw) : undefined;
    const probe: ObsSession = {
      ...executionSession,
      actualStartTime: start,
      actualEndTime: end || undefined,
      actualFrames: frames,
      shortReason: executionForm.shortReason,
    };
    if (complete && (frameShortfall(probe) > 0 || endedEarly(probe)) && !executionForm.shortReason.trim()) {
      setExecutionError('有效帧数不足计划帧数或实际提前结束，请填写短拍 / 提前结束原因');
      return;
    }

    await saveExecutionRecord(executionSession.id, {
      actualStartTime: start,
      actualEndTime: end || undefined,
      actualFrames: frames,
      shortReason: executionForm.shortReason,
    });
    if (executionForm.markCompleted && executionSession.status !== '已完成') {
      await updateSession(executionSession.id, { status: '已完成' });
    }
    setNotice(complete ? `已登记执行结果（${executionSession.id}）` : `已登记实际开始时间（${executionSession.id}）`);
    setExecutionOpen(false);
  }

  async function clearExecution() {
    if (!executionSession) return;
    await clearExecutionRecord(executionSession.id);
    setNotice(`已清除执行登记（${executionSession.id}）`);
    setExecutionOpen(false);
  }

  async function submitReschedule() {
    if (!rescheduleNight) {
      setError('请选择备用观测夜');
      return;
    }
    const count = await rescheduleToBackup(selected, rescheduleNight, rescheduleReason);
    setNotice(`已将 ${count} 个排程段改期至 ${nightById(rescheduleNight)?.date ?? rescheduleNight}，原因：${rescheduleReason || '未填写'}`);
    setSelected([]);
    setRescheduleOpen(false);
    setRescheduleReason('');
  }

  function renderExecutionCell(session: ObsSession) {
    if (!hasExecutionRecord(session)) {
      return (
        <Stack spacing={0.5} alignItems="flex-start">
          <Chip size="small" variant="outlined" color="default" label="未登记" />
          <Button size="small" onClick={() => openExecution(session.id)}>
            执行登记
          </Button>
        </Stack>
      );
    }
    const complete = isExecutionComplete(session);
    const shortfall = frameShortfall(session);
    const early = endedEarly(session);
    return (
      <Stack spacing={0.5} alignItems="flex-start">
        <Typography variant="caption">
          {session.actualStartTime}
          {complete ? `-${session.actualEndTime}` : ' 起（进行中）'}
        </Typography>
        {complete ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={`有效 ${session.actualFrames} / ${session.plannedFrames}`} />
            {shortfall > 0 ? <Chip size="small" color="error" label={`短拍 -${shortfall}`} /> : <Chip size="small" color="success" variant="outlined" label="足额" />}
            {early ? <Chip size="small" color="warning" label="提前结束" /> : null}
          </Stack>
        ) : (
          <Typography variant="caption" color="primary.main">
            已留开始时间，待补录
          </Typography>
        )}
        {complete && missingShortReason(session) ? (
          <Typography variant="caption" color="error">
            缺短拍 / 提前结束原因
          </Typography>
        ) : session.shortReason ? (
          <Typography variant="caption" color="text.secondary">
            原因：{session.shortReason}
          </Typography>
        ) : null}
        <Button size="small" onClick={() => openExecution(session.id)}>
          {complete ? '修改登记' : '补录 / 修改'}
        </Button>
      </Stack>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        排程段列表与冲突检测
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        同一时段同一望远镜重复排入即进入冲突列表；支持勾选多个排程段批量改期到备用观测夜并填写改期原因。观测结束后请在「执行登记」补录实际起止、有效帧数与短拍原因；未登记的排程段不会用计划帧数顶替。
      </Typography>

      {notice ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
          {notice}
        </Alert>
      ) : null}

      {highlightId ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          已从设备分配视图定位到排程段 <strong>{highlightId}</strong>（对应行已用左侧红条标出）
        </Alert>
      ) : null}

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <Button variant="contained" onClick={openCreate}>
          新增排程段
        </Button>
        <Button variant="outlined" color="warning" disabled={selected.length === 0} onClick={() => setRescheduleOpen(true)}>
          批量改期到备用夜（已选 {selected.length}）
        </Button>
        <TextField select size="small" label="观测夜" value={nightFilter} onChange={(event) => setNightFilter(event.target.value)} sx={{ minWidth: 200 }}>
          {['全部', ...nights.map((night) => night.id)].map((id) => (
            <MenuItem key={id} value={id}>
              {id === '全部' ? '全部' : `${nightById(id)?.date ?? id}${nightById(id)?.primary ? '（主夜）' : '（备用夜）'}`}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 140 }}>
          {['全部', ...SESSION_STATUSES].map((status) => (
            <MenuItem key={status} value={status}>
              {status}
            </MenuItem>
          ))}
        </TextField>
        <Button variant={onlyConflict ? 'contained' : 'outlined'} color="error" onClick={() => setOnlyConflict((value) => !value)}>
          仅看冲突（{conflictSet.size} 段）
        </Button>
        <Chip size="small" label={`命中 ${visible.length} / ${sessions.length}`} />
        <Chip size="small" variant="outlined" label={`已登记 ${sessions.filter(hasExecutionRecord).length} / ${sessions.length} 段`} />
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={visible.length > 0 && selected.length === visible.length}
                  onChange={(event) => setSelected(event.target.checked ? visible.map((session) => session.id) : [])}
                />
              </TableCell>
              <TableCell>观测夜</TableCell>
              <TableCell>时段</TableCell>
              <TableCell>目标</TableCell>
              <TableCell>望远镜 / 终端</TableCell>
              <TableCell>滤镜</TableCell>
              <TableCell align="right">计划帧数</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>冲突</TableCell>
              <TableCell style={{ minWidth: 230 }}>执行登记</TableCell>
              <TableCell>改期原因</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((session) => {
              const conflicts = findConflicts({
                nightId: session.nightId,
                telescopeId: session.telescopeId,
                startTime: session.startTime,
                endTime: session.endTime,
                ignoreSessionId: session.id,
              });
              return (
                <TableRow
                  key={session.id}
                  hover
                  selected={selected.includes(session.id)}
                  sx={session.id === highlightId ? { boxShadow: 'inset 4px 0 0 #d32f2f' } : undefined}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.includes(session.id)}
                      onChange={(event) =>
                        setSelected((prev) => (event.target.checked ? [...prev, session.id] : prev.filter((id) => id !== session.id)))
                      }
                    />
                  </TableCell>
                  <TableCell>{nightById(session.nightId)?.date ?? session.nightId}</TableCell>
                  <TableCell>
                    {session.startTime}-{session.endTime}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {formatMinutes(durationMinutes(session.startTime, session.endTime))}
                    </Typography>
                  </TableCell>
                  <TableCell>{targetById(session.targetId)?.name ?? '未知目标'}</TableCell>
                  <TableCell>
                    {telescopeById(session.telescopeId)?.code ?? '-'} / {instrumentById(session.instrumentId)?.model ?? '-'}
                  </TableCell>
                  <TableCell>{session.filterSlot}</TableCell>
                  <TableCell align="right">{session.plannedFrames}</TableCell>
                  <TableCell>
                    <StatusChip status={session.status} />
                  </TableCell>
                  <TableCell>
                    <ConflictBadge conflicts={conflicts} compact />
                  </TableCell>
                  <TableCell>{renderExecutionCell(session)}</TableCell>
                  <TableCell>
                    {session.rescheduleReason ? (
                      <Typography variant="caption">{session.rescheduleReason}</Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        -
                      </Typography>
                    )}
                    {session.backupNightId ? (
                      <Chip size="small" variant="outlined" label={`替补 ${nightById(session.backupNightId)?.date ?? session.backupNightId}`} sx={{ ml: 0.5 }} />
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openEdit(session.id)}>
                      编辑
                    </Button>
                    <Button size="small" color="error" onClick={() => void removeSession(session.id)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    当前筛选条件下没有排程段
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? '编辑排程段' : '新增排程段'}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {error}
            </Alert>
          ) : null}
          {editingId && editingSession?.actualStartTime ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              本段已有执行登记，修改计划时段 / 计划帧数不会覆盖实际起止与有效帧数；如需更正结果请使用列表中的「修改登记」。
            </Alert>
          ) : null}
          {liveConflicts.length > 0 ? (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              该望远镜在所选时段已有 {liveConflicts.length} 段排程：
              {liveConflicts.map((conflict) => ` ${conflict.otherId}（${conflict.overlapText}）`).join('；')}
            </Alert>
          ) : (
            <Alert severity="success" sx={{ mb: 1.5 }}>
              时段校验通过，该望远镜此时段空闲
            </Alert>
          )}
          <FieldRow label="观测夜" required>
            <TextField select size="small" fullWidth value={form.nightId} onChange={(event) => setForm({ ...form, nightId: event.target.value })}>
              {nights.map((night) => (
                <MenuItem key={night.id} value={night.id}>
                  {`${night.date} · ${night.siteName}${night.primary ? '（主夜）' : night.backup ? '（备用夜）' : ''}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="观测目标" required>
            <TextField select size="small" fullWidth value={form.targetId} onChange={(event) => setForm({ ...form, targetId: event.target.value })}>
              {targets.map((target) => (
                <MenuItem key={target.id} value={target.id}>
                  {`${target.name}（${target.catalog}）· ${target.magnitude} 等`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="开始时刻" required hint="格式 HH:mm，可跨零点">
            <TextField size="small" fullWidth value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} placeholder="20:00" />
          </FieldRow>
          <FieldRow label="结束时刻" required>
            <TextField size="small" fullWidth value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} placeholder="21:30" />
          </FieldRow>
          <FieldRow label="望远镜" required>
            <TextField
              select
              size="small"
              fullWidth
              value={form.telescopeId}
              onChange={(event) => {
                const telescope = telescopes.find((item) => item.id === event.target.value);
                const instrument = instruments.find((item) => item.telescopeCode === telescope?.code);
                setForm({ ...form, telescopeId: event.target.value, instrumentId: instrument?.id ?? '' });
              }}
            >
              {telescopes.map((telescope) => (
                <MenuItem key={telescope.id} value={telescope.id}>
                  {`${telescope.code} · ${telescope.apertureMm}mm f/${(telescope.focalLengthMm / telescope.apertureMm).toFixed(1)} · ${telescope.status}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="终端">
            <TextField select size="small" fullWidth value={form.instrumentId} onChange={(event) => setForm({ ...form, instrumentId: event.target.value })}>
              {instruments
                .filter((instrument) => instrument.telescopeCode === telescopeById(form.telescopeId)?.code)
                .map((instrument) => (
                  <MenuItem key={instrument.id} value={instrument.id}>
                    {`${instrument.model} · ${instrument.terminalType}`}
                  </MenuItem>
                ))}
            </TextField>
          </FieldRow>
          <FieldRow label="滤镜轮位">
            <TextField select size="small" fullWidth value={form.filterSlot} onChange={(event) => setForm({ ...form, filterSlot: event.target.value })}>
              {FILTER_NAMES.map((filter) => (
                <MenuItem key={filter} value={filter}>
                  {filter}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="计划帧数" required>
            <TextField size="small" type="number" fullWidth value={form.plannedFrames} onChange={(event) => setForm({ ...form, plannedFrames: Number(event.target.value) })} />
          </FieldRow>
          <FieldRow label="状态">
            <TextField select size="small" fullWidth value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as SessionStatus })}>
              {SESSION_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="改期原因">
            <TextField size="small" fullWidth multiline minRows={2} value={form.rescheduleReason} onChange={(event) => setForm({ ...form, rescheduleReason: event.target.value })} />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submit()}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={executionOpen} onClose={() => setExecutionOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>执行登记{executionSession ? ` · ${executionSession.id}` : ''}</DialogTitle>
        <DialogContent>
          {executionSession ? (
            <>
              {executionError ? (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  {executionError}
                </Alert>
              ) : null}
              <Alert severity="info" sx={{ mb: 1.5 }}>
                计划时段 {executionSession.startTime}-{executionSession.endTime}（{formatMinutes(durationMinutes(executionSession.startTime, executionSession.endTime))}），计划 {executionSession.plannedFrames} 帧；目标{' '}
                {targetById(executionSession.targetId)?.name ?? '未知目标'}，{telescopeById(executionSession.telescopeId)?.code ?? '-'} /{' '}
                {instrumentById(executionSession.instrumentId)?.model ?? '-'}。
              </Alert>
              {executionPreview.needsReason ? (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  本次登记{executionPreview.framesShort > 0 ? `短拍 ${executionPreview.framesShort} 帧` : ''}
                  {executionPreview.framesShort > 0 && executionPreview.early ? '，且' : ''}
                  {executionPreview.early ? '实际结束早于计划' : ''}，必须在下方写明原因。
                </Alert>
              ) : null}
              <FieldRow label="实际开始" required hint="HH:mm；进行中的段可只填这一项">
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    fullWidth
                    value={executionForm.actualStartTime}
                    onChange={(event) => setExecutionForm({ ...executionForm, actualStartTime: event.target.value })}
                    placeholder="20:05"
                  />
                  <Button size="small" onClick={() => setExecutionForm((prev) => ({ ...prev, actualStartTime: nowHHmm() }))}>
                    现在
                  </Button>
                </Stack>
              </FieldRow>
              <FieldRow label="实际结束" hint="观测结束后补录，留空表示仍在进行">
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    fullWidth
                    value={executionForm.actualEndTime}
                    onChange={(event) => setExecutionForm({ ...executionForm, actualEndTime: event.target.value })}
                    placeholder="21:30"
                  />
                  <Button size="small" onClick={() => setExecutionForm((prev) => ({ ...prev, actualEndTime: nowHHmm() }))}>
                    现在
                  </Button>
                </Stack>
              </FieldRow>
              <FieldRow label="有效帧数" hint="实际入库的有效帧数；不以计划帧数顶替">
                <TextField
                  size="small"
                  type="number"
                  fullWidth
                  value={executionForm.actualFrames}
                  onChange={(event) => setExecutionForm({ ...executionForm, actualFrames: event.target.value })}
                  placeholder="例如 38"
                />
              </FieldRow>
              <FieldRow
                label="短拍 / 提前结束原因"
                required={executionPreview.needsReason}
                hint={executionPreview.needsReason ? undefined : '帧数不足或提前结束时必填，例如：云团过境遮挡、导星失稳废片、设备过热提前收工'}
              >
                <TextField
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  value={executionForm.shortReason}
                  error={executionPreview.needsReason && !executionForm.shortReason.trim()}
                  onChange={(event) => setExecutionForm({ ...executionForm, shortReason: event.target.value })}
                />
              </FieldRow>
              {executionSession.status !== '已完成' ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={executionForm.markCompleted}
                      onChange={(event) => setExecutionForm({ ...executionForm, markCompleted: event.target.checked })}
                    />
                  }
                  label="保存同时将状态置为「已完成」"
                />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  该排程段当前状态为「已完成」。
                </Typography>
              )}
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          {executionSession?.actualStartTime ? (
            <Button color="error" onClick={() => void clearExecution()}>
              清除登记
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setExecutionOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submitExecution()}>
            保存登记
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>批量改期到备用观测夜</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            已选 {selected.length} 个排程段，改期后状态将置为「因云取消」并记录替补夜与改期原因。
          </Alert>
          <FieldRow label="备用观测夜" required>
            <TextField select size="small" fullWidth value={rescheduleNight} onChange={(event) => setRescheduleNight(event.target.value)}>
              {backupNights.map((night) => (
                <MenuItem key={night.id} value={night.id}>
                  {`${night.date} · ${night.cloudText} · 月相 ${night.moonPhasePct}% · ${night.dutyOfficer}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="改期原因" required hint="例如：夜间云量转多云，目标被云遮挡">
            <TextField size="small" fullWidth multiline minRows={2} value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRescheduleOpen(false)}>取消</Button>
          <Button variant="contained" color="warning" onClick={() => void submitReschedule()}>
            确认改期
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
