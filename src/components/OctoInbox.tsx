import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Props = { projectId: string; isAdmin: boolean };
export function OctoInbox({ projectId, isAdmin }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [status, setStatus] = useState('Pending');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [kind, setKind] = useState('dailylog');
  const [text, setText] = useState('');
  const valid = Boolean(projectId && projectId !== 'ALL');
  useEffect(() => {
    let cancelled = false;
    setRows([]); setGroups([]); setSelected(null); setError('');
    if (!valid) return;
    setLoading(true);
    Promise.all([api.get<any[]>(`/api/octo/inbox?project_id=${encodeURIComponent(projectId)}&status=${status}`), api.get<any[]>('/api/octo/groups')])
      .then(([messages, mappings]) => { if (!cancelled) { setRows(messages); setGroups(mappings.filter(g => g.project_id === projectId)); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, status, refresh, valid]);
  async function run(fn: () => Promise<any>) {
    setBusy(true); setError('');
    try { await fn(); setSelected(null); setRefresh(n => n + 1); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  const input = 'border rounded-lg p-2 w-full bg-white text-gray-900';
  const button = 'border rounded-lg px-3 py-2 disabled:opacity-50';
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-semibold">WhatsApp project inbox</h1><p className="text-gray-500 mt-1">Review site messages before adding them to official project records. Categories are keyword suggestions.</p></div>
    {!valid ? <p>Select one project to view its messages and group connections.</p> : <>
      {error && <p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</p>}
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Connected project groups</h2>
        {!groups.length && <p className="text-gray-500">No groups mapped yet. An administrator can add a group after pairing Octo.</p>}
        {groups.map(g => <div key={g.group_id} className="flex flex-wrap gap-3 items-center"><span>{g.name} · {g.active ? 'Enabled' : 'Paused'}</span><code className="text-xs break-all">{g.group_id}</code>{isAdmin && <button disabled={busy} className={button} onClick={() => run(() => api.put('/api/octo/groups', { ...g, active: !g.active }))}>{g.active ? 'Pause' : 'Enable'}</button>}</div>)}
        {isAdmin && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); run(() => api.put('/api/octo/groups', { group_id: groupId, project_id: projectId, name: groupName, active: true })); }}>
          <label className="flex-1 min-w-48">Group name<input required maxLength={200} className={input} value={groupName} onChange={e => setGroupName(e.target.value)} /></label>
          <label className="flex-1 min-w-48">WhatsApp group ID<input required placeholder="120…@g.us" maxLength={100} className={input} value={groupId} onChange={e => setGroupId(e.target.value)} /></label>
          <button disabled={busy} className={button}>Map to this project</button>
        </form>}
      </div>
      <div className="flex gap-3 items-center"><label>Status <select className="border rounded p-2" value={status} onChange={e => setStatus(e.target.value)}>{['Pending', 'Approved', 'Rejected', 'All'].map(s => <option key={s}>{s}</option>)}</select></label><button disabled={busy || loading} className={button} onClick={() => setRefresh(n => n + 1)}>Refresh</button><span className="text-sm text-gray-500">Latest 200 messages</span></div>
      {loading ? <p role="status">Loading messages…</p> : !rows.length && <p className="p-6 border rounded-xl">No messages in this view. New text messages appear after Octo is linked and this group is enabled in both applications.</p>}
      {rows.map(row => <article key={row.id} className="border rounded-xl p-4 bg-white space-y-2">
        <div className="text-sm text-gray-500 break-words">{row.group_name} · {row.sender} · {new Date(row.sent_at).toLocaleString()} · {row.category} · {row.status}</div>
        <p className="whitespace-pre-wrap break-words">{row.body}</p>
        {row.status === 'Pending' && <div className="flex gap-2"><button disabled={busy} className={button} onClick={() => { setSelected(row); setKind('dailylog'); setText(row.body); }}>Review</button><button disabled={busy} className={button} onClick={() => run(() => api.post(`/api/octo/inbox/${row.id}/review`, { action: 'reject' }))}>Dismiss</button></div>}
        {row.record_id && <p className="text-sm text-green-700">Created {row.record_type === 'task' ? 'task' : 'site log'} · {row.record_id}</p>}
      </article>)}
      {selected && <form className="border-2 border-blue-500 bg-white rounded-xl p-4 space-y-3" onSubmit={e => { e.preventDefault(); run(() => api.post(`/api/octo/inbox/${selected.id}/review`, { action: 'approve', record_type: kind, text })); }}>
        <h2 className="font-semibold">Approve project record</h2>
        <p className="text-sm text-gray-500 whitespace-pre-wrap">Source: {selected.body}</p>
        <label className="block">Create <select className="border rounded p-2 ml-2" value={kind} onChange={e => setKind(e.target.value)}><option value="dailylog">Site log</option><option value="task">Task</option></select></label>
        <label className="block">{kind === 'task' ? 'Task title (maximum 300 characters)' : 'Site log notes'}<textarea required maxLength={kind === 'task' ? 300 : 10000} className={input} rows={4} value={text} onChange={e => setText(e.target.value)} /></label>
        {kind === 'task' && text.length > 300 && <p role="alert">Shorten the task title to 300 characters.</p>}
        <div className="flex gap-2"><button disabled={busy || !text.trim() || (kind === 'task' && text.length > 300)} className={button}>Approve and create</button><button type="button" disabled={busy} className={button} onClick={() => setSelected(null)}>Cancel</button></div>
      </form>}
    </>}
  </section>;
}
