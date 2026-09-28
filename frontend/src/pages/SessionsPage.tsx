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
import Tooltip from '@mui/material/Tooltip';
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
import { FILTER_NAMES, SESSION_STATUSES, type ObsSession, type SessionStatus } from '../types';
import { axisMinutes, durationMinutes, formatMinutes } from '../utils/astro';
import { summarizeExecution, validateExecution, type ExecutionInput } from '../utils/execution';

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

/** 执行登记表单：结束时间与有效帧数都留空时即「进行中，只登记开始时间」 */
type ExecutionFormState = ExecutionInput;

/** 执行登记单元格：未登记显式标注，绝不以计划帧数顶替 */
function ExecutionCell({ session }: { session: ObsSession }) {
  const summary = useMemo(() => summarizeExecution(session), [session]);
  const record = session.execution;

  if (summary.unregistered) {
    return (
      <Chip
        size="small"
        variant="outlined"
        label={session.status === '因云取消' ? '未登记（已改期）' : '未登记'}
        color={session.status === '因云取消' ? 'default' : 'warning'}
      />
    );
  }

  if (summary.ongoing) {
    return (
      <Stack spacing={0.25}>
        <Chip size="small" color="primary" label="进行中" />
        <Typography variant="caption" color="text.secondary">
          实际开始 {record?.actualStartTime}，结束/帧数待补
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={0.25}>
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
        <Chip
          size="small"
          color={summary.framesShort ? 'warning' : 'success'}
          label={summary.framesShort ? `短拍 ${record?.validFrames}/${session.plannedFrames}` : `${record?.validFrames}/${session.plannedFrames} 帧`}
        />
        {summary.frameShortfall < 0 ? <Chip size="small" variant="outlined" color="success" label={`超 ${-summary.frameShortfall}`} /> : null}
        {summary.missingShortReason ? <Chip size="small" color="error" label="缺短拍原因" /> : null}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {record?.actualStartTime}-{record?.actualEndTime}（实际 {formatMinutes(summary.actualDuration ?? 0)}
        {summary.endedEarly ? ` · 提前 ${formatMinutes(summary.plannedDuration - (summary.actualDuration ?? 0))}` : ''}）
      </Typography>
      {record?.shortReason ? (
        <Tooltip title={record.shortReason}>
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            原因：{record.shortReason}
          </Typography>
        </Tooltip>
      ) : null}
    </Stack>
  );
}

/** 排程段列表与冲突检测结果，支持批量改期到备用观测夜与执行登记 */
export default function SessionsPage() {
  usePersistentStore();
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const rescheduleToBackup = useSessionStore((s) => s.rescheduleToBackup);
  const registerExecution = useSessionStore((s) => s.registerExecution);
  const clearExecution = useSessionStore((s) => s.clearExecution);
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
  const [execDialogOpen, setExecDialogOpen] = useState(false);
  const [execSessionId, setExecSessionId] = useState('');
  const [execError, setExecError] = useState('');
  const [execForm, setExecForm] = useState<ExecutionFormState>({ actualStartTime: '', actualEndTime: '', validFrames: '', shortReason: '' });
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
  const execSession = sessions.find((session) => session.id === execSessionId);

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

  /** 登记弹窗内实时预览短拍 / 提前结束提示 */
  const execPreview = useMemo(() => {
    if (!execDialogOpen || !execSession) return null;
    return validateExecution(execSession, execForm);
  }, [execDialogOpen, execSession, execForm]);

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
      // 不传 execution：updateSession 会保留已登记的执行结果
      await updateSession(editingId, { ...form, rescheduleReason: form.rescheduleReason });
      setNotice('已更新排程段，已有执行登记结果保留不变');
    } else {
      await addSession({ ...form, rescheduleReason: form.rescheduleReason });
      setNotice('已新增排程段');
    }
    setDialogOpen(false);
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

  function openRegister(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setExecSessionId(id);
    setExecError('');
    const record = session.execution;
    setExecForm({
      // 开始时间默认取已登记值，否则取计划开始时间，仍可修改
      actualStartTime: record?.actualStartTime ?? session.startTime,
      // 结束/帧数仅在已有完成登记时回显；未登记时留空，避免把计划值当成实际结果直接保存
      actualEndTime: record?.actualEndTime ?? '',
      validFrames: typeof record?.validFrames === 'number' ? String(record.validFrames) : '',
      shortReason: record?.shortReason ?? '',
    });
    setExecDialogOpen(true);
  }

  async function submitExecution() {
    if (!execSession) return;
    const result = validateExecution(execSession, execForm);
    if (!result.ok || !result.record) {
      setExecError(result.error);
      return;
    }
    await registerExecution(execSession.id, result.record, result.finished);
    setExecDialogOpen(false);
    if (!result.finished) {
      setNotice('已登记实际开始时间，该段标记为进行中，结束时间与有效帧数可观测后补录');
    } else if (result.short) {
      setNotice('已登记执行结果：帧数不足或提前结束，短拍原因已记录');
    } else {
      setNotice('已登记执行结果');
    }
  }

  async function handleClearExecution(id: string) {
    await clearExecution(id);
    setNotice('已清除该段执行登记，状态回退为待执行');
  }

  const editingSession = sessions.find((session) => session.id === editingId);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        排程段列表与冲突检测
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        同一时段同一望远镜重复排入即进入冲突列表；支持勾选多个排程段批量改期到备用观测夜并填写改期原因。观测后请在「执行登记」补录实际开始/结束与有效帧数，进行中的段可先只登记开始时间。
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
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ minWidth: 1360 }}>
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
              <TableCell>计划时段</TableCell>
              <TableCell>目标</TableCell>
              <TableCell>望远镜 / 终端</TableCell>
              <TableCell>滤镜</TableCell>
              <TableCell align="right">计划帧数</TableCell>
              <TableCell>排程状态</TableCell>
              <TableCell sx={{ minWidth: 230 }}>执行登记（实际时段 / 有效帧数）</TableCell>
              <TableCell>冲突</TableCell>
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
              const cancelled = session.status === '因云取消';
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
                    <ExecutionCell session={session} />
                  </TableCell>
                  <TableCell>
                    <ConflictBadge conflicts={conflicts} compact />
                  </TableCell>
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
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap">
                      <Tooltip title={cancelled ? '已因云取消改期，无需执行登记' : session.execution ? '修改 / 补全执行登记' : '登记实际开始、结束与有效帧数'}>
                        <span>
                          <Button size="small" variant={session.execution ? 'text' : 'outlined'} disabled={cancelled} onClick={() => openRegister(session.id)}>
                            {session.execution ? '补录' : '登记'}
                          </Button>
                        </span>
                      </Tooltip>
                      <Button size="small" onClick={() => openEdit(session.id)}>
                        编辑
                      </Button>
                      {session.execution ? (
                        <Button size="small" color="warning" onClick={() => void handleClearExecution(session.id)}>
                          清除登记
                        </Button>
                      ) : null}
                      <Button size="small" color="error" onClick={() => void removeSession(session.id)}>
                        删除
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    当前筛选条件下暂无排程段
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
          {editingSession?.execution ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              该段已有执行登记（实际 {editingSession.execution.actualStartTime}
              {editingSession.execution.actualEndTime ? `-${editingSession.execution.actualEndTime}` : ' 起'}
              {typeof editingSession.execution.validFrames === 'number' ? `，有效 ${editingSession.execution.validFrames} 帧` : '，进行中'}）。编辑计划时段不会清除登记结果；若调整计划帧数或时段，保存后请重新核对短拍差额。
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
          <FieldRow label="状态" hint={editingSession?.execution ? '该段状态由执行登记决定：只登记开始为「进行中」，完成登记为「已完成」，此处不可改' : undefined}>
            <TextField
              select
              size="small"
              fullWidth
              disabled={Boolean(editingSession?.execution)}
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as SessionStatus })}
            >
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

      <Dialog open={execDialogOpen} onClose={() => setExecDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>执行登记{execSession ? ` · ${targetById(execSession.targetId)?.name ?? ''}（${execSession?.startTime}-${execSession?.endTime}，计划 ${execSession?.plannedFrames} 帧）` : ''}</DialogTitle>
        <DialogContent>
          {execError ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {execError}
            </Alert>
          ) : null}
          <Alert severity="info" sx={{ mb: 1.5 }}>
            进行中的段可只填实际开始时间（结束时间与有效帧数留空），保存后标记为「进行中」；填写结束时间与有效帧数即为完成登记。未登记的段在总览与导出中显示「未登记」，不会用计划帧数顶替。
          </Alert>
          {execPreview?.finished && execPreview.short ? (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              检测到帧数不足或提前结束，请在下方填写短拍 / 提前结束原因后才能保存。
            </Alert>
          ) : null}
          <FieldRow label="实际开始" required hint="HH:mm，可与计划开始不同">
            <TextField size="small" fullWidth value={execForm.actualStartTime} onChange={(event) => setExecForm({ ...execForm, actualStartTime: event.target.value })} placeholder="20:05" />
          </FieldRow>
          <FieldRow label="实际结束" hint="HH:mm；进行中留空">
            <TextField size="small" fullWidth value={execForm.actualEndTime} onChange={(event) => setExecForm({ ...execForm, actualEndTime: event.target.value })} placeholder="21:20" />
          </FieldRow>
          <FieldRow label="有效帧数" hint="实际入库有效帧；进行中留空，不要填计划帧数">
            <TextField size="small" type="number" fullWidth value={execForm.validFrames} onChange={(event) => setExecForm({ ...execForm, validFrames: event.target.value })} placeholder={String(execSession?.plannedFrames ?? 0)} />
          </FieldRow>
          <FieldRow
            label="短拍 / 提前结束原因"
            required={Boolean(execPreview?.finished && execPreview.short)}
            hint="有效帧数少于计划帧数，或实际时段短于计划时段（提前结束）时必填；例如：薄云过境导星丢失、设备故障、目标提前落下"
          >
            <TextField size="small" fullWidth multiline minRows={2} value={execForm.shortReason} onChange={(event) => setExecForm({ ...execForm, shortReason: event.target.value })} />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExecDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submitExecution()}>
            保存登记
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
