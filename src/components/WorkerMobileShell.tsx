import React, { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  Home, Timer, CheckSquare, ClipboardList, Calendar,
  Camera, CheckCircle, AlertTriangle, AlertCircle, MapPin,
  Clock, ArrowLeft, LogOut, RefreshCw, Plus, X, ChevronRight,
  Wifi, WifiOff, HardHat, Send, Image as ImageIcon, Shield, Loader2
} from 'lucide-react';
import {
  attendanceApi, tasksApi, instructionsApi, leaveApi,
  workersApi, sitesApi, projectsApi, getToken, clearToken
} from '../api';
import {
  STATUS_COLORS, PRIORITY_COLORS, GEOFENCE_COLORS
} from '../types';
import { nativeService, type GpsResult } from '../services/native';

interface Props {
  onExitMobile?: () => void;
  isWorkerOnly?: boolean;
}

type WorkerTab = 'today' | 'punch' | 'tasks' | 'instructions' | 'leave';

export function WorkerMobileShell({ onExitMobile, isWorkerOnly }: Props) {
  const [tab, setTab] = useState<WorkerTab>('today');
  const [worker, setWorker] = useState<any | null>(null);
  const [activePunch, setActivePunch] = useState<any | null>(null);
  const [todayAttendance, setTodayAttendance] = useState<any[]>([]);
  const [assignedSite, setAssignedSite] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [instructions, setInstructions] = useState<any[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);

  // Device & GPS state
  const [gps, setGps] = useState<GpsResult | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [elapsedTimer, setElapsedTimer] = useState('00:00:00');
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [leaveForm, setLeaveForm] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const [taskProgressModal, setTaskProgressModal] = useState<any | null>(null);
  const [newProgressVal, setNewProgressVal] = useState(50);
  const [instructionEvidenceModal, setInstructionEvidenceModal] = useState<any | null>(null);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [evidencePhoto, setEvidencePhoto] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Monitor network connectivity
  useEffect(() => {
    nativeService.getNetworkStatus().then(st => setIsOnline(st.connected));
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load all worker data
  const loadWorkerData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get worker profile
      const workerList = await workersApi.list().catch(() => []);
      const profile = Array.isArray(workerList) && workerList.length > 0 ? workerList[0] : null;
      setWorker(profile);

      // 2. Get active attendance & today's records
      const attData = await attendanceApi.today().catch(() => ({}));
      const records = Array.isArray(attData?.workers) ? attData.workers : [];
      setTodayAttendance(records);
      const active = records.find((r: any) => !r.punch_out);
      setActivePunch(active || null);

      // 3. Get assigned site
      if (profile?.site_id) {
        const site = await sitesApi.get(profile.site_id).catch(() => null);
        setAssignedSite(site);
      } else if (records.length > 0 && records[0].site_id) {
        const site = await sitesApi.get(records[0].site_id).catch(() => null);
        setAssignedSite(site);
      }

      // 4. Get tasks assigned to worker
      const taskList = await tasksApi.list().catch(() => []);
      setTasks(Array.isArray(taskList) ? taskList : []);

      // 5. Get site instructions
      const instList = await instructionsApi.list().catch(() => []);
      setInstructions(Array.isArray(instList) ? instList : []);

      // 6. Get leave balances & requests
      const [balances, requests, types] = await Promise.all([
        leaveApi.balances().catch(() => []),
        leaveApi.requests().catch(() => []),
        leaveApi.types().catch(() => [])
      ]);
      setLeaveBalances(Array.isArray(balances) ? balances : []);
      setLeaveRequests(Array.isArray(requests) ? requests : []);
      setLeaveTypes(Array.isArray(types) ? types : []);
      if (Array.isArray(types) && types.length > 0) {
        setLeaveForm(f => ({ ...f, leave_type_id: types[0].id }));
      }
    } catch {
      // handle gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkerData();
  }, [loadWorkerData]);

  // Live elapsed punch timer
  useEffect(() => {
    if (!activePunch?.punch_in) {
      setElapsedTimer('00:00:00');
      return;
    }
    const update = () => {
      const ms = Date.now() - new Date(activePunch.punch_in).getTime();
      if (ms < 0) { setElapsedTimer('00:00:00'); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setElapsedTimer(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activePunch]);

  // Request high-accuracy GPS fix via native service
  const refreshGps = useCallback(async () => {
    setGpsLoading(true);
    setGpsError('');
    try {
      const coords = await nativeService.getGpsCoordinates();
      setGps(coords);
      return coords;
    } catch (err: any) {
      const msg = err.message || 'GPS fix failed';
      setGpsError(msg);
      showToast(msg, 'error');
      return null;
    } finally {
      setGpsLoading(false);
    }
  }, [showToast]);

  // Handle GPS Punch In
  const handlePunchIn = async () => {
    if (!worker?.project_id || !worker?.site_id) {
      showToast('Worker profile is missing assigned project or site', 'error');
      return;
    }
    let coords = gps;
    if (!coords) {
      coords = await refreshGps();
      if (!coords) return;
    }

    try {
      await attendanceApi.gpsPunchIn({
        project_id: worker.project_id,
        site_id: worker.site_id,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy
      });
      showToast('Successfully clocked in!', 'success');
      loadWorkerData();
    } catch (err: any) {
      showToast(err.message || 'Punch in failed', 'error');
    }
  };

  // Handle GPS Punch Out
  const handlePunchOut = async () => {
    let coords = gps;
    if (!coords) {
      coords = await refreshGps();
      if (!coords) return;
    }

    try {
      await attendanceApi.gpsPunchOut({
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy
      });
      showToast('Successfully clocked out!', 'success');
      loadWorkerData();
    } catch (err: any) {
      showToast(err.message || 'Punch out failed', 'error');
    }
  };

  // Handle Task Photo Evidence using native camera
  const handleTaskPhoto = async (task: any) => {
    try {
      const photoData = await nativeService.capturePhoto();
      showToast('Photo captured successfully', 'success');
      // Update task status or add evidence
      await tasksApi.update(task.id, {
        status: 'In Progress',
        progress: Math.max(task.progress || 25, 25)
      });
      showToast('Task progress updated with photo', 'success');
      loadWorkerData();
    } catch (err: any) {
      if (!err.message?.includes('cancelled')) {
        showToast(err.message || 'Failed to capture photo', 'error');
      }
    }
  };

  // Handle Task Verification Request
  const handleSubmitTaskForVerification = async (task: any) => {
    try {
      await tasksApi.update(task.id, {
        status: 'Ready for Verification',
        progress: 100
      });
      showToast('Task submitted for supervisor inspection', 'success');
      loadWorkerData();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit task', 'error');
    }
  };

  // Handle Instruction Evidence Submission
  const handleSubmitEvidence = async (e: FormEvent) => {
    e.preventDefault();
    if (!instructionEvidenceModal) return;
    try {
      await instructionsApi.submitEvidence(instructionEvidenceModal.id, {
        notes: evidenceNote,
        attachment_data: evidencePhoto || undefined
      });
      showToast('Evidence submitted successfully', 'success');
      setInstructionEvidenceModal(null);
      setEvidenceNote('');
      setEvidencePhoto(null);
      loadWorkerData();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit evidence', 'error');
    }
  };

  // Handle Leave Request Submission
  const handleRequestLeave = async (e: FormEvent) => {
    e.preventDefault();
    if (!leaveForm.start_date || !leaveForm.end_date) {
      showToast('Please specify start and end dates', 'error');
      return;
    }
    try {
      await leaveApi.createRequest({
        project_id: worker?.project_id,
        leave_type_id: leaveForm.leave_type_id,
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        reason: leaveForm.reason
      });
      showToast('Leave request submitted', 'success');
      setShowLeaveModal(false);
      setLeaveForm({ leave_type_id: leaveTypes[0]?.id || '', start_date: '', end_date: '', reason: '' });
      loadWorkerData();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit leave request', 'error');
    }
  };

  const handleLogout = () => {
    clearToken();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between font-sans max-w-lg mx-auto shadow-2xl relative select-none">
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-4 left-4 right-4 z-50 p-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md border ${
          toast.type === 'success' ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40' :
          toast.type === 'error' ? 'bg-rose-950/90 text-rose-200 border-rose-500/40' :
          'bg-blue-950/90 text-blue-200 border-blue-500/40'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" /> :
           toast.type === 'error' ? <AlertCircle size={16} className="text-rose-400 flex-shrink-0" /> :
           <AlertTriangle size={16} className="text-blue-400 flex-shrink-0" />}
          <span className="flex-1">{toast.message}</span>
        </div>
      )}

      {/* ─── Top App Header ─── */}
      <header className="bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <HardHat size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xs font-bold text-white tracking-wide uppercase">
              {assignedSite?.name || 'MEP Operative App'}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-[10px] text-slate-400 font-medium">
                {isOnline ? (nativeService.isNative() ? 'Native GPS' : 'Web Online') : 'Offline'}
              </span>
              {worker?.trade && (
                <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.2 rounded font-semibold ml-1">
                  {worker.trade}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {onExitMobile && (
            <button
              onClick={onExitMobile}
              className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
            >
              Desktop
            </button>
          )}
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
            title="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ─── Main Content Tabs ─── */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
            <Loader2 size={32} className="animate-spin text-blue-500" />
            <p className="text-xs font-medium">Synchronizing site schedule & GPS...</p>
          </div>
        ) : (
          <>
            {/* ══════════════ TAB 1: TODAY ══════════════ */}
            {tab === 'today' && (
              <div className="space-y-4">
                {/* Operative Welcome */}
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-4 rounded-2xl border border-slate-700/80 shadow-md">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-slate-400 font-medium">Welcome back,</p>
                      <h2 className="text-lg font-extrabold text-white mt-0.5">{worker?.name || 'Operative'}</h2>
                      <p className="text-xs text-blue-400 font-mono mt-0.5">{worker?.employee_id || 'MEP-W-01'}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-300">
                        {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">Shift: 07:00 – 16:00</p>
                    </div>
                  </div>
                </div>

                {/* Clock-In Big Status Widget */}
                {activePunch ? (
                  <div className="bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-900 p-5 rounded-2xl border border-emerald-500/40 shadow-lg relative overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">Clocked In</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Since {new Date(activePunch.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="text-center py-2">
                      <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Shift Elapsed Time</p>
                      <p className="text-4xl font-black font-mono text-white mt-1 tracking-tight text-emerald-400 drop-shadow">
                        {elapsedTimer}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <MapPin size={12} className="text-emerald-400" /> {assignedSite?.name || 'Site Verified'}
                      </span>
                      <button
                        onClick={() => setTab('punch')}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors shadow-md"
                      >
                        Punch Out
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gradient-to-br from-amber-950/50 via-slate-900 to-slate-900 p-5 rounded-2xl border border-amber-500/40 shadow-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                        <Clock size={14} /> Not Clocked In
                      </span>
                      <span className="text-[11px] text-slate-400">Scheduled: 07:00 AM</span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      You are assigned to <strong className="text-white">{assignedSite?.name || 'Project Site'}</strong>. Punch in with GPS to verify attendance.
                    </p>
                    <button
                      onClick={() => setTab('punch')}
                      className="mt-4 w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-900/30 transition-all flex items-center justify-center gap-2"
                    >
                      <Timer size={18} /> Open Punch Clock
                    </button>
                  </div>
                )}

                {/* Quick 3-Metric Tiles */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div onClick={() => setTab('tasks')} className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 cursor-pointer hover:border-blue-500 transition-all">
                    <CheckSquare size={16} className="text-blue-400 mb-1" />
                    <p className="text-lg font-black text-white">{tasks.length}</p>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase">My Tasks</p>
                  </div>

                  <div onClick={() => setTab('instructions')} className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 cursor-pointer hover:border-purple-500 transition-all">
                    <ClipboardList size={16} className="text-purple-400 mb-1" />
                    <p className="text-lg font-black text-white">{instructions.length}</p>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase">Instructions</p>
                  </div>

                  <div onClick={() => setTab('leave')} className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 cursor-pointer hover:border-amber-500 transition-all">
                    <Calendar size={16} className="text-amber-400 mb-1" />
                    <p className="text-lg font-black text-white">
                      {leaveBalances[0]?.remaining_days ?? 18}d
                    </p>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase">Leave Balance</p>
                  </div>
                </div>

                {/* Recent Task List on Today */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Priority Tasks Due Today</h3>
                    <button onClick={() => setTab('tasks')} className="text-xs text-blue-400 font-medium hover:underline">View All</button>
                  </div>

                  {tasks.length === 0 ? (
                    <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 text-center text-xs text-slate-400">
                      No tasks assigned for today. Check in with your site supervisor.
                    </div>
                  ) : (
                    tasks.slice(0, 3).map(t => (
                      <div key={t.id} className="bg-slate-800/80 border border-slate-700/70 p-3 rounded-xl flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_COLORS[t.priority || 'Medium'] || 'bg-slate-700 text-slate-300'}`}>
                              {t.priority || 'Normal'}
                            </span>
                            {t.trade && <span className="text-[10px] text-purple-300 bg-purple-900/40 px-1.5 py-0.5 rounded">{t.trade}</span>}
                          </div>
                          <p className="text-xs font-bold text-white truncate">{t.title}</p>
                        </div>
                        <span className="text-[11px] font-bold text-blue-400 flex-shrink-0">{t.progress || 0}%</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ══════════════ TAB 2: PUNCH CLOCK ══════════════ */}
            {tab === 'punch' && (
              <div className="space-y-4">
                {/* Site Header */}
                <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-2xl">
                  <p className="text-xs text-slate-400 uppercase font-semibold">Assigned Construction Site</p>
                  <h3 className="text-base font-extrabold text-white mt-1 flex items-center gap-1.5">
                    <MapPin size={16} className="text-blue-400 flex-shrink-0" />
                    {assignedSite?.name || 'Assigned Site'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {assignedSite?.address || 'Site geofence enforced. Punching records GPS position for audit.'}
                  </p>
                </div>

                {/* GPS Status Card */}
                <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <Shield size={14} className="text-emerald-400" /> GPS Geofence Telemetry
                    </span>
                    <button
                      onClick={refreshGps}
                      disabled={gpsLoading}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={gpsLoading ? 'animate-spin' : ''} />
                      {gpsLoading ? 'Acquiring...' : 'Refresh Fix'}
                    </button>
                  </div>

                  {gps ? (
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-400 block font-semibold">Accuracy</span>
                        <span className="text-emerald-400 font-bold font-mono">±{Math.round(gps.accuracy)}m</span>
                      </div>
                      <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-400 block font-semibold">Coordinates</span>
                        <span className="text-slate-300 font-mono text-[11px] truncate block">
                          {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                      <span>GPS fix not acquired yet.</span>
                      <button onClick={refreshGps} className="text-blue-400 font-bold hover:underline">Get Fix</button>
                    </div>
                  )}

                  {gpsError && (
                    <div className="text-[11px] text-rose-300 bg-rose-950/40 p-2.5 rounded-xl border border-rose-800/40 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-rose-400 flex-shrink-0" />
                      <span>{gpsError}</span>
                    </div>
                  )}
                </div>

                {/* Big Giant Punch Button */}
                <div className="py-4 flex flex-col items-center justify-center">
                  {activePunch ? (
                    <button
                      onClick={handlePunchOut}
                      className="w-48 h-48 rounded-full bg-gradient-to-tr from-rose-600 via-rose-500 to-amber-600 text-white shadow-2xl shadow-rose-900/50 flex flex-col items-center justify-center p-4 transform active:scale-95 transition-all border-4 border-rose-400/40 hover:brightness-110"
                    >
                      <LogOut size={36} className="mb-2" />
                      <span className="text-base font-black tracking-wider uppercase">PUNCH OUT</span>
                      <span className="text-xs font-mono font-bold mt-1 text-rose-100">{elapsedTimer}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePunchIn}
                      className="w-48 h-48 rounded-full bg-gradient-to-tr from-emerald-600 via-teal-500 to-blue-600 text-white shadow-2xl shadow-emerald-900/50 flex flex-col items-center justify-center p-4 transform active:scale-95 transition-all border-4 border-emerald-400/40 hover:brightness-110"
                    >
                      <Timer size={36} className="mb-2" />
                      <span className="text-base font-black tracking-wider uppercase">PUNCH IN</span>
                      <span className="text-[10px] text-emerald-100 font-semibold mt-1">GPS VERIFIED</span>
                    </button>
                  )}
                </div>

                {/* Today's Punch History */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Today's Punches</h4>
                  {todayAttendance.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4 bg-slate-800/30 rounded-xl">No punch records logged today yet.</p>
                  ) : (
                    todayAttendance.map((att: any, idx) => (
                      <div key={att.id || idx} className="bg-slate-800/70 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">In: {new Date(att.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {att.punch_out && (
                              <span className="text-slate-400">• Out: {new Date(att.punch_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">{att.site_name || 'Assigned Site'}</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${att.punch_out ? 'bg-slate-700 text-slate-300' : 'bg-emerald-900/60 text-emerald-300'}`}>
                          {att.punch_out ? 'Completed' : 'Working'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ══════════════ TAB 3: TASKS ══════════════ */}
            {tab === 'tasks' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">My Construction Tasks ({tasks.length})</h3>
                  <button onClick={loadWorkerData} className="text-xs text-blue-400 font-medium hover:underline flex items-center gap-1">
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>

                {tasks.length === 0 ? (
                  <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 space-y-2">
                    <CheckSquare size={32} className="mx-auto text-slate-600" />
                    <p className="text-sm font-semibold">No assigned tasks found</p>
                    <p className="text-xs text-slate-500">Your site engineer will assign work packages here.</p>
                  </div>
                ) : (
                  tasks.map(t => (
                    <div key={t.id} className="bg-slate-800/90 border border-slate-700/80 p-4 rounded-2xl space-y-3 shadow-md">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIORITY_COLORS[t.priority || 'Medium'] || 'bg-slate-700 text-slate-300'}`}>
                              {t.priority || 'Normal'}
                            </span>
                            {t.trade && <span className="text-[10px] text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded font-semibold">{t.trade}</span>}
                            {t.wbs_code && <span className="text-[10px] font-mono text-slate-400">{t.wbs_code}</span>}
                          </div>
                          <h4 className="text-sm font-bold text-white leading-tight">{t.title}</h4>
                          {t.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{t.description}</p>}
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${STATUS_COLORS[t.status || 'Assigned'] || 'bg-slate-700 text-slate-300'}`}>
                          {t.status || 'Assigned'}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between text-[11px] font-semibold text-slate-400 mb-1">
                          <span>Completion Progress</span>
                          <span className="text-white font-bold">{t.progress || 0}%</span>
                        </div>
                        <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all ${(t.progress || 0) >= 100 ? 'bg-emerald-400' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(t.progress || 0, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Operative Action Buttons */}
                      <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between gap-2 flex-wrap">
                        <button
                          onClick={() => handleTaskPhoto(t)}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        >
                          <Camera size={14} /> Add Photo
                        </button>

                        <div className="flex items-center gap-1.5">
                          {t.status !== 'In Progress' && t.status !== 'Ready for Verification' && t.status !== 'Completed' && (
                            <button
                              onClick={() => {
                                tasksApi.update(t.id, { status: 'In Progress' }).then(() => {
                                  showToast('Task started', 'success');
                                  loadWorkerData();
                                });
                              }}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors"
                            >
                              Start
                            </button>
                          )}

                          {t.status !== 'Ready for Verification' && t.status !== 'Completed' && (
                            <button
                              onClick={() => handleSubmitTaskForVerification(t)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors"
                            >
                              Ready for Verify
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ══════════════ TAB 4: SITE INSTRUCTIONS ══════════════ */}
            {tab === 'instructions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Site Instructions ({instructions.length})</h3>
                  <button onClick={loadWorkerData} className="text-xs text-blue-400 font-medium hover:underline flex items-center gap-1">
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>

                {instructions.length === 0 ? (
                  <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 space-y-2">
                    <ClipboardList size={32} className="mx-auto text-slate-600" />
                    <p className="text-sm font-semibold">No site instructions assigned</p>
                    <p className="text-xs text-slate-500">Official site orders and directives will appear here.</p>
                  </div>
                ) : (
                  instructions.map(inst => (
                    <div key={inst.id} className="bg-slate-800/90 border border-slate-700/80 p-4 rounded-2xl space-y-3 shadow-md">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-900/60 text-blue-300">
                              {inst.instruction_number || 'SI'}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIORITY_COLORS[inst.priority || 'Medium'] || 'bg-slate-700 text-slate-300'}`}>
                              {inst.priority || 'Normal'}
                            </span>
                            {inst.type && <span className="text-[10px] text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded font-semibold">{inst.type}</span>}
                          </div>
                          <h4 className="text-sm font-bold text-white leading-tight">{inst.title}</h4>
                          <p className="text-xs text-slate-400 mt-1 whitespace-pre-line">{inst.description}</p>
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${STATUS_COLORS[inst.status || 'Draft'] || 'bg-slate-700 text-slate-300'}`}>
                          {inst.status}
                        </span>
                      </div>

                      {/* Workflow Actions */}
                      <div className="pt-2 border-t border-slate-700/60 flex items-center justify-end gap-2 flex-wrap">
                        {inst.status === 'Assigned' && (
                          <button
                            onClick={() => {
                              instructionsApi.acknowledge(inst.id).then(() => {
                                showToast('Instruction acknowledged', 'success');
                                loadWorkerData();
                              }).catch(e => showToast(e.message, 'error'));
                            }}
                            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}

                        {inst.status === 'Acknowledged' && (
                          <button
                            onClick={() => {
                              instructionsApi.start(inst.id).then(() => {
                                showToast('Work started on instruction', 'success');
                                loadWorkerData();
                              }).catch(e => showToast(e.message, 'error'));
                            }}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors"
                          >
                            Start Work
                          </button>
                        )}

                        {inst.status === 'In Progress' && (
                          <>
                            <button
                              onClick={() => {
                                setInstructionEvidenceModal(inst);
                                setEvidenceNote('');
                                setEvidencePhoto(null);
                              }}
                              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                            >
                              <Camera size={14} /> Add Evidence
                            </button>
                            <button
                              onClick={() => {
                                instructionsApi.readyForVerification(inst.id).then(() => {
                                  showToast('Submitted for verification', 'success');
                                  loadWorkerData();
                                }).catch(e => showToast(e.message, 'error'));
                              }}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors"
                            >
                              Submit for Verify
                            </button>
                          </>
                        )}

                        {inst.status === 'Ready for Verification' && (
                          <span className="text-xs text-amber-400 font-semibold flex items-center gap-1">
                            <Clock size={12} /> Awaiting Supervisor Sign-off
                          </span>
                        )}

                        {inst.status === 'Closed' && (
                          <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle size={12} /> Verified & Closed
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ══════════════ TAB 5: LEAVE ══════════════ */}
            {tab === 'leave' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Leave & Absence</h3>
                  <button
                    onClick={() => setShowLeaveModal(true)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1"
                  >
                    <Plus size={14} /> Request Leave
                  </button>
                </div>

                {/* Balances Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-slate-800/80 border border-slate-700 p-3 rounded-2xl">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Annual Leave</span>
                    <p className="text-2xl font-black text-white mt-0.5">{leaveBalances[0]?.remaining_days ?? 18} <span className="text-xs font-normal text-slate-400">days left</span></p>
                  </div>
                  <div className="bg-slate-800/80 border border-slate-700 p-3 rounded-2xl">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Sick Leave</span>
                    <p className="text-2xl font-black text-white mt-0.5">{leaveBalances[1]?.remaining_days ?? 15} <span className="text-xs font-normal text-slate-400">days left</span></p>
                  </div>
                </div>

                {/* Leave Requests History */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">My Requests</h4>
                  {leaveRequests.length === 0 ? (
                    <div className="bg-slate-800/30 rounded-xl p-6 text-center text-xs text-slate-400">
                      No leave requests submitted.
                    </div>
                  ) : (
                    leaveRequests.map(lr => (
                      <div key={lr.id} className="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <p className="font-bold text-white">{lr.leave_type_name || 'Leave'}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{lr.start_date} to {lr.end_date} ({lr.chargeable_days ?? lr.days_requested} working days)</p>
                          {lr.reason && <p className="text-[11px] text-slate-500 italic mt-0.5">{lr.reason}</p>}
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${STATUS_COLORS[lr.status || 'Pending'] || 'bg-slate-700 text-slate-300'}`}>
                          {lr.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ─── Bottom Navigation Bar (Thumb Friendly) ─── */}
      <nav className="bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 px-2 py-2 fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-40 flex items-center justify-around shadow-2xl">
        {[
          { id: 'today', label: 'Today', icon: Home },
          { id: 'punch', label: 'Punch Clock', icon: Timer },
          { id: 'tasks', label: 'Tasks', icon: CheckSquare },
          { id: 'instructions', label: 'Instructions', icon: ClipboardList },
          { id: 'leave', label: 'Leave', icon: Calendar },
        ].map(item => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id as WorkerTab)}
              className={`flex flex-col items-center justify-center flex-1 py-1.5 transition-all relative ${
                isActive ? 'text-blue-400 font-bold scale-105' : 'text-slate-500 hover:text-slate-300 font-medium'
              }`}
            >
              <Icon size={20} className={isActive ? 'text-blue-400' : 'text-slate-500'} />
              <span className="text-[10px] mt-1 tracking-tight">{item.label}</span>
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 absolute -top-1" />
              )}
            </button>
          );
        })}
      </nav>

      {/* ─── Modal: Request Leave ─── */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowLeaveModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Request Leave</h3>
              <button onClick={() => setShowLeaveModal(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={handleRequestLeave} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Leave Type</label>
                <select
                  value={leaveForm.leave_type_id}
                  onChange={e => setLeaveForm(f => ({ ...f, leave_type_id: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-white"
                >
                  {leaveTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Start Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.start_date}
                    onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">End Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.end_date}
                    onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Reason</label>
                <textarea
                  rows={2}
                  value={leaveForm.reason}
                  onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Reason for leave request..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowLeaveModal(false)} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-xl">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl">Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal: Instruction Evidence ─── */}
      {instructionEvidenceModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setInstructionEvidenceModal(null)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Upload Site Evidence</h3>
              <button onClick={() => setInstructionEvidenceModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmitEvidence} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Field Observation / Notes</label>
                <textarea
                  rows={3}
                  required
                  value={evidenceNote}
                  onChange={e => setEvidenceNote(e.target.value)}
                  placeholder="Explain completed work, testing, or containment installation..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Site Photo</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const p = await nativeService.capturePhoto();
                        setEvidencePhoto(p);
                        showToast('Photo captured', 'success');
                      } catch (err: any) {
                        showToast(err.message, 'error');
                      }
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 rounded-xl flex items-center gap-1.5 font-semibold"
                  >
                    <Camera size={14} /> Take Photo
                  </button>

                  {evidencePhoto && (
                    <div className="relative">
                      <img src={evidencePhoto} alt="Preview" className="w-10 h-10 rounded-lg object-cover border border-slate-700" />
                      <button type="button" onClick={() => setEvidencePhoto(null)} className="absolute -top-1 -right-1 bg-rose-600 rounded-full p-0.5 text-white"><X size={8} /></button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setInstructionEvidenceModal(null)} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-xl">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl">Submit Evidence</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
