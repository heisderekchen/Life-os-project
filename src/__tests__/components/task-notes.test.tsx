import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskNotes } from '@/components/lifeos/projects/task-notes'
const api = vi.hoisted(() => ({ apiGet:vi.fn(), apiPost:vi.fn(), apiPatch:vi.fn(), apiDelete:vi.fn(), apiPath:(path:string)=>path }))
vi.mock('@/lib/api/client',()=>api)
const note = {id:'note-a',taskId:'a',content:'existing note',images:[],revision:1,createdAt:'2026-10-20T08:00:00Z',updatedAt:'2026-10-20T08:00:00Z'}
function setup(initial = 'a', notes: unknown[] = [], loadError = false) {
 api.apiGet.mockReset().mockResolvedValue({notes,nextCursor:null});if(loadError) api.apiGet.mockRejectedValueOnce(new Error('load failure'));api.apiPost.mockReset().mockResolvedValue(note);api.apiPatch.mockReset().mockResolvedValue(note);api.apiDelete.mockReset().mockResolvedValue(undefined)
 const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
 const view=(id:string|null)=><QueryClientProvider client={client}><TaskNotes taskId={id} zh /></QueryClientProvider>
 const result=render(view(initial));return {...result,select:(id:string|null)=>result.rerender(view(id))}
}
afterEach(cleanup)
describe('task image notes',()=>{
 it('isolates and preserves per-task drafts through selection and idle states',async()=>{
  const app=setup();const user=userEvent.setup();const text=screen.getByRole('textbox',{name:'备注内容'})
  await user.type(text,'draft A');app.select('b');expect(screen.getByRole('textbox')).toHaveValue('');await user.type(screen.getByRole('textbox'),'draft B')
  app.select(null);expect(screen.queryByRole('textbox')).not.toBeInTheDocument();app.select('a');expect(screen.getByRole('textbox')).toHaveValue('draft A')
  app.select('b');expect(screen.getByRole('textbox')).toHaveValue('draft B')
 })
 it('keeps a failed save draft and routes delayed success to its original task',async()=>{
  const app=setup();const user=userEvent.setup();await user.type(screen.getByRole('textbox'),'first draft')
  api.apiPost.mockRejectedValueOnce(new Error('offline'));await user.click(screen.getByRole('button',{name:'保存备注'}));await screen.findByRole('alert');expect(screen.getByRole('textbox')).toHaveValue('first draft')
  let resolve!:(value:unknown)=>void;api.apiPost.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
  await user.click(screen.getByRole('button',{name:'保存备注'}));expect(screen.getByRole('textbox')).toBeDisabled();app.select('b');await user.type(screen.getByRole('textbox'),'new task draft');resolve(note)
  await waitFor(()=>expect(api.apiPost).toHaveBeenCalledTimes(2));expect(screen.getByRole('textbox')).toHaveValue('new task draft');app.select('a');await waitFor(()=>expect(screen.getByRole('textbox')).toHaveValue(''))
  expect(api.apiPost).toHaveBeenLastCalledWith('/api/tasks/a/notes',{content:'first draft',images:[]})
 })
 it('renders text safely, edits with revision, and requires delete confirmation',async()=>{
  setup('a',[{...note,content:'<img src=x onerror=alert(1)>'}])
  const user=userEvent.setup();await screen.findByText('<img src=x onerror=alert(1)>');expect(document.querySelector('img[src=x]')).toBeNull()
  await user.click(screen.getByRole('button',{name:'编辑备注'}));expect(screen.getByRole('textbox')).toHaveValue('<img src=x onerror=alert(1)>')
  await user.clear(screen.getByRole('textbox'));await user.type(screen.getByRole('textbox'),'edited');await user.click(screen.getByRole('button',{name:'保存修改'}));await waitFor(()=>expect(api.apiPatch).toHaveBeenCalledWith('/api/tasks/a/notes/note-a',{content:'edited',images:[],expectedRevision:1}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'保存备注'})).toBeDisabled())
  await user.click(screen.getByRole('button',{name:'删除备注'}));expect(api.apiDelete).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'确认删除'}));await waitFor(()=>expect(api.apiDelete).toHaveBeenCalledWith('/api/tasks/a/notes/note-a?revision=1'))
 })
 it('retains draft on conflict and refreshes revision only for an explicit merge',async()=>{
  setup('a',[note]);const user=userEvent.setup();await screen.findByText('existing note');await user.click(screen.getByRole('button',{name:'编辑备注'}));await user.type(screen.getByRole('textbox'),' draft')
  api.apiPatch.mockRejectedValueOnce(new Error('备注版本冲突，请刷新'))
  await user.click(screen.getByRole('button',{name:'保存修改'}));await screen.findByRole('alert');expect(screen.getByRole('textbox')).toHaveValue('existing note draft')
  api.apiGet.mockImplementation((path:string)=>Promise.resolve(path.endsWith('/note-a') ? {...note,revision:2,content:'remote edit'} : {notes:[{...note,revision:2,content:'remote edit'}],nextCursor:null}));await user.click(screen.getByRole('button',{name:'加载最新版本以合并'}));await screen.findByText('remote edit');expect(screen.getByRole('textbox')).toHaveValue('existing note draft')
  await user.click(screen.getByRole('button',{name:'保存修改'}));await waitFor(()=>expect(api.apiPatch).toHaveBeenLastCalledWith('/api/tasks/a/notes/note-a',{content:'existing note draft',images:[],expectedRevision:2}))
 })
 it('keeps conflict state and draft if loading the latest version fails',async()=>{
  setup('a',[note]);const user=userEvent.setup();await screen.findByText('existing note');await user.click(screen.getByRole('button',{name:'编辑备注'}));await user.type(screen.getByRole('textbox'),' draft');api.apiPatch.mockRejectedValueOnce(new Error('备注版本冲突'));await user.click(screen.getByRole('button',{name:'保存修改'}));await screen.findByRole('alert');api.apiGet.mockRejectedValueOnce(new Error('latest unavailable'));await user.click(screen.getByRole('button',{name:'加载最新版本以合并'}));await screen.findByText('latest unavailable');expect(screen.getByRole('textbox')).toHaveValue('existing note draft');expect(screen.queryByText(/已加载最新版本/)).not.toBeInTheDocument()
 })
 it('refreshes a deletion conflict, keeps the unrelated draft, and requires a new confirmation',async()=>{
  setup('a',[note]);const user=userEvent.setup();await screen.findByText('existing note');await user.type(screen.getByRole('textbox'),'unsaved compose draft');api.apiDelete.mockRejectedValueOnce(new Error('备注版本冲突'));await user.click(screen.getByRole('button',{name:'删除备注'}));await user.click(screen.getByRole('button',{name:'确认删除'}));await screen.findByRole('alert');api.apiGet.mockResolvedValue({notes:[{...note,revision:2,content:'new remote content'}],nextCursor:null});await user.click(screen.getByRole('button',{name:'刷新备注后重试'}));await screen.findByText('new remote content');expect(screen.getByRole('textbox')).toHaveValue('unsaved compose draft');expect(screen.queryByRole('button',{name:'确认删除'})).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'删除备注'}));await user.click(screen.getByRole('button',{name:'确认删除'}));await waitFor(()=>expect(api.apiDelete).toHaveBeenLastCalledWith('/api/tasks/a/notes/note-a?revision=2'));expect(screen.getByRole('textbox')).toHaveValue('unsaved compose draft')
 })
 it('shows load errors with retry rather than a misleading empty state',async()=>{
  setup('a',[],true);await screen.findByText('备注读取失败');expect(screen.queryByText('暂无备注')).not.toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('暂无备注')
 })
 it('retains attachment IDs during edit and exposes an accessible image preview',async()=>{
  setup('a',[{...note,images:[{id:'img-a',name:'diagram.png',mime:'image/png',url:'/api/tasks/a/notes/note-a/images/img-a'}]}]);const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'查看 diagram.png'}));expect(within(screen.getByRole('dialog')).getByRole('img',{name:'diagram.png'})).toBeInTheDocument();await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button',{name:'编辑备注'}));await user.click(screen.getByRole('button',{name:'保存修改'}));await waitFor(()=>expect(api.apiPatch).toHaveBeenCalledWith('/api/tasks/a/notes/note-a',{content:note.content,images:[{id:'img-a'}],expectedRevision:1}))
 })
 it('rejects unsupported file uploads and does not submit an empty note',async()=>{
  setup();expect(screen.getByRole('button',{name:'保存备注'})).toBeDisabled();const input=document.querySelector('input[type=file]')!
  fireEvent.change(input,{target:{files:[new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})]}});await screen.findByRole('alert');expect(api.apiPost).not.toHaveBeenCalled();expect(screen.queryByRole('img')).not.toBeInTheDocument()
 })
})
