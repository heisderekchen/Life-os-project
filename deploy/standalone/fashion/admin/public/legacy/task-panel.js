(() => {
  const key = 'fashion-intelligence-search-tasks-v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const write = tasks => localStorage.setItem(key, JSON.stringify(tasks));
  const valid = item => Boolean(item?.title && item?.url && item?.source && item?.publishedAt);
  const date = value => { try { return new Intl.DateTimeFormat('zh-CN', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)); } catch { return value || ''; } };
  const materialRuns = new Set();
  let selected = null;
  let flash = null; // 供任务详情显示一次操作反馈（如未纳入线索时的提示）。

  const style = document.createElement('style');
  style.textContent = `
    #tasks-view{padding:8px clamp(8px,2vw,18px) 28px}.task-create,.task-board,.task-shell{max-width:1400px;margin:0 auto}.task-create{margin-bottom:14px;padding:16px; border:1px solid var(--glass-line);border-radius:18px;background:var(--glass);box-shadow:inset 0 1px rgba(255,255,255,.86);backdrop-filter:blur(28px) saturate(1.2)}.task-create form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:10px;align-items:end}.task-create label{display:grid;gap:5px;color:var(--muted);font-size:12px}.task-create input{width:100%;height:38px;border:1px solid rgba(93,125,139,.28);border-radius:9px;padding:0 10px;background:rgba(255,255,255,.82);color:var(--ink)}.task-create .task-message{grid-column:1/-1;margin:0}.task-board{display:grid;grid-template-columns:repeat(5,minmax(200px,1fr));gap:10px;overflow-x:auto;padding-bottom:14px}.task-stage{min-height:164px;padding:12px;border:1px solid var(--glass-line);border-radius:16px;background:rgba(255,255,255,.43);box-shadow:inset 0 1px rgba(255,255,255,.82)}.task-stage h3{margin:0;padding:0 2px 9px;border-bottom:1px solid rgba(77,110,124,.16);font-size:13px}.task-stage p{margin:9px 2px;color:var(--muted);font-size:12px}.task-card{display:block;width:100%;margin-top:9px;border:1px solid rgba(93,125,139,.2);border-radius:11px;padding:11px;background:rgba(255,255,255,.72);color:var(--ink);text-align:left;cursor:pointer}.task-card[data-selected=true]{border-color:rgba(47,121,133,.6);background:rgba(231,248,248,.88);box-shadow:0 8px 20px rgba(44,83,103,.1)}.task-card strong,.task-card small{display:block}.task-card strong{font-size:13px;line-height:1.35}.task-card small{margin-top:5px;color:var(--muted);font-size:11px}.task-shell{margin-top:2px;padding:clamp(14px,1.6vw,22px);border:1px solid var(--glass-line);border-radius:22px;background:var(--glass);box-shadow:0 24px 58px rgba(66,100,122,.15),inset 0 1px rgba(255,255,255,.86);backdrop-filter:blur(28px) saturate(1.2)}
    .task-rail{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:16px;background:rgba(255,255,255,.55);border:1px solid var(--glass-line)}.task-rail h3{margin:3px 4px 6px;font-size:13px;color:#617788}.task-row{width:100%;border:1px solid rgba(93,125,139,.2);border-radius:12px;background:rgba(255,255,255,.54);padding:11px;text-align:left;color:var(--ink);cursor:pointer}.task-row[data-selected=true]{border-color:rgba(47,121,133,.5);background:rgba(234,250,250,.85)}.task-row strong,.task-row small{display:block}.task-row strong{font-size:13px;line-height:1.4}.task-row small{margin-top:4px;color:var(--muted);font-size:11px}.task-detail{min-width:0}.task-head{display:flex;justify-content:space-between;gap:14px;align-items:start;border-bottom:1px solid rgba(77,110,124,.16);padding:3px 2px 14px}.task-head h3{font-size:22px;letter-spacing:-.03em}.task-head p{margin:5px 0 0;color:var(--muted);font-size:13px}.task-state{padding:5px 9px;border:1px solid rgba(41,128,100,.28);border-radius:999px;color:#25705c;background:rgba(241,250,246,.72);font-size:12px;white-space:nowrap}.task-state.paused{color:#9c632f;border-color:rgba(160,111,50,.28);background:rgba(255,248,236,.72)}
    .task-progress{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:16px 0}.progress-step{min-height:58px;padding:10px;border-radius:10px;background:rgba(255,255,255,.44);border:1px solid rgba(93,125,139,.18);font-size:12px}.progress-step b,.progress-step span{display:block}.progress-step span{margin-top:4px;color:var(--muted);font-size:11px}.progress-step.done{border-color:rgba(47,121,133,.42);background:rgba(235,249,249,.74)}.task-meta,.task-counts{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px}.task-meta{margin:8px 0 16px}.task-counts{margin:0 0 4px}.task-counts span{padding:5px 10px;border:1px solid rgba(93,125,139,.2);border-radius:999px;background:rgba(255,255,255,.6)}.task-counts b{color:var(--ink)}.task-actions{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.task-actions button,.candidate-actions button{min-height:34px;border:1px solid rgba(93,125,139,.28);border-radius:8px;background:rgba(255,255,255,.78);color:var(--ink);padding:0 10px;font-weight:700;cursor:pointer}.task-actions button.primary,.candidate-actions button.primary{background:linear-gradient(135deg,#2f7f8d,#1e6a78);border:0;color:#fff}.task-actions button:disabled,.candidate-actions button:disabled{cursor:not-allowed;opacity:.5}.candidate-list,.materials-output,.leads-output{border-top:1px solid rgba(77,110,124,.16)}.task-candidate{display:grid;grid-template-columns:1fr;gap:10px;padding:13px 2px;border-bottom:1px solid rgba(77,110,124,.14)}.task-candidate strong,.task-candidate small{display:block}.task-candidate strong{font-size:13px;line-height:1.45;overflow-wrap:anywhere}.task-candidate small{margin-top:4px;color:var(--muted);font-size:11px}.task-candidate[data-adopted=true]{background:rgba(236,248,248,.5)}.candidate-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-start}.candidate-actions a{font-size:12px;color:var(--accent);align-self:center}.quality{margin:0 0 14px;padding:11px 12px;border-radius:10px;background:rgba(236,248,248,.72);border:1px solid rgba(47,121,133,.22);font-size:12px;color:#35525c}.quality strong{color:var(--ink)}.materials-output,.leads-output{padding:14px 0}.materials-output h4,.leads-output h4{margin:0 0 10px;font-size:14px}.materials-output h4 span,.leads-output h4 span{font-weight:500;color:var(--muted);font-size:12px}.leads-output ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.leads-output li{border:1px solid rgba(93,125,139,.2);border-radius:10px;background:rgba(255,255,255,.6);padding:10px}.leads-output li strong{display:block;font-size:13px;line-height:1.45}.leads-output li small{display:block;margin-top:4px;color:var(--muted);font-size:11px}.leads-output li a{display:inline-block;margin-top:6px;font-size:12px;color:var(--accent)}.empty-materials{margin:0;color:var(--muted);font-size:12px}.empty-task{padding:36px 8px;color:var(--muted);text-align:center}.task-message{font-size:12px;color:var(--good);margin-left:6px}.task-message.error{color:#aa5047}
    @media(max-width:860px){.task-create form{grid-template-columns:repeat(2,minmax(0,1fr))}.task-create .primary{grid-column:1/-1}.task-board{grid-template-columns:repeat(5,minmax(180px,1fr))}.task-progress{grid-template-columns:repeat(2,minmax(0,1fr))}.task-candidate{grid-template-columns:1fr}.candidate-actions{justify-content:flex-start}}@media(max-width:520px){.task-create form{grid-template-columns:1fr}}`;
  document.head.append(style);
  const extraStyle = document.createElement('style');
  extraStyle.textContent = '.candidate-list h4{margin:12px 0 4px;font-size:14px}.candidate-list h4 span{font-weight:500;color:var(--muted);font-size:12px}.task-card small+small{margin-top:3px}.run-note{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.6);border:1px solid rgba(93,125,139,.2);color:#35525c;font-size:12px;line-height:1.5}.run-note.empty,.run-note.error{border-color:rgba(160,111,50,.32);background:rgba(255,248,236,.72);color:#8a5a25}.run-note.ready{border-color:rgba(47,121,133,.24);background:rgba(236,248,248,.72)}.task-detail .materials-output .finding{display:block;padding:22px 0;border-bottom:0}.task-detail .materials-output .finding>h4{margin:0 0 12px;font-size:15px}.task-detail .materials-output .material-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:0}.task-detail .materials-output .material-card{display:flex;min-width:0;flex-direction:column;overflow:hidden;border:1px solid rgba(93,125,139,.22);border-radius:14px;background:rgba(255,255,255,.72)}.task-detail .materials-output .material-card>img{display:block;width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;background:#edf2f3}.task-detail .materials-output .material-card .photo-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:9px}.task-detail .materials-output .material-card .photo-actions button{min-width:0;min-height:38px;border:1px solid rgba(93,125,139,.26);border-radius:8px;background:rgba(255,255,255,.84);color:var(--ink);font-weight:700}.task-detail .materials-output .material-card details{padding:0 11px 11px;color:var(--muted);font-size:12px}.task-detail .materials-output .material-card summary{display:flex;align-items:center;min-height:36px;color:var(--accent);cursor:pointer}.task-detail .materials-output .material-card p{margin:6px 0 0;overflow-wrap:anywhere}.task-detail .materials-output .material-card a{display:inline-block;margin-top:7px;color:var(--accent);font-size:12px}.task-detail .materials-output .material-empty{grid-column:1/-1;margin:0;padding:18px;border:1px dashed rgba(93,125,139,.32);border-radius:12px;color:var(--muted);font-size:13px;text-align:center}@media(max-width:680px){.task-actions button,.candidate-actions button,.task-card,.task-row{min-height:44px}.task-detail .materials-output .finding{padding:18px 0}.task-detail .materials-output .material-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.task-detail .materials-output .material-card>img{aspect-ratio:1/1.2}.task-detail .materials-output .material-card .photo-actions{grid-template-columns:1fr}.task-detail .materials-output .material-card .photo-actions button{min-height:44px}.task-detail .materials-output .material-card summary{min-height:44px}}';
  document.head.append(extraStyle);

  function ensureView() {
    const flowButton = document.querySelector('.sidebar [data-view="flow"]');
    if (flowButton && !document.querySelector('[data-task-panel]')) {
      const button = document.createElement('button'); button.className = 'nav-button'; button.type = 'button'; button.dataset.taskPanel = 'true'; button.textContent = '任务看板';
      flowButton.after(button);
    }
    const mobileFlow = document.querySelector('.mobile-nav [data-view="flow"]');
    if (mobileFlow && !document.querySelector('.mobile-nav [data-task-panel]')) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.taskPanel = 'true'; button.textContent = '任务'; mobileFlow.after(button);
    }
    if (!document.querySelector('#tasks-view')) {
      const section = document.createElement('section'); section.id = 'tasks-view'; section.hidden = true;
      document.querySelector('.main')?.append(section);
    }
    document.querySelectorAll('[data-task-panel]').forEach(button => button.onclick = show);
  }

  function openTask(id) { selected = id; flash = null; render(); }

  const STAGE_LABELS = { search: '搜索结果', verify: '核实线索', lead: '生成线索', materials: '获取素材', complete: '完成' };
  function stageFor(task) {
    if (task.status === 'complete') return 'complete';
    if (!task.candidates?.length) return 'search';
    if (!task.candidates.some(item => item.review === 'verified')) return 'verify';
    if (!task.candidates.some(item => item.adopted)) return 'lead';
    if (!(task.materials || []).length) return 'materials';
    return 'complete';
  }
  const statusLabel = task => task.status === 'complete' ? '已完成' : task.status === 'paused' ? '已暂停' : '执行中';
  const stageLabel = task => STAGE_LABELS[stageFor(task)] || '搜索结果';

  // 鞋履照片数量与结果说明：没有合格照片时也要明确说出结果，任务不会消失。
  function photoText(task) {
    const count = (task.materials || []).length;
    if (count) return `${count} 张鞋履照片`;
    if (task.materialsOutcome === 'empty') return '无合格鞋履照片';
    if (task.materialsOutcome === 'error') return '照片收集失败';
    if (task.materialsOutcome === 'blocked') return '照片收集未执行';
    return '未收集照片';
  }

  function show() {
    ensureView();
    document.querySelector('#leads-view').hidden = true; document.querySelector('#flow-view').hidden = true; document.querySelector('#tasks-view').hidden = false;
    document.querySelectorAll('[data-view],[data-task-panel],[data-skills-panel]').forEach(button => button.setAttribute('aria-current', 'false'));
    document.querySelectorAll('[data-task-panel]').forEach(button => button.setAttribute('aria-current', 'true'));
    render();
  }

  function progress(task) {
    const total = task.candidates.length, verified = task.candidates.filter(x => x.review === 'verified').length, adopted = task.candidates.filter(x => x.adopted).length, materials = task.materials?.length || 0;
    return [
      ['搜索结果', total > 0, `${total} 条候选`],
      ['核实线索', verified > 0, `${verified} 条通过`],
      ['生成线索', adopted > 0, `${adopted} 条`],
      ['获取素材', materials > 0, `${materials} 张鞋履照片`],
      ['完成', task.status === 'complete', task.status === 'complete' ? '已完成' : '待完成']
    ];
  }

  function render() {
    const view = document.querySelector('#tasks-view'); if (!view || view.hidden) return;
    const tasks = read(); if (!selected || !tasks.some(x => x.id === selected)) selected = tasks[0]?.id || null;
    const task = tasks.find(x => x.id === selected);
    const stages = [['search', '搜索结果'], ['verify', '核实线索'], ['lead', '生成线索'], ['materials', '获取素材'], ['complete', '完成']];
    const board = stages.map(([id, label]) => {
      const rows = tasks.filter(item => stageFor(item) === id);
      const cards = rows.map(item => {
        const verified = item.candidates.filter(value => value.review === 'verified').length;
        const adopted = item.candidates.filter(value => value.adopted).length;
        return `<button class="task-card" type="button" data-task="${esc(item.id)}" data-selected="${item.id === selected}"><strong>${esc(item.subject)}</strong><small>${esc(statusLabel(item))} · ${esc(stageLabel(item))}</small><small>${item.candidates.length} 候选 · ${verified} 已核实 · ${adopted} 线索 · ${esc(photoText(item))}</small></button>`;
      }).join('');
      return `<section class="task-stage"><h3>${label}</h3>${rows.length ? cards : '<p>暂无任务</p>'}</section>`;
    }).join('');
    view.innerHTML = `<div class="page-title"><h2>任务看板</h2></div><section class="task-create"><form data-start-search><label>品牌 / 主题<input name="subject" required placeholder="例如 CHANEL"></label><label>事件关键词<input name="events" value="runway, collection" required></label><label>鞋履关键词<input name="materials" value="shoes, footwear"></label><label>时间范围<input name="period" value="近一个月"></label><button type="submit" class="primary">发起搜索</button><p class="task-message" aria-live="polite"></p></form></section><section class="task-board" aria-label="任务看板">${board}</section><section class="task-shell">${task ? detail(task) : '<div class="empty-task">发起搜索后，任务会按当前阶段进入看板。</div>'}</section>`;
    view.querySelectorAll('[data-task]').forEach(button => button.onclick = () => openTask(button.dataset.task));
    bindStartSearch(view);
    bind(task);
    const materialsHost = view.querySelector('[data-task-materials]');
    if (materialsHost && window.fashionMaterials?.bind) window.fashionMaterials.bind(materialsHost);
  }

  function detail(task) {
    const steps = progress(task), materials = task.materials || [];
    const total = task.candidates.length;
    const verified = task.candidates.filter(item => item.review === 'verified').length;
    const adopted = task.candidates.filter(item => item.adopted).length;
    const leads = task.candidates.filter(item => item.adopted);
    const shoeTerms = (task.shoeTerms || []).length ? task.shoeTerms : ['shoes'];
    const materialBlock = window.fashionMaterials?.section
      ? window.fashionMaterials.section({ heading: `鞋履照片 · ${materials.length} 张`, materials })
      : '<p class="empty-materials">尚未获取鞋履照片。</p>';

    // 运行结果说明：无论有照片、无合格照片、失败还是未执行，都明确写出结果。
    const collecting = materialRuns.has(task.id);
    const outcome = collecting ? 'running' : task.materialsOutcome;
    const materialAction = collecting ? '正在获取…' : outcome === 'error' ? '重试获取照片' : '获取鞋履照片';
    const retained = materials.length ? `上次获取的 ${materials.length} 张照片仍保留在下方。` : '';
    const sourceNote = task.materialsSource ? `来源：${esc(task.materialsSource)}。${task.materialsSource === 'Wikimedia Commons' ? '备用公共图库含历史素材，请在原始来源核对拍摄时间。' : ''}` : '';
    const queryNote = task.materialsRequestedQuery && task.materialsQuery !== task.materialsRequestedQuery
      ? `首次检索未获取照片，已自动改用「${esc(task.materialsQuery)}」重试。` : '';
    const eventOutcome = task.searchOutcome || (total ? 'ready' : 'pending');
    const keywords = esc(shoeTerms.join('、'));
    const rejection = task.materialsQuality?.rejected || {};
    const rejectedTotal = Object.values(rejection).reduce((total, value) => total + (Number(value) || 0), 0);
    const emptyReason = rejectedTotal
      ? `公开结果中有 ${rejectedTotal} 项未通过鞋履准入（标题未明确鞋履、人体局部／穿搭图、来源不合格或重复）。`
      : '公开搜索没有返回可核实的图片结果。';
    const runNote = collecting
      ? `正在搜索鞋履照片，图片来源不可用时会自动切换备用来源。${retained}`
      : eventOutcome === 'error'
      ? `事件搜索失败：${esc(task.searchMessage || '公开事件搜索暂时不可用。')} 任务已保留，可点击“重试事件搜索”。`
      : outcome === 'empty'
      ? `已用鞋履关键词「${keywords}」检索公开照片，未找到符合「鞋履主体清楚可辨」要求的素材。${emptyReason}当前任务保留，可调整鞋履关键词后重试。`
      : outcome === 'error'
        ? `本次鞋履照片收集失败：${esc(task.materialsMessage || '请稍后重试。')}${retained}可点击“重试获取照片”。`
        : outcome === 'blocked'
          ? `鞋履照片收集未执行：${esc(task.materialsMessage || '请在「技能管理」启用“鞋履照片情报”。')}`
          : outcome === 'ready'
            ? `已用鞋履关键词「${keywords}」收集 ${materials.length} 张合格鞋履照片。${queryNote}${sourceNote}`
            : '尚未收集鞋履照片，点击「获取鞋履照片」后会带上鞋履关键词发起公开图片检索。';
    const note = flash && flash.id === task.id ? `<span class="task-message ${flash.error ? 'error' : ''}" aria-live="polite">${esc(flash.text)}</span>` : '<span class="task-message" aria-live="polite"></span>';

    const candidates = total ? task.candidates.map((item, index) => `<article class="task-candidate" data-adopted="${Boolean(item.adopted)}"><div><strong>${esc(item.title)}</strong><small>${esc(item.source)}${item.publishedAt ? ' · ' + esc(date(item.publishedAt)) : ''}</small></div><div class="candidate-actions"><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">查看来源</a><button type="button" data-candidate-action="verify" data-index="${index}" ${item.review === 'verified' ? 'disabled' : ''}>${item.review === 'verified' ? '已核实' : '核实通过'}</button><button type="button" data-candidate-action="adopt" data-index="${index}" ${item.adopted || item.review !== 'verified' ? 'disabled' : ''}>${item.adopted ? '已生成线索' : item.review === 'verified' ? '生成线索' : '先核实'}</button></div></article>`).join('') : '<p class="empty-materials">本次搜索没有返回可核实的候选事件，请调整关键词后重新发起。</p>';
    const leadList = leads.length ? `<ul>${leads.map(item => `<li><strong>${esc(item.title)}</strong><small>${esc(item.source)}${item.publishedAt ? ' · ' + esc(date(item.publishedAt)) : ''}</small><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">查看原始来源</a></li>`).join('')}</ul>` : '<p class="empty-materials">核实候选后点击「生成线索」，生成的线索会显示在这里并进入线索评估。</p>';

    return `<section class="task-detail">
      <header class="task-head"><div><h3>${esc(task.subject)}</h3><p>${esc(task.events.join('、'))} · ${adopted} 条已生成线索</p></div><span class="task-state ${task.status}">${statusLabel(task)}</span></header>
      <div class="task-meta"><span>创建于 ${esc(date(task.createdAt))}</span><span>当前阶段：${esc(stageLabel(task))}</span><span>事件关键词：${esc(task.events.join('、')) || '—'}</span><span>鞋履关键词：${keywords}</span><span>事件检索式：${esc(task.query) || '—'}</span></div>
      <div class="task-counts"><span>候选结果 <b>${total}</b></span><span>已核实 <b>${verified}</b></span><span>已生成线索 <b>${adopted}</b></span><span>鞋履照片 <b>${materials.length}</b></span></div>
      <div class="task-progress">${steps.map(([name, done, label]) => `<div class="progress-step ${done ? 'done' : ''}"><b>${esc(name)}</b><span>${esc(label)}</span></div>`).join('')}</div>
      <p class="run-note ${esc(outcome || '')}" role="status" aria-live="polite" aria-busy="${collecting}">${runNote}</p>
      <div class="quality"><strong>线索准入要求</strong>：标题、来源、发布日期、原始链接齐全，且必须先核实再生成线索。当前 ${task.candidates.filter(valid).length}/${total} 条信息完整。</div>
      <div class="task-actions">${eventOutcome === 'error' ? '<button type="button" class="primary" data-task-action="retry-search">重试事件搜索</button>' : `<button type="button" class="primary" data-task-action="materials" ${eventOutcome === 'running' || collecting ? 'disabled' : ''}>${materialAction}</button>`}<button type="button" data-task-action="pause">${task.status === 'paused' ? '继续任务' : '暂停任务'}</button><button type="button" data-task-action="complete">完成任务</button>${note}</div>
      <section class="candidate-list"><h4>本轮候选结果 <span>${total} 条</span></h4>${candidates}</section>
      <section class="leads-output"><h4>生成的线索 <span>${adopted} 条</span></h4>${leadList}</section>
      <section class="materials-output" data-task-materials>${materialBlock}</section>
    </section>`;
  }

  function bindStartSearch(view) {
    const form = view.querySelector('[data-start-search]'); if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const message = form.querySelector('.task-message');
      const button = form.querySelector('button[type="submit"]');
      const terms = value => String(value || '').split(/[,，\n]+/).map(item => item.trim()).filter(Boolean);
      const subject = String(data.subject || '').trim();
      const events = terms(data.events);
      const shoeTerms = terms(data.materials);
      const id = `search-${Date.now()}`;
      button.disabled = true; button.textContent = '搜索中…';
      message.className = 'task-message'; message.textContent = '正在查找公开事件，随后收集鞋履照片…';
      window.dispatchEvent(new CustomEvent('fashion:search-started', { detail: { id, subject, events, shoeTerms, period: data.period } }));
      try {
        const response = await fetch('/api/search/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, events, exclude: [], period: data.period, channels: [] }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || '搜索失败。');
        // 三个输入（品牌/主题、事件关键词、鞋履关键词）一起进入执行。
        window.dispatchEvent(new CustomEvent('fashion:search-complete', { detail: { id, subject, events, shoeTerms, query: result.query || '', candidates: result.candidates || [] } }));
        render();
        await collectMaterials(id, { subject, events, shoeTerms });
        message.textContent = `已发起搜索：${(result.candidates || []).length} 条候选事件，鞋履照片收集已执行。`;
      } catch (error) {
        window.dispatchEvent(new CustomEvent('fashion:search-failed', { detail: { id, message: error.message || '搜索失败。' } }));
        message.textContent = error.message || '搜索失败。'; message.className = 'task-message error';
      } finally { button.disabled = false; button.textContent = '发起搜索'; }
    });
  }

  // 带上品牌/主题与鞋履关键词，调用公开图片检索；把结果写回任务状态。
  async function collectMaterials(taskId, { subject, events = [], shoeTerms = [] } = {}) {
    const tasks = read(), task = tasks.find(x => x.id === taskId); if (!task) return;
    if (materialRuns.has(taskId)) return;
    if (!window.fashionSkills?.isEnabled('shoe-photo-intelligence')) {
      updateById(taskId, item => { item.materialsOutcome = 'blocked'; item.materialsMessage = '请先在「技能管理」启用“鞋履照片情报”。'; });
      return;
    }
    const payload = { subject: subject || task.subject, materials: shoeTerms.length ? shoeTerms : (task.shoeTerms || []), events: events.length ? events : (task.events || []) };
    materialRuns.add(taskId);
    render();
    try {
      const response = await fetch('/api/search/materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '素材获取失败。');
      const materials = Array.isArray(result.materials) ? result.materials : [];
      updateById(taskId, item => {
        item.materials = materials;
        item.materialsOutcome = materials.length ? 'ready' : 'empty';
        item.materialsQuery = result.query || '';
        item.materialsSource = result.searchSource || '';
        item.materialsRequestedQuery = result.requestedQuery || '';
        item.materialsTerms = Array.isArray(result.terms) ? result.terms : payload.materials;
        item.materialsQuality = result.quality || null;
        item.materialsMessage = '';
        item.materialsCheckedAt = new Date().toISOString();
        window.dispatchEvent(new CustomEvent('fashion:materials-ready', { detail: { taskId: item.id, materials, candidateUrls: item.candidates.map(candidate => candidate.url) } }));
      });
    } catch (error) {
      updateById(taskId, item => { item.materialsOutcome = 'error'; item.materialsMessage = error.message || '素材获取失败。'; });
    } finally {
      materialRuns.delete(taskId);
      render();
    }
  }

  function updateById(id, mutate) {
    const tasks = read(), item = tasks.find(x => x.id === id); if (!item) return;
    mutate(item); write(tasks);
    const view = document.querySelector('#tasks-view'); if (view && !view.hidden) render();
  }
  function update(task, mutate) { updateById(task.id, mutate); }

  function bind(task) {
    const view = document.querySelector('#tasks-view'); if (!task || !view) return;
    view.querySelector('[data-task-action="pause"]')?.addEventListener('click', () => update(task, item => { item.status = item.status === 'paused' ? 'active' : 'paused'; }));
    view.querySelector('[data-task-action="retry-search"]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = '正在重试…';
      update(task, item => { item.searchOutcome = 'running'; item.searchMessage = ''; item.materialsOutcome = 'pending'; item.materialsMessage = ''; });
      try {
        const response = await fetch('/api/search/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: task.subject, events: task.events, exclude: [], period: task.period || '', channels: [] }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || '搜索失败。');
        window.dispatchEvent(new CustomEvent('fashion:search-complete', { detail: { id: task.id, subject: task.subject, events: task.events, shoeTerms: task.shoeTerms, query: result.query || '', candidates: result.candidates || [] } }));
        await collectMaterials(task.id, { subject: task.subject, events: task.events, shoeTerms: task.shoeTerms });
      } catch (error) {
        window.dispatchEvent(new CustomEvent('fashion:search-failed', { detail: { id: task.id, message: error.message || '搜索失败。' } }));
      }
    });
    view.querySelector('[data-task-action="materials"]')?.addEventListener('click', event => {
      collectMaterials(task.id, { subject: task.subject, events: task.events, shoeTerms: task.shoeTerms });
    });
    view.querySelector('[data-task-action="complete"]')?.addEventListener('click', () => {
      if (!task.candidates.some(x => x.adopted)) { flash = { id: task.id, text: '请至少纳入一条待核实线索后再完成任务。', error: true }; render(); return; }
      update(task, item => { item.status = 'complete'; item.completedAt = new Date().toISOString(); });
    });
    view.querySelectorAll('[data-candidate-action]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.index), action = button.dataset.candidateAction;
      update(task, item => {
        const candidate = item.candidates[index]; if (!candidate) return;
        if (action === 'verify') candidate.review = 'verified';
        if (action === 'adopt' && candidate.review === 'verified') { candidate.adopted = true; window.dispatchEvent(new CustomEvent('fashion:adopt-candidate', { detail: { ...candidate, taskId: item.id, materials: item.materials || [] } })); }
      });
    }));
  }

  window.addEventListener('fashion:search-started', event => {
    const payload = event.detail; if (!payload?.id || !payload?.subject) return;
    const tasks = read();
    tasks.unshift({ id: payload.id, subject: payload.subject, events: payload.events || [], shoeTerms: payload.shoeTerms || [], period: payload.period || '', query: '', createdAt: new Date().toISOString(), status: 'active', materials: [], materialsOutcome: 'pending', searchOutcome: 'running', candidates: [] });
    write(tasks); selected = payload.id; flash = null;
    if (!document.querySelector('#tasks-view')?.hidden) render();
  });
  window.addEventListener('fashion:search-complete', event => {
    const payload = event.detail; if (!payload?.subject || !Array.isArray(payload.candidates)) return;
    const tasks = read();
    const task = tasks.find(item => item.id === payload.id); if (!task) return;
    task.query = payload.query || ''; task.searchOutcome = payload.candidates.length ? 'ready' : 'empty';
    task.candidates = payload.candidates.filter(valid).map(item => ({ ...item, review: 'pending', adopted: false }));
    write(tasks); selected = task.id; flash = null;
    if (!document.querySelector('#tasks-view')?.hidden) render();
  });
  window.addEventListener('fashion:search-failed', event => {
    const payload = event.detail; if (!payload?.id) return;
    updateById(payload.id, item => { item.searchOutcome = 'error'; item.searchMessage = payload.message || '公开事件搜索失败。'; item.materialsOutcome = 'blocked'; item.materialsMessage = '需先完成事件搜索。'; });
  });
  window.addEventListener('fashion:adopt-candidate', event => {
    const taskId = event.detail?.taskId; if (!taskId) return;
    const tasks = read(), task = tasks.find(x => x.id === taskId), candidate = task?.candidates.find(x => x.url === event.detail.url);
    if (candidate && !candidate.adopted) { candidate.adopted = true; write(tasks); }
  });
  window.addEventListener('fashion:material-invalid', event => {
    const id = event.detail?.id; if (!id) return;
    const tasks = read(); let changed = false;
    tasks.forEach(task => {
      const before = task.materials?.length || 0;
      task.materials = (task.materials || []).filter(material => material.id !== id);
      if (task.materials.length !== before) {
        changed = true;
        if (!task.materials.length && task.materialsOutcome === 'ready') {
          task.materialsOutcome = 'error';
          task.materialsMessage = '搜索结果的图片无法从原始来源加载，请重试。';
        }
      }
    });
    if (changed) {
      write(tasks);
      if (!document.querySelector('#tasks-view')?.hidden) requestAnimationFrame(render);
    }
  });
  document.addEventListener('click', event => { if (event.target.closest('[data-view],[data-skills-panel]')) { document.querySelector('#tasks-view')?.setAttribute('hidden', ''); document.querySelectorAll('[data-task-panel]').forEach(button => button.setAttribute('aria-current', 'false')); } });
  ensureView();
})();
