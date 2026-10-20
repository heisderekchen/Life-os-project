'use client';
import { useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete, apiPath } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ImagePlus, Pencil, Trash2, X } from 'lucide-react';

type NoteImage = { id: string; name: string; mime: string; url: string };
type Note = { id: string; taskId: string; content: string; images: NoteImage[]; revision: number; createdAt: string; updatedAt: string };
type Page = { notes: Note[]; nextCursor: string | null };
type DraftImage = { id?: string; name: string; mime?: string; url?: string; dataUrl?: string };
type Draft = { text: string; images: DraftImage[]; editing: string | null; revision: number | null; error: string | null; conflict: boolean; deleteConflict: boolean; confirmDelete: string | null; busy: boolean; status: string | null };

const emptyDraft: Draft = { text: '', images: [], editing: null, revision: null, error: null, conflict: false, deleteConflict: false, confirmDelete: null, busy: false, status: null };
const MAX_FILE = 8 * 1024 * 1024;
const MAX_OUT = 160 * 1024;

function bytesOf(dataUrl: string) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function compressImage(file: File): Promise<DraftImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('type');
  if (file.size > MAX_FILE) throw new Error('size');
  let bitmap: ImageBitmap | null = null;
  let img: HTMLImageElement | null = null;
  let url = '';
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file);
    else {
      url = URL.createObjectURL(file);
      img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode'));
        el.src = url;
      });
    }
    const source: CanvasImageSource = bitmap ?? img!;
    const w0 = bitmap ? bitmap.width : img!.naturalWidth;
    const h0 = bitmap ? bitmap.height : img!.naturalHeight;
    if (!w0 || !h0) throw new Error('decode');
    for (const max of [1600, 1200, 900, 600]) {
      const scale = Math.min(1, max / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(source, 0, 0, w, h);
      for (const q of [0.82, 0.65, 0.45, 0.25]) {
        const dataUrl = canvas.toDataURL('image/webp', q);
        if (bytesOf(dataUrl) <= MAX_OUT) return { name: file.name.replace(/\.[^.]+$/, '').slice(0, 110) + '.webp', dataUrl, mime: 'image/webp' };
      }
    }
    throw new Error('large');
  } finally {
    bitmap?.close();
    if (url) URL.revokeObjectURL(url);
  }
}

function statusOf(e: unknown) {
  const x = e as { status?: number; response?: { status?: number } };
  return x?.status ?? x?.response?.status ?? (e instanceof Error && /版本冲突|已被修改|NOTE_CONFLICT/.test(e.message) ? 409 : undefined);
}
function imgErr(e: unknown, zh: boolean) {
  const code = e instanceof Error ? e.message : '';
  if (code === 'type') return zh ? '仅支持 PNG/JPEG/WebP' : 'Only PNG/JPEG/WebP allowed';
  if (code === 'size') return zh ? '单张图片不能超过 8MiB' : 'Each image must be ≤ 8MiB';
  if (code === 'large') return zh ? '压缩后仍超过 160KiB，请换小图' : 'Still over 160KiB after compression; use a smaller image';
  return zh ? '图片处理失败' : 'Image processing failed';
}
function apiErr(e: unknown, zh: boolean) {
  if (statusOf(e) === 409) return zh ? '内容已被修改，请刷新后重试' : 'Changed elsewhere. Refresh and retry.';
  return e instanceof Error && e.message ? e.message : zh ? '保存失败' : 'Save failed';
}
function formatTime(iso: string, zh: boolean) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(zh ? 'zh-CN' : undefined);
}

export function TaskNotes({ taskId, taskTitle, zh }: { taskId: string | null; taskTitle?: string; zh: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<{ url: string; name: string; taskId: string } | null>(null);
  const busyRef = useRef<Record<string, boolean>>({});
  const verRef = useRef<Record<string, number>>({});
  const qc = useQueryClient();
  const notesQuery = useInfiniteQuery({
    queryKey: ['task-notes', taskId],
    enabled: Boolean(taskId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const id = taskId ?? '';
      return apiGet<Page>(`/api/tasks/${encodeURIComponent(id)}/notes${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const notes = useMemo(
    () => (notesQuery.data?.pages.flatMap((p) => p.notes) ?? []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notesQuery.data],
  );

  if (!taskId) return null;
  const tid = taskId;
  const d = drafts[tid] ?? emptyDraft;

  const update = (id: string, fn: (d: Draft) => Draft) =>
    setDrafts((prev) => ({ ...prev, [id]: fn(prev[id] ?? emptyDraft) }));
  const patch = (id: string, p: Partial<Draft>) => update(id, (cur) => ({ ...cur, ...p }));
  const token = (id: string) => verRef.current[id] ?? 0;
  const bump = (id: string) => { verRef.current[id] = (verRef.current[id] ?? 0) + 1; };

  async function addFiles(files: File[]) {
    if (busyRef.current[tid]) return;
    const cur = drafts[tid] ?? emptyDraft;
    const room = Math.max(0, 4 - cur.images.length);
    if (!room) { patch(tid, { error: zh ? '每条备注最多 4 张图片' : 'Up to 4 images per note' }); return; }
    const chosen = files.slice(0, room);
    const errors = files.length > chosen.length ? [zh ? '每条备注最多 4 张图片' : 'Up to 4 images per note'] : [];
    busyRef.current[tid] = true;
    patch(tid, { busy: true, error: null, status: null });
    const v = token(tid);
    for (const file of chosen) {
      if (token(tid) !== v) break;
      try {
        const image = await compressImage(file);
        update(tid, (state) => {
          if (token(tid) !== v || state.images.length >= 4) return state;
          return { ...state, images: [...state.images, image], error: null };
        });
      } catch (e) {
        errors.push(`${file.name}: ${imgErr(e, zh)}`);
      }
    }
    update(tid, (state) => ({ ...state, busy: false, error: errors.length ? errors.join('；') : state.error }));
    busyRef.current[tid] = false;
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (files.length) void addFiles(files);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (!files.length) return;
    e.preventDefault();
    if (busyRef.current[tid]) return;
    const text = e.clipboardData.getData('text/plain');
    if (text) update(tid, (state) => ({ ...state, text: state.text + (state.text && !/\s$/.test(state.text) ? '\n' : '') + text }));
    void addFiles(files);
  }

  function setText(text: string) {
    update(tid, (state) => ({ ...state, text, error: null, conflict: false, status: null }));
  }
  function removeImage(index: number) {
    if (busyRef.current[tid]) return;
    update(tid, (state) => ({ ...state, images: state.images.filter((_, i) => i !== index) }));
  }
  function beginEdit(note: Note) {
    if (busyRef.current[tid] || d.editing) return;
    bump(tid);
    requestAnimationFrame(() => document.getElementById(`task-notes-text-${tid}`)?.focus());
    update(tid, () => ({ ...emptyDraft, text: note.content, images: note.images.map(({ id, name, mime, url }) => ({ id, name, mime, url })), editing: note.id, revision: note.revision }));
  }
  function cancelEdit() {
    if (busyRef.current[tid]) return;
    bump(tid);
    update(tid, () => ({ ...emptyDraft }));
  }

  async function saveNote() {
    if (busyRef.current[tid]) return;
    const cur = drafts[tid] ?? emptyDraft;
    if (!cur.text.trim() && cur.images.length === 0) return;
    busyRef.current[tid] = true;
    const v = token(tid);
    patch(tid, { busy: true, error: null, conflict: false, deleteConflict: false, status: null });
    try {
      const images = cur.images.map((im) => (im.id ? { id: im.id } : { name: im.name, dataUrl: im.dataUrl! }));
      if (cur.editing) await apiPatch(`/api/tasks/${encodeURIComponent(tid)}/notes/${encodeURIComponent(cur.editing)}`, { content: cur.text, images, expectedRevision: cur.revision });
      else await apiPost(`/api/tasks/${encodeURIComponent(tid)}/notes`, { content: cur.text, images });
      await Promise.all([qc.invalidateQueries({ queryKey: ['task-notes', tid] }), qc.invalidateQueries({ queryKey: ['tasks'] })]);
      update(tid, (state) => token(tid) !== v ? { ...state, busy: false } : cur.editing
        ? { ...state, text: '', images: [], editing: null, revision: null, error: null, conflict: false, deleteConflict: false, confirmDelete: null, busy: false, status: zh ? '已保存' : 'Saved' }
        : { ...emptyDraft, status: zh ? '已保存' : 'Saved' });
    } catch (e) {
      update(tid, (state) => token(tid) !== v ? { ...state, busy: false } : { ...state, busy: false, error: apiErr(e, zh), conflict: statusOf(e) === 409, status: null });
    } finally {
      busyRef.current[tid] = false;
    }
  }

  async function removeNote(note: Note) {
    if (busyRef.current[tid]) return;
    busyRef.current[tid] = true;
    patch(tid, { busy: true, error: null, conflict: false, deleteConflict: false, status: null });
    try {
      await apiDelete(`/api/tasks/${encodeURIComponent(tid)}/notes/${encodeURIComponent(note.id)}?revision=${note.revision}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['task-notes', tid] }), qc.invalidateQueries({ queryKey: ['tasks'] })]);
      update(tid, (state) => ({
        ...state,
        ...(state.editing === note.id ? { text: '', images: [], editing: null, revision: null } : {}),
        confirmDelete: null, busy: false, error: null, conflict: false, status: zh ? '已删除' : 'Deleted',
      }));
    } catch (e) {
      update(tid, (state) => ({ ...state, busy: false, error: apiErr(e, zh), conflict: statusOf(e) === 409, deleteConflict: statusOf(e) === 409, status: null }));
    } finally {
      busyRef.current[tid] = false;
    }
  }

  async function refreshConflict() {
    if (busyRef.current[tid]) return;
    busyRef.current[tid] = true;
    patch(tid, { busy: true });
    try {
      if (d.deleteConflict || !d.editing) {
        const refreshed = await notesQuery.refetch();
        if (refreshed.isError) throw refreshed.error;
        update(tid, state => ({ ...state, busy: false, conflict: false, deleteConflict: false, error: null, confirmDelete: null, status: zh ? '已刷新备注，请核对最新内容后重新确认删除。' : 'Notes refreshed. Review the latest content and confirm deletion again.' }));
        return;
      }
      const latest = await apiGet<Note>(`/api/tasks/${encodeURIComponent(tid)}/notes/${encodeURIComponent(d.editing)}`);
      await qc.invalidateQueries({ queryKey: ['task-notes', tid] });
      update(tid, state => ({ ...state, busy: false, revision: latest.revision, conflict: false, error: null, status: zh ? '已加载最新版本，请对照下方内容合并后保存；当前草稿已保留。' : 'Latest loaded. Merge against the note below, then save. Your draft is kept.' }));
    } catch (error) {
      update(tid, state => ({ ...state, busy: false, error: apiErr(error, zh) }));
    } finally { busyRef.current[tid] = false; }
  }

  const canSave = !d.busy && (d.text.trim().length > 0 || d.images.length > 0);

  return (
    <section className="workspace-notes" aria-label={zh ? '任务备注' : 'Task notes'}>
      <div className="workspace-notes-head">
        <h4>{zh ? '备注 Notes' : 'Notes'}</h4>
        {d.editing && <Button type="button" onClick={cancelEdit} disabled={d.busy}>{zh ? '取消' : 'Cancel'}</Button>}
      </div>
      {taskTitle && <p className="workspace-notes-task-title">{taskTitle}</p>}
      <label htmlFor={`task-notes-text-${tid}`} className="workspace-notes-label">{zh ? '备注内容' : 'Note text'}</label>
      <textarea
        id={`task-notes-text-${tid}`}
        className="workspace-notes-textarea"
        rows={3}
        disabled={d.busy}
        maxLength={20000}
        value={d.text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        placeholder={zh ? '记录进展、问题或结论，可粘贴图片…' : 'Record progress, issues, or conclusions. Paste images…'}
      />
      <div className="workspace-notes-toolbar">
        <label className="workspace-notes-upload">
          <ImagePlus size={14} />
          <span>{zh ? '添加图片' : 'Add images'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={d.busy || d.images.length >= 4} onChange={onFileInput} />
        </label>
        <span className="workspace-notes-count">{zh ? '可粘贴图片 · ' : 'Paste images · '}{d.images.length}/4</span>
      </div>
      {d.images.length > 0 && (
        <div className="workspace-notes-previews">
          {d.images.map((im, i) => (
            <div key={`${im.id ?? 'new'}-${i}-${im.name}`} className="workspace-notes-preview">
              <img src={im.dataUrl ?? (im.url ? apiPath(im.url) : '')} alt={im.name} width={56} height={56} onError={(e) => { e.currentTarget.alt = zh ? '图片无法加载，请刷新重试' : 'Image unavailable. Reload to retry.'; }} />
              <button type="button" onClick={() => removeImage(i)} disabled={d.busy} aria-label={`${zh ? '移除' : 'Remove'} ${im.name}`}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="workspace-notes-actions">
        <Button type="button" onClick={() => void saveNote()} disabled={!canSave}>
          {d.busy ? (zh ? '处理中…' : 'Working…') : d.editing ? (zh ? '保存修改' : 'Save changes') : (zh ? '保存备注' : 'Save note')}
        </Button>
      </div>
      {d.status && <div aria-live="polite" className="workspace-notes-status">{d.status}</div>}
      {d.error && (
        <div role="alert" className="workspace-notes-error">
          {d.error}
          {d.conflict && <Button type="button" onClick={() => void refreshConflict()} disabled={d.busy}>{d.deleteConflict ? (zh ? '刷新备注后重试' : 'Refresh notes and retry') : (zh ? '加载最新版本以合并' : 'Load latest to merge')}</Button>}
        </div>
      )}
      {notesQuery.isLoading && <div role="status" className="workspace-notes-skeleton"><span /><span /><span /></div>}
      {notesQuery.isError && (
        <div role="alert" className="workspace-notes-error">
          {zh ? '备注读取失败' : 'Could not load notes'}
          <Button type="button" onClick={() => void notesQuery.refetch()}>{zh ? '重试' : 'Retry'}</Button>
        </div>
      )}
      {!notesQuery.isLoading && !notesQuery.isError && notes.length === 0 && <p className="workspace-notes-empty">{zh ? '暂无备注' : 'No notes yet'}</p>}
      <ul className="workspace-notes-list">
        {notes.map((n) => (
          <li key={n.id} className="workspace-notes-note">
            <div className="workspace-notes-meta">
              <time dateTime={n.createdAt}>{formatTime(n.createdAt, zh)}</time>
              <div className="workspace-notes-note-actions">
                <button type="button" className="workspace-notes-icon" onClick={() => beginEdit(n)} disabled={d.busy || d.editing !== null || Boolean(d.text.trim()) || d.images.length > 0} aria-label={zh ? '编辑备注' : 'Edit note'}><Pencil size={14} /></button>
                <button type="button" className="workspace-notes-icon" onClick={() => update(tid, (state) => ({ ...state, confirmDelete: n.id }))} disabled={d.busy} aria-label={zh ? '删除备注' : 'Delete note'}><Trash2 size={14} /></button>
              </div>
            </div>
            {n.content && <p className="workspace-notes-content">{n.content}</p>}
            {n.images.length > 0 && (
              <div className="workspace-notes-thumbs">
                {n.images.map((img) => (
                  <button type="button" key={img.id} className="workspace-notes-thumb" onClick={() => setPreview({ url: apiPath(img.url), name: img.name, taskId: tid })} aria-label={`${zh ? '查看' : 'View'} ${img.name}`}>
                    <img src={apiPath(img.url)} alt={img.name} width={72} height={72} onError={(e) => { e.currentTarget.alt = zh ? '图片无法加载，请刷新重试' : 'Image unavailable. Reload to retry.'; }} />
                  </button>
                ))}
              </div>
            )}
            {d.confirmDelete === n.id && (
              <div className="workspace-notes-confirm">
                <span>{zh ? '确认删除？' : 'Delete note?'}</span>
                <Button type="button" onClick={() => update(tid, (state) => ({ ...state, confirmDelete: null }))} disabled={d.busy}>{zh ? '取消' : 'Cancel'}</Button>
                <Button type="button" onClick={() => void removeNote(n)} disabled={d.busy}>{zh ? '确认删除' : 'Delete'}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {notesQuery.hasNextPage && (
        <div className="workspace-notes-more">
          <Button type="button" onClick={() => void notesQuery.fetchNextPage()} disabled={notesQuery.isFetchingNextPage}>
            {notesQuery.isFetchingNextPage ? (zh ? '加载中…' : 'Loading…') : (zh ? '加载更多' : 'Load more')}
          </Button>
        </div>
      )}
      <Dialog key={tid} open={Boolean(preview && preview.taskId === tid)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="workspace-notes-image-dialog">
          <DialogHeader>
            <DialogTitle>{zh ? '备注图片' : 'Note image'}</DialogTitle>
            <DialogDescription className="sr-only">{preview?.name ?? ''}</DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <img src={preview.url} alt={preview.name} className="workspace-notes-dialog-img" onError={(e) => { e.currentTarget.alt = zh ? '图片无法加载，请刷新重试' : 'Image unavailable. Reload to retry.'; }} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
