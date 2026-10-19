(() => {
  const root = document;
  const key = 'fashion-intelligence-workflow-config-v3';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => `x${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const defaultTypes = () => [
    ['event', '时尚热点事件', '高', 1],
    ['release', '新品与系列', '高', 1],
    ['outfit', '穿搭风格', '中', 1],
    ['element', '设计元素', '中', 1],
    ['market', '市场信号', '低', 0]
  ].map(([id, name, priority, enabled]) => ({ id, name, priority, enabled: !!enabled }));

  const seedFor = (typeId) => ({
    tasks: [
      ['event', '定位活动与原始发布'],
      ['event', '筛选现场鞋履素材'],
      ['release', '核对系列与季节'],
      ['release', '补齐款式细节与配色'],
      ['outfit', '识别人物与穿着关系'],
      ['element', '查找跨品牌设计变体'],
      ['market', '核实上架或市场变化']
    ],
    channels: [
      ['event', '品牌公开官网', '品牌官网', '一级'],
      ['event', '时装周主办方', '主办方', '一级'],
      ['release', '品牌公开官网', '品牌官网', '一级'],
      ['release', '公开时尚媒体', '媒体', '二级'],
      ['outfit', '公开街拍与媒体', '媒体', '一级'],
      ['element', '品牌型录与发布页', '品牌官网', '一级'],
      ['market', '公开零售页面', '零售', '一级']
    ],
    checks: ['品牌 / 系列', '事件日期', '原始来源', '鞋履素材核实'],
    criteria: ['开发价值', '风格适配', '新鲜度']
  });

  const defaults = () => {
    const types = defaultTypes();
    const tasks = [], channels = [];
    let ti = 0, ci = 0;
    for (const t of types) {
      const seed = seedFor(t.id);
      for (const [tid, name] of seed.tasks) {
        if (tid !== t.id) continue;
        tasks.push({ id: 't' + (ti++), typeId: t.id, name, enabled: true });
      }
      for (const [tid, name, category, priority] of seed.channels) {
        if (tid !== t.id) continue;
        channels.push({ id: 'c' + (ci++), typeId: t.id, name, category, priority, enabled: true });
      }
    }
    const checks = [], criteria = [];
    let ki = 0, ri = 0;
    for (const t of types) {
      const seed = seedFor(t.id);
      for (const name of seed.checks) checks.push({ id: 'k' + (ki++), typeId: t.id, name, enabled: true });
      for (const name of seed.criteria) criteria.push({ id: 'r' + (ri++), typeId: t.id, name, enabled: true });
    }
    return { types, tasks, channels, checks, criteria, selected: types.find(x => x.enabled)?.id || types[0].id };
  };

  // migrate old shape (global checks/criteria arrays without typeId) → per-type items
  function migrate(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    const types = Array.isArray(raw.types) && raw.types.length ? raw.types : base.types;
    const state = {
      types,
      tasks: [],
      channels: [],
      checks: [],
      criteria: [],
      selected: raw.selected
      ,searches: raw.searches || {}
    };
    const typeIds = new Set(types.map(t => t.id));

    const rel = (arr, seedName) => Array.isArray(arr) ? arr : [];
    // tasks/channels migrate
    for (const item of rel(raw.tasks)) {
      const tid = item.typeId || types[0].id;
      state.tasks.push({ id: item.id || uid(), typeId: typeIds.has(tid) ? tid : types[0].id, name: item.name || '', enabled: item.enabled !== false });
    }
    for (const item of rel(raw.channels)) {
      const tid = item.typeId || types[0].id;
      state.channels.push({
        id: item.id || uid(),
        typeId: typeIds.has(tid) ? tid : types[0].id,
        name: item.name || '',
        category: item.category || '品牌官网',
        priority: item.priority || '一级',
        url: item.url || '',
        enabled: item.enabled !== false
      });
    }
    // checks/criteria: if items lack typeId (old global items), replicate for every type
    const migrateFlat = (arr, bucket) => {
      const list = Array.isArray(arr) ? arr : [];
      const hasGlobal = list.some(x => !x.typeId);
      if (hasGlobal && list.length) {
        const globals = list.filter(x => !x.typeId);
        for (const t of types) {
          for (const g of globals) {
            state[bucket].push({ id: uid(), typeId: t.id, name: g.name || '', enabled: g.enabled !== false });
          }
        }
        // keep typed items
        for (const g of list.filter(x => x.typeId && typeIds.has(x.typeId))) {
          state[bucket].push({ id: g.id || uid(), typeId: g.typeId, name: g.name || '', enabled: g.enabled !== false });
        }
      } else {
        for (const g of list) {
          const tid = g.typeId && typeIds.has(g.typeId) ? g.typeId : types[0].id;
          state[bucket].push({ id: g.id || uid(), typeId: tid, name: g.name || '', enabled: g.enabled !== false });
        }
      }
    };
    migrateFlat(raw.checks, 'checks');
    migrateFlat(raw.criteria, 'criteria');

    // if empty, seed with defaults for those buckets
    if (!state.tasks.length) state.tasks = base.tasks;
    if (!state.channels.length) state.channels = base.channels;
    if (!state.checks.length) state.checks = base.checks;
    if (!state.criteria.length) state.criteria = base.criteria;

    if (!state.selected || !typeIds.has(state.selected)) {
      state.selected = types.find(x => x.enabled)?.id || types[0].id;
    }
    return state;
  }

  let state;
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    state = raw ? migrate(raw) : defaults();
  } catch {
    state = defaults();
  }
  let selected = state.selected;
  const typeOf = () => state.types.find(x => x.id === selected) || state.types[0];

  // ===== styles (keep existing bright liquid glass theme, add layout) =====
  const style = root.createElement('style');
  style.textContent = `
  :root{--glass:rgba(255,255,255,.56);--glass-strong:rgba(255,255,255,.76);--glass-line:rgba(255,255,255,.72);--ink:#172536;--muted:#68788a;--accent:#1e6a78;--accent-pale:#dceff0;--good:#258064}
  body{background:radial-gradient(70rem 42rem at 10% -8%,#d7eaf3 0,transparent 62%),radial-gradient(55rem 35rem at 100% 15%,#e6ddf7 0,transparent 64%),#edf2f4}
  .login{background:linear-gradient(132deg,rgba(220,236,244,.95),rgba(248,250,251,.96) 48%,rgba(229,239,241,.98))}
  .login-art{color:var(--ink)}.login-art h1 span{color:#397b88}.login-copy{color:#587080}
  .login-art:before,.login-art:after{border-color:rgba(43,100,118,.18)}
  .login-panel{background:rgba(255,255,255,.32);backdrop-filter:blur(26px) saturate(1.2)}
  .sidebar{color:var(--ink);background:var(--glass);border-right:1px solid var(--glass-line);backdrop-filter:blur(28px) saturate(1.25);-webkit-backdrop-filter:blur(28px) saturate(1.25)}
  .nav-label{color:#617788}.nav-button{color:#526777}
  .nav-button:hover{color:var(--ink);background:rgba(255,255,255,.58)}
  .nav-button[aria-current=true]{color:var(--ink);background:rgba(255,255,255,.68);box-shadow:0 10px 28px rgba(44,83,103,.12),inset 0 1px rgba(255,255,255,.9)}
  .topbar{background:rgba(246,250,251,.56);border-bottom-color:rgba(86,119,133,.14);backdrop-filter:blur(24px) saturate(1.25)}
  .workspace{background:rgba(255,255,255,.14)}
  .lead-row[aria-expanded=true]{background:rgba(255,255,255,.6)}

  /* workflow layout */
  #flow-view{padding:8px clamp(8px,2vw,18px) 28px}
  .flow-glass{width:100%;max-width:100%;margin:0 auto;padding:clamp(14px,1.6vw,22px);border:1px solid var(--glass-line);border-radius:22px;background:var(--glass);box-shadow:0 24px 58px rgba(66,100,122,.15),inset 0 1px rgba(255,255,255,.86);backdrop-filter:blur(28px) saturate(1.2);-webkit-backdrop-filter:blur(28px) saturate(1.2)}
  .page-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 10px}
  .page-title h2{font-size:22px;letter-spacing:-.03em}
  .wf-body{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;align-items:start}

  /* left type column */
  .type-col{border:1px solid var(--glass-line);border-radius:16px;background:var(--glass-strong);box-shadow:inset 0 1px rgba(255,255,255,.9);padding:12px;display:flex;flex-direction:column;gap:8px}
  .type-col h3{margin:0 0 2px;padding:0 2px 8px;border-bottom:1px solid rgba(77,110,124,.16);color:var(--ink);font-size:15px;letter-spacing:-.02em}
  .type-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;border:1px solid rgba(103,135,148,.22);border-radius:12px;background:rgba(255,255,255,.5);padding:8px 8px}
  .type-item[data-active=true]{border-color:rgba(47,121,133,.5);background:rgba(234,250,250,.85);box-shadow:inset 0 1px rgba(255,255,255,.9)}
  .type-pick{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;background:transparent;border:0;padding:2px;cursor:pointer;color:var(--ink);min-width:0}
  .type-pick .tname{font-weight:700;font-size:13px;white-space:normal;overflow-wrap:anywhere;max-width:100%}
  .type-pick .tmeta{font-size:11px;color:var(--muted)}
  .type-actions{display:flex;flex-direction:column;gap:4px}
  .icon-btn{border:1px solid rgba(103,135,148,.28);background:rgba(255,255,255,.7);color:#425a68;border-radius:8px;font-size:11px;padding:2px 6px;cursor:pointer;line-height:1.4}
  .icon-btn:hover{background:#fff}

  /* board: 4 columns */
  .board{display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:12px;overflow-x:auto;padding-bottom:6px}
  .col{display:flex;flex-direction:column;min-width:240px;border:1px solid var(--glass-line);border-radius:16px;background:rgba(255,255,255,.42);box-shadow:inset 0 1px rgba(255,255,255,.85);padding:12px;gap:10px}
  .col-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid rgba(77,110,124,.16);padding-bottom:8px}
  .col-head h3{font-size:15px;letter-spacing:-.02em}
  .col-head p{font-size:11px;color:var(--muted)}
  .col-list{display:flex;flex-direction:column;gap:8px}
  .row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;border:1px solid rgba(93,125,139,.2);border-radius:10px;background:rgba(255,255,255,.62);padding:6px 6px 6px 8px}
  .row-fields{display:flex;flex-direction:column;gap:4px;min-width:0}
  .row-fields input,.row-fields select{width:100%;min-width:0;height:30px;border:1px solid rgba(93,125,139,.28);border-radius:8px;padding:0 8px;color:var(--ink);background:rgba(255,255,255,.9);font-size:12px}
  .flow-glass .row{grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:12px;align-items:center}
  .flow-glass .row-fields{grid-column:1/-1;width:100%}
  .flow-glass .row>.remove{justify-self:end;min-height:32px;padding:4px 8px}
  .flow-glass .row-fields textarea{box-sizing:border-box;width:100%;min-width:0;min-height:54px;resize:none;overflow:hidden;border:1px solid rgba(93,125,139,.28);border-radius:8px;padding:8px 10px;color:var(--ink);background:rgba(255,255,255,.9);font:inherit;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
  .flow-glass .col-head{flex-wrap:wrap}.flow-glass .col-head p{white-space:normal;overflow-wrap:anywhere}
  .flow-glass .row-fields input,.flow-glass .row-fields select{box-sizing:border-box}
  .flow-glass .row-fields textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .row-fields .inline{display:grid;grid-template-columns:1fr 1fr;gap:4px}
  .row-fields label{font-size:10px;color:var(--muted);letter-spacing:.03em}
  .row-fields .field{display:flex;flex-direction:column;gap:2px}
  .empty{font-size:12px;color:var(--muted);padding:8px 2px}

  /* switch (renamed to avoid clashing with topbar .switch) */
  .workflow-switch{display:flex;align-items:center;justify-content:flex-start;flex:0 0 auto;width:40px;height:22px;border:0;border-radius:99px;background:#b7c3c9;color:transparent;cursor:pointer;padding:3px}
  .workflow-switch:after{display:block;flex:0 0 16px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(19,40,52,.25);content:"";transition:transform .16s}
  .workflow-switch[aria-checked=true]{background:#368b76}
  .workflow-switch[aria-checked=true]:after{transform:translateX(18px)}
  .workflow-switch:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

  .remove{border:0;padding:0 4px;color:#87544e;background:transparent;font-size:11px;cursor:pointer}
  .add-form{display:flex;flex-direction:column;gap:6px;margin-top:auto;padding-top:4px;border-top:1px dashed rgba(77,110,124,.22)}
  .add-form .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .add-form .grid.full{grid-template-columns:1fr}
  .add-form input,.add-form select{min-width:0;height:32px;border:1px solid rgba(93,125,139,.3);border-radius:8px;padding:0 8px;color:var(--ink);background:rgba(255,255,255,.9);font-size:12px}
  .add-form button.primary{height:32px;border:0;border-radius:8px;background:linear-gradient(135deg,#2f7f8d,#1e6a78);color:#fff;font-weight:700;font-size:12px;cursor:pointer}
  .type-add{margin-top:6px;display:grid;grid-template-columns:1fr auto;gap:6px}
  .type-add input{height:32px;border:1px solid rgba(93,125,139,.3);border-radius:8px;padding:0 8px;background:rgba(255,255,255,.9);color:var(--ink);min-width:0}
  .type-add button{height:32px;border:0;border-radius:8px;background:linear-gradient(135deg,#2f7f8d,#1e6a78);color:#fff;font-weight:700;font-size:12px;cursor:pointer;padding:0 10px}

  .save-board{display:flex;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap}
  .save-board button.primary{height:38px;border:0;border-radius:10px;padding:0 18px;background:linear-gradient(135deg,#2f7f8d,#1e6a78);color:#fff;font-weight:700;cursor:pointer}
  .save-status{font-size:12px;font-weight:700}
  .save-status.saved{color:var(--good)}
  .save-status.dirty{color:#a05a2c}
  .save-status.error{color:#b03030}

  @media (max-width: 860px){
    .wf-body{grid-template-columns:minmax(0,1fr)}
    .type-col{flex-direction:row;align-items:center;flex-wrap:nowrap;overflow-x:auto;padding:8px}
    .type-col h3{display:none}
    .type-item{flex:0 0 auto;min-width:160px}
    .type-add{margin-top:0;flex:0 0 auto;grid-template-columns:1fr auto;min-width:200px}
    .board{grid-template-columns:repeat(4,minmax(240px,1fr));overflow-x:auto}
  }
  @media (max-width: 560px){
    #flow-view{padding:6px 8px 20px}
    .flow-glass{padding:12px;border-radius:16px}
    .board{grid-template-columns:repeat(4,minmax(220px,1fr))}
  }
  `;
  root.head.append(style);

  const relation = bucket => bucket === 'tasks' || bucket === 'channels';

  const renderTypeList = () => `
    <aside class="type-col" aria-label="线索类型">
      <h3>线索类型</h3>
      ${state.types.map(t => `
        <div class="type-item" data-active="${t.id === selected}">
          <button class="type-pick" type="button" data-type="${t.id}" aria-pressed="${t.id === selected}">
            <span class="tname">${esc(t.name)}</span>
            <span class="tmeta">优先级 ${esc(t.priority)} · ${t.enabled ? '启用' : '停用'}</span>
          </button>
          <div class="type-actions">
            ${switchControl('types', t)}
            <button class="icon-btn" type="button" data-edit-type="${t.id}" aria-label="编辑类型 ${esc(t.name)}">编辑</button>
            <button class="icon-btn" type="button" data-remove-type="${t.id}" aria-label="移除类型 ${esc(t.name)}">移除</button>
          </div>
        </div>
      `).join('')}
      <form class="type-add" data-form="types">
        <input name="name" required placeholder="新类型名称" aria-label="新线索类型名称">
        <select name="priority" aria-label="新类型优先级">
          <option>高</option><option>中</option><option>低</option>
        </select>
        <button class="primary" type="submit" style="grid-column:1/-1">新增类型</button>
      </form>
    </aside>
  `;

  const switchControl = (bucket, item) => `
    <button class="workflow-switch" type="button" role="switch"
      aria-checked="${item.enabled}"
      aria-label="${item.enabled ? '停用' : '启用'} ${esc(item.name)}"
      data-toggle="${bucket}:${item.id}"></button>
  `;

  const rowTasks = item => `
    <div class="row">
      <div class="row-fields">
        <div class="field">
          <label for="name-${item.id}">任务名称</label>
          <textarea id="name-${item.id}" rows="2" data-field="name" data-bucket="tasks" data-id="${item.id}" aria-label="任务名称">${esc(item.name)}</textarea>
        </div>
      </div>
      ${switchControl('tasks', item)}
      <button class="remove" type="button" data-remove="tasks:${item.id}" aria-label="移除 ${esc(item.name)}">移除</button>
    </div>
  `;

  const rowChannels = item => `
    <div class="row">
      <div class="row-fields">
        <div class="field">
          <label for="name-${item.id}">渠道名称</label>
          <textarea id="name-${item.id}" rows="2" data-field="name" data-bucket="channels" data-id="${item.id}" aria-label="渠道名称">${esc(item.name)}</textarea>
        </div>
        <div class="inline">
          <div class="field">
            <label for="cat-${item.id}">分类</label>
            <select id="cat-${item.id}" data-field="category" data-bucket="channels" data-id="${item.id}" aria-label="渠道分类">
              ${['品牌官网','主办方','媒体','零售','社媒'].map(c => `<option ${c === item.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="pri-${item.id}">优先级</label>
            <select id="pri-${item.id}" data-field="priority" data-bucket="channels" data-id="${item.id}" aria-label="渠道优先级">
              ${['一级','二级','观察'].map(p => `<option ${p === item.priority ? 'selected' : ''}>${esc(p)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="url-${item.id}">URL</label>
          <input id="url-${item.id}" type="url" value="${esc(item.url || '')}" data-field="url" data-bucket="channels" data-id="${item.id}" aria-label="渠道URL" placeholder="https://">
        </div>
      </div>
      ${switchControl('channels', item)}
      <button class="remove" type="button" data-remove="channels:${item.id}" aria-label="移除 ${esc(item.name)}">移除</button>
    </div>
  `;

  const rowFlat = (bucket, label, item) => `
    <div class="row">
      <div class="row-fields">
        <div class="field">
          <label for="name-${item.id}">${label}</label>
          <textarea id="name-${item.id}" rows="2" data-field="name" data-bucket="${bucket}" data-id="${item.id}" aria-label="${label}">${esc(item.name)}</textarea>
        </div>
      </div>
      ${switchControl(bucket, item)}
      <button class="remove" type="button" data-remove="${bucket}:${item.id}" aria-label="移除 ${esc(item.name)}">移除</button>
    </div>
  `;

  const rowsFor = bucket => {
    let list = state[bucket];
    if (relation(bucket) || bucket === 'checks' || bucket === 'criteria') {
      list = list.filter(x => x.typeId === selected);
    }
    if (!list.length) return `<div class="empty">暂无配置</div>`;
    if (bucket === 'tasks') return list.map(rowTasks).join('');
    if (bucket === 'channels') return list.map(rowChannels).join('');
    if (bucket === 'checks') return list.map(x => rowFlat('checks', '核实项', x)).join('');
    if (bucket === 'criteria') return list.map(x => rowFlat('criteria', '评估项', x)).join('');
    return '';
  };

  const formFor = bucket => {
    if (bucket === 'tasks') {
      return `
        <form class="add-form" data-form="tasks">
          <div class="grid full">
            <input name="name" required placeholder="新任务名称" aria-label="新任务名称">
          </div>
          <button class="primary" type="submit">新增任务</button>
        </form>
      `;
    }
    if (bucket === 'channels') {
      return `
        <form class="add-form" data-form="channels">
          <div class="grid full">
            <input name="name" required placeholder="渠道名称" aria-label="新渠道名称">
          </div>
          <div class="grid">
            <select name="category" aria-label="新渠道分类">
              <option>品牌官网</option><option>主办方</option><option>媒体</option>
              <option>零售</option><option>社媒</option>
            </select>
            <select name="priority" aria-label="新渠道优先级">
              <option>一级</option><option>二级</option><option>观察</option>
            </select>
          </div>
          <div class="grid full">
            <input name="url" type="url" placeholder="URL（可选）" aria-label="新渠道URL">
          </div>
          <button class="primary" type="submit">新增渠道</button>
        </form>
      `;
    }
    if (bucket === 'checks') {
      return `
        <form class="add-form" data-form="checks">
          <div class="grid full"><input name="name" required placeholder="新核实项" aria-label="新核实项名称"></div>
          <button class="primary" type="submit">新增核实项</button>
        </form>
      `;
    }
    if (bucket === 'criteria') {
      return `
        <form class="add-form" data-form="criteria">
          <div class="grid full"><input name="name" required placeholder="新评估项" aria-label="新评估项名称"></div>
          <button class="primary" type="submit">新增评估项</button>
        </form>
      `;
    }
    return '';
  };

  const colHeader = (title, hint) => `
    <div class="col-head">
      <h3>${title}</h3>
      <p>${hint}</p>
    </div>
  `;

  // 工作流程只定义每类线索可用的步骤和规则；执行任务始终在任务看板中创建。

  function render() {
    const flow = root.querySelector('#flow-view');
    if (!flow) return;
    const t = typeOf();
    const isNarrow = window.matchMedia('(max-width: 860px)').matches;

    flow.innerHTML = `
      <div class="page-title">
        <h2>线索工作流程</h2>
        <span class="save-status" id="wf-status" aria-live="polite"></span>
      </div>
      <section class="flow-glass">
        <div class="wf-body">
          ${renderTypeList()}
          <div class="board" role="group" aria-label="工作流列">
            <div class="col" role="region" aria-label="查找任务">
              ${colHeader('任务步骤', '当前线索：' + esc(t.name))}
              <div class="col-list">${rowsFor('tasks')}</div>
              ${formFor('tasks')}
            </div>
            <div class="col" role="region" aria-label="渠道获取">
              ${colHeader('渠道获取', '适用于：' + esc(t.name))}
              <div class="col-list">${rowsFor('channels')}</div>
              ${formFor('channels')}
            </div>
            <div class="col" role="region" aria-label="核实与整理">
              ${colHeader('核实与整理', '适用于：' + esc(t.name))}
              <div class="col-list">${rowsFor('checks')}</div>
              ${formFor('checks')}
            </div>
            <div class="col" role="region" aria-label="线索评估">
              ${colHeader('线索评估', '适用于：' + esc(t.name))}
              <div class="col-list">${rowsFor('criteria')}</div>
              ${formFor('criteria')}
            </div>
          </div>
        </div>
        <div class="save-board">
          <button class="primary" type="button" data-save>保存工作流配置</button>
          <span class="save-status" aria-live="polite" id="wf-save-msg"></span>
        </div>
      </section>
    `;

    // selected type chips
    flow.querySelectorAll('[data-type]').forEach(b => {
      b.addEventListener('click', () => {
        selected = b.dataset.type;
        state.selected = selected;
        markDirty();
        render();
      });
    });

    // edit type → inline prompt-like edit (name + priority)
    flow.querySelectorAll('[data-edit-type]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.editType;
        const item = state.types.find(x => x.id === id);
        if (!item) return;
        const name = prompt('类型名称', item.name);
        if (name === null) return;
        const priority = prompt('优先级（高 / 中 / 低）', item.priority);
        if (priority === null) return;
        const trimmed = String(name).trim();
        if (!trimmed) return;
        item.name = trimmed;
        if (['高','中','低'].includes(priority)) item.priority = priority;
        markDirty();
        persistSelection();
        render();
      });
    });

    // remove type (禁止删除最后一个)
    flow.querySelectorAll('[data-remove-type]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.removeType;
        if (state.types.length <= 1) return;
        state.types = state.types.filter(x => x.id !== id);
        for (const bucket of ['tasks', 'channels', 'checks', 'criteria']) {
          state[bucket] = state[bucket].filter(x => x.typeId !== id);
        }
        if (selected === id) {
          selected = state.types[0].id;
          state.selected = selected;
        }
        markDirty();
        persistSelection();
        render();
      });
    });

    // toggles
    flow.querySelectorAll('[data-toggle]').forEach(b => {
      b.addEventListener('click', () => {
        const [bucket, id] = b.dataset.toggle.split(':');
        const item = state[bucket].find(x => x.id === id);
        if (!item) return;
        item.enabled = !item.enabled;
        b.setAttribute('aria-checked', String(item.enabled));
        b.setAttribute('aria-label', `${item.enabled ? '停用' : '启用'} ${item.name}`);
        markDirty();
      });
    });

    // removes
    flow.querySelectorAll('[data-remove]').forEach(b => {
      b.addEventListener('click', () => {
        const [bucket, id] = b.dataset.remove.split(':');
        state[bucket] = state[bucket].filter(x => x.id !== id);
        markDirty();
        render();
      });
    });

    const fitName = field => {
      if (field.tagName !== 'TEXTAREA') return;
      field.style.height = 'auto';
      field.style.height = Math.max(54, field.scrollHeight + 2) + 'px';
    };
    requestAnimationFrame(() => flow.querySelectorAll('textarea[data-field]').forEach(fitName));
    // inline field edits (no re-render on input)
    flow.querySelectorAll('[data-field]').forEach(input => {
      const handler = () => {
        const bucket = input.dataset.bucket;
        const id = input.dataset.id;
        const field = input.dataset.field;
        const item = state[bucket].find(x => x.id === id);
        if (!item) return;
        item[field] = input.value;
        fitName(input);
        markDirty();
      };
      input.addEventListener('input', handler);
      if (input.tagName === 'SELECT') input.addEventListener('change', handler);
    });

    // add forms
    flow.querySelectorAll('form[data-form]').forEach(f => {
      f.addEventListener('submit', e => {
        e.preventDefault();
        const d = new FormData(f);
        const bucket = f.dataset.form;
        const name = String(d.get('name') || '').trim();
        if (!name) return;

        if (bucket === 'types') {
          const item = { id: uid(), name, priority: String(d.get('priority') || '中'), enabled: true };
          state.types.push(item);
          selected = item.id;
          state.selected = selected;
        } else {
          const item = { id: uid(), typeId: selected, name, enabled: true };
          if (bucket === 'channels') {
            item.category = String(d.get('category') || '品牌官网');
            item.priority = String(d.get('priority') || '一级');
            const url = String(d.get('url') || '').trim();
            if (url) item.url = url;
          }
          state[bucket].push(item);
        }
        markDirty();
        persistSelection();
        render();
      });
    });

    // save
    const saveBtn = flow.querySelector('[data-save]');
    const saveMsg = flow.querySelector('#wf-save-msg');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        try {
          localStorage.setItem(key, JSON.stringify(state));
          if (saveMsg) {
            saveMsg.textContent = '已保存';
            saveMsg.className = 'save-status saved';
          }
          dirty = false;
          updateStatus();
        } catch (err) {
          if (saveMsg) {
            saveMsg.textContent = '保存失败：' + (err && err.message ? err.message : '未知错误');
            saveMsg.className = 'save-status error';
          }
        }
      });
    }

    updateStatus();
  }

  let dirty = false;
  function markDirty() {
    dirty = true;
    updateStatus();
  }
  function updateStatus() {
    const el = root.querySelector('#wf-status');
    if (!el) return;
    if (dirty) {
      el.textContent = '待保存';
      el.className = 'save-status dirty';
    } else {
      el.textContent = '';
      el.className = 'save-status';
    }
    const saved = root.querySelector('#wf-save-msg');
    if (saved && saved.classList.contains('saved') && dirty) {
      saved.textContent = '';
      saved.className = 'save-status';
    }
  }
  function persistSelection() {
    state.selected = selected;
  }

  window.addEventListener('resize', () => { /* layout is CSS-driven */ });

  render();
})();
