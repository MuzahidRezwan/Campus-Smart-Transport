import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import type { RoutineVersion } from '../../lib/types';
import { DIU_DEPARTMENTS } from '@diu/shared';
import { Card, ErrorNote, Loading, Modal, Pill, useToast, type Tone } from '../../components/ui';

const TONE: Record<string, Tone> = { pending_review: 'warn', active: 'ok', rejected: 'crit', superseded: 'none' };

export function RoutinesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['routines'], queryFn: () => api<RoutineVersion[]>('/admin/routines') });
  const [department, setDepartment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => { const f = new FormData(); f.set('department', department); f.set('file', file!); return api<{ sessions: number; warnings: string[]; duplicate: boolean }>('/admin/routines/upload', { form: f }); },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['routines'] }); toast(r.duplicate ? 'This routine is already uploaded' : `${r.sessions} classes read · waiting for review`); setFile(null); },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'reject' }) => api(`/admin/routines/${id}/${action}`, { body: {} }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['routines'] }); toast(v.action === 'activate' ? 'Routine activated. Re-run the forecast to use it.' : 'Routine rejected'); },
  });
  return (
    <>
      <SourcesCard />
      <Card title="Upload a class routine">
        <form className="grid max-w-2xl gap-3" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <p className="muted m-0">Best: the standard CSV template (<span className="mono">department, batch, section, teacher_initial, day, start_time, end_time, course_code, room</span>). Department grid files (XLSX, PDF, Word, HTML) with cells like <span className="mono">SE331 (41_G) MRH</span> also work. New routines wait for review before they affect predictions.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field" htmlFor="dept">Department<input id="dept" className="input" list="diu-departments" required minLength={2} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Software Engineering" /></label>
            <datalist id="diu-departments">{DIU_DEPARTMENTS.map((d) => <option key={d.code} value={d.name} />)}</datalist>
            <label className="field" htmlFor="file">File (CSV, XLSX, PDF, Word, HTML · up to 5 MB)<input id="file" type="file" className="input" accept=".csv,.xlsx,.pdf,.docx,.html,.htm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <button className="btn btn-primary" disabled={!file || !department || upload.isPending}>{upload.isPending ? 'Reading…' : 'Upload'}</button>
          </div>
          {upload.error ? <ErrorNote error={upload.error} /> : null}
        </form>
      </Card>
      <Card title="Routine versions">
        {list.isLoading ? <Loading /> : !list.data?.length ? <p className="muted">No routines yet.</p> : (
          <div className="overflow-x-auto"><table className="data">
            <thead><tr><th>Department</th><th>File</th><th>Classes</th><th>Warnings</th><th>Status</th><th>Uploaded</th><th /></tr></thead>
            <tbody>{list.data.map((v) => (
              <tr key={v.id}>
                <td><b>{v.department}</b></td><td className="text-xs">{v.fileName}</td><td className="num">{v.sessionCount}</td>
                <td className="text-xs">{v.warnings.length ? <details><summary>{v.warnings.length} warning(s)</summary><ul className="pl-4">{v.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul></details> : 'None'}</td>
                <td><Pill tone={TONE[v.status] ?? 'none'}>{v.status.replace('_', ' ')}</Pill></td><td className="text-xs">{dateTime(v.createdAt)}</td>
                <td>{v.status === 'pending_review' && <div className="flex gap-1.5"><button className="btn btn-sm btn-primary" onClick={() => act.mutate({ id: v.id, action: 'activate' })}>Activate</button><button className="btn btn-sm btn-danger" onClick={() => act.mutate({ id: v.id, action: 'reject' })}>Reject</button></div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

interface Source { id: string; department: string; url: string; kind: string; isActive: boolean; lastCheckedAt: string | null; lastStatus: string | null; lastError: string | null; lastFoundUrl: string | null }
const SOURCE_TONE: Record<string, Tone> = { new_version: 'warn', unchanged: 'ok', no_classes: 'warn', error: 'crit' };
const SOURCE_LABEL: Record<string, string> = { new_version: 'New routine: review below', unchanged: 'Up to date', no_classes: 'No classes found', error: 'Could not read' };
const shortUrl = (u: string) => u.replace(/^https:\/\//, '').replace(/^webbackend\.daffodilvarsity\.edu\.bd/, '…');

/**
 * Where each department publishes its routine. Checked every morning at 05:00;
 * "Check now" tests a link at once. A department page is followed to its newest
 * "Class Routine" notice and file; a direct file, Google Drive or Sheets link works too.
 */
function SourcesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['routine-sources'], queryFn: () => api<Source[]>('/admin/routines/sources') });
  const [edit, setEdit] = useState<Source | 'new' | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['routine-sources'] }); qc.invalidateQueries({ queryKey: ['routines'] }); };
  const check = useMutation({
    mutationFn: (id: string) => api<{ status: string; department: string }>(`/admin/routines/sources/${id}/check`, { body: {} }),
    onSuccess: (r) => { refresh(); toast(`${r.department}: ${SOURCE_LABEL[r.status] ?? r.status}`); },
  });
  const checkAll = useMutation({
    mutationFn: () => api<{ status: string }[]>('/admin/routines/sources/check-all', { body: {} }),
    onSuccess: (r) => { refresh(); toast(`${r.length} checked · ${r.filter((x) => x.status === 'new_version').length} new routine(s) to review · ${r.filter((x) => x.status === 'error').length} could not be read`); },
  });
  const addAll = useMutation({
    mutationFn: () => api<{ added: number }>('/admin/routines/sources/diu-departments', { body: {} }),
    onSuccess: (r) => { refresh(); toast(r.added ? `${r.added} department(s) added` : 'Every department is already listed'); },
  });
  const toggle = useMutation({
    mutationFn: (s: Source) => api(`/admin/routines/sources/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } }),
    onSuccess: refresh,
  });
  const rows = list.data ?? [];
  return (
    <Card title="Department routine sources" actions={<>
      <Pill tone="none">{rows.filter((s) => s.isActive).length} of {rows.length} on</Pill>
      <button className="btn btn-sm" disabled={addAll.isPending} onClick={() => addAll.mutate()}>Add all DIU departments</button>
      <button className="btn btn-sm" onClick={() => setEdit('new')}>Add a source</button>
      <button className="btn btn-sm btn-primary" disabled={checkAll.isPending} onClick={() => checkAll.mutate()}>{checkAll.isPending ? 'Checking…' : 'Check all now'}</button>
    </>}>
      <p className="muted mb-2 text-xs">Every morning at 05:00 the system opens each department's link, finds its newest class routine (a department notice page is followed to its newest "Class Routine" notice and file) and keeps any change for your review below. A link can also be the routine file itself, or a Google Drive / Google Sheets link. If a department is read wrongly, paste the exact routine link instead.</p>
      {check.error ? <ErrorNote error={check.error} /> : null}
      {checkAll.error ? <ErrorNote error={checkAll.error} /> : null}
      {list.isLoading ? <Loading /> : (
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Department</th><th>Link</th><th>Last check</th><th /></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
              <td><b>{s.department}</b>{!s.isActive && <div className="muted text-xs">Switched off</div>}</td>
              <td className="max-w-[260px] text-xs"><a href={s.url} target="_blank" rel="noreferrer" className="break-all">{shortUrl(s.url)}</a>
                {s.lastFoundUrl && s.lastFoundUrl !== s.url && <div className="muted break-all">Read: <a href={s.lastFoundUrl} target="_blank" rel="noreferrer">{shortUrl(s.lastFoundUrl)}</a></div>}</td>
              <td className="text-xs">{s.lastStatus ? <Pill tone={SOURCE_TONE[s.lastStatus] ?? 'none'}>{SOURCE_LABEL[s.lastStatus] ?? s.lastStatus}</Pill> : <span className="muted">Not checked yet</span>}
                {s.lastCheckedAt && <div className="muted">{dateTime(s.lastCheckedAt)}</div>}
                {s.lastError && <div className="muted max-w-[280px]">{s.lastError}</div>}</td>
              <td><div className="flex flex-wrap gap-1.5">
                <button className="btn btn-sm" disabled={check.isPending} onClick={() => check.mutate(s.id)}>Check now</button>
                <button className="btn btn-sm" onClick={() => setEdit(s)}>Edit</button>
                <button className="btn btn-sm" onClick={() => toggle.mutate(s)}>{s.isActive ? 'Switch off' : 'Switch on'}</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <SourceDialog source={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </Card>
  );
}

function SourceDialog({ source, onClose, onSaved }: { source: Source | null; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({ department: source?.department ?? '', url: source?.url ?? '' });
  const save = useMutation({
    mutationFn: () => source
      ? api(`/admin/routines/sources/${source.id}`, { method: 'PATCH', body: { department: f.department.trim(), url: f.url.trim() } })
      : api('/admin/routines/sources', { body: { department: f.department.trim(), url: f.url.trim() } }),
    onSuccess: () => { onSaved(); toast('Source saved. Press "Check now" to test it.'); onClose(); },
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/routines/sources/${source!.id}`, { method: 'DELETE' }),
    onSuccess: () => { onSaved(); toast('Source removed; routines already read from it stay'); onClose(); },
  });
  return (
    <Modal title={source ? `Edit ${source.department}` : 'Add a routine source'} onClose={onClose} width={620}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="field" htmlFor="src-dept">Department<input id="src-dept" className="input" list="diu-departments-src" required minLength={2} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
        <datalist id="diu-departments-src">{DIU_DEPARTMENTS.map((d) => <option key={d.code} value={d.name} />)}</datalist>
        <label className="field" htmlFor="src-url">Link (https://)<input id="src-url" className="input mono text-xs" type="url" required pattern="https://.*" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://webbackend.daffodilvarsity.edu.bd/department/swe/notice" /></label>
        <p className="muted m-0 text-xs">A department's notice page, the routine file itself (PDF, Word, Excel, CSV), or a Google Drive / Google Sheets link. Only DIU and Google links are read.</p>
        {save.error ? <ErrorNote error={save.error} /> : null}
        {remove.error ? <ErrorNote error={remove.error} /> : null}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={save.isPending}>Save</button>
          <span className="flex-1" />
          {source && <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</button>}
        </div>
      </form>
    </Modal>
  );
}
