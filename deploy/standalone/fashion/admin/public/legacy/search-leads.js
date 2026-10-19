(() => {
  const key = 'fashion-intelligence-candidate-leads-v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const write = items => localStorage.setItem(key, JSON.stringify(items));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => { try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)); } catch { return value || ''; } };

  const reviewKey = 'fashion-intelligence-photo-reviews-v1';
  let openCandidate = null;
  const reviews = () => { try { return JSON.parse(localStorage.getItem(reviewKey)) || {}; } catch { return {}; } };
  const saveReview = (id, value) => { const all = reviews(); all[id] = value; localStorage.setItem(reviewKey, JSON.stringify(all)); };
  const style = document.createElement('style');
style.textContent = `.candidate-detail .lead-header,.lead-detail[data-photo-template=true] .lead-header{padding-bottom:14px}.candidate-detail .lead-header h3,.lead-detail[data-photo-template=true] .lead-header h3{font-size:20px;letter-spacing:-.035em}.candidate-detail .facts,.lead-detail[data-photo-template=true] .facts{display:none}.candidate-detail .material-list,.lead-detail[data-photo-template=true] .material-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}.candidate-detail .material-card,.lead-detail[data-photo-template=true] .material-card{overflow:hidden;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.6)}.candidate-detail .material-card img,.lead-detail[data-photo-template=true] .material-card img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:#eef3f5}.candidate-detail .photo-actions,.lead-detail[data-photo-template=true] .photo-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:9px}.candidate-detail .photo-actions button,.lead-detail[data-photo-template=true] .photo-actions button{min-height:36px;border:1px solid rgba(93,125,139,.26);border-radius:8px;background:rgba(255,255,255,.78);font-weight:700;color:var(--ink);cursor:pointer}.candidate-detail .photo-actions button[aria-pressed=true],.lead-detail[data-photo-template=true] .photo-actions button[aria-pressed=true]{border-color:#2f7f8d;background:#e6f5f4;color:#176271}.candidate-detail .material-card details,.lead-detail[data-photo-template=true] .material-card details{padding:0 11px 11px;color:var(--muted);font-size:11px}.candidate-detail .material-card summary,.lead-detail[data-photo-template=true] .material-card summary{cursor:pointer;color:var(--accent);font-size:12px}.candidate-detail .material-card p,.lead-detail[data-photo-template=true] .material-card p{margin:7px 0 0;line-height:1.45}.candidate-detail .material-card a,.lead-detail[data-photo-template=true] .material-card a{display:inline-block;margin-top:7px;color:var(--accent);font-size:12px}.mobile-lead-back{display:none}@media(max-width:680px){.lead-layout.mobile-detail-open .lead-rail{display:none}.lead-layout.mobile-detail-open #lead-detail{margin-top:0}.mobile-lead-back{display:inline-flex;align-items:center;min-height:44px;margin:0 0 14px;border:0;padding:0 4px;color:var(--accent);background:transparent;font-weight:700}.candidate-detail .material-list,.lead-detail[data-photo-template=true] .material-list{grid-template-columns:repeat(2,minmax(0,1fr))}.candidate-detail .photo-actions,.lead-detail[data-photo-template=true] .photo-actions{grid-template-columns:1fr}.candidate-detail .photo-actions button,.lead-detail[data-photo-template=true] .photo-actions button{min-height:44px}.candidate-detail .material-card summary,.lead-detail[data-photo-template=true] .material-card summary{display:flex;align-items:center;min-height:44px}.candidate-detail .material-card img,.lead-detail[data-photo-template=true] .material-card img{aspect-ratio:1/1.25}}`;
  document.head.append(style);

  // 线索评估是“导航 + 详情”的操作界面：左侧负责切换线索，右侧专注当前线索。
  // 覆盖旧的散列列表样式，避免两个区域在同一层级上争夺注意力。
  const workspaceStyle = document.createElement('style');
  workspaceStyle.textContent = `
    #leads-view .lead-layout{grid-template-columns:minmax(286px,330px) minmax(0,1fr);gap:28px;align-items:start}
    #leads-view .lead-rail{position:sticky;top:100px;overflow:hidden;border:1px solid var(--glass-line);border-radius:20px;padding:14px;background:linear-gradient(145deg,rgba(255,255,255,.82),rgba(244,250,250,.62));box-shadow:0 18px 42px rgba(63,94,111,.10),inset 0 1px rgba(255,255,255,.92)}
    #leads-view .lead-rail-head{min-height:42px;padding:0 4px 12px;border-bottom:1px solid rgba(77,110,124,.18)}
    #leads-view .lead-rail-head h3{font-size:15px;letter-spacing:-.02em}
    #leads-view .lead-total{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:24px;border-radius:8px;background:rgba(47,121,133,.11);color:#276e7b;font-size:12px;font-weight:750}
    #leads-view #lead-list{display:grid;gap:7px;padding-top:10px}
    #leads-view .lead-row{min-height:0;margin:0;border:1px solid transparent;border-radius:13px;padding:15px 36px 15px 13px;background:transparent;transition:border-color .18s ease,background .18s ease,transform .18s ease,box-shadow .18s ease}
    #leads-view .lead-row:after{top:calc(50% - 4px);right:16px;border-color:#8295a0}
    #leads-view .lead-row:hover{border-color:rgba(47,121,133,.2);background:rgba(255,255,255,.72);transform:translateY(-1px)}
    #leads-view .lead-row:hover strong{color:var(--ink)}
    #leads-view .lead-row[aria-expanded=true]{border-color:rgba(47,121,133,.38);background:linear-gradient(135deg,rgba(227,248,248,.92),rgba(255,255,255,.78));box-shadow:0 10px 22px rgba(47,121,133,.10)}
    #leads-view .lead-row[aria-expanded=true]:after{top:calc(50% - 6px);right:16px;border-color:#1f7782}
    #leads-view .lead-row strong{font-size:15px;line-height:1.42;letter-spacing:-.018em}
    #leads-view .lead-row[aria-expanded=true] strong{color:#176f79}
    #leads-view .lead-row small,#leads-view .lead-source{display:block;margin-top:5px;color:#627887;font-size:12px;line-height:1.45}
    #leads-view .lead-type{margin-top:9px;color:#8d5c4d;font-size:11px;font-weight:750;letter-spacing:.015em}
    #leads-view .lead-detail{overflow:hidden;border:1px solid var(--glass-line);border-top:1px solid var(--glass-line);border-radius:20px;padding:0 clamp(18px,2.4vw,32px) 28px;background:rgba(255,255,255,.64);box-shadow:0 20px 52px rgba(63,94,111,.10),inset 0 1px rgba(255,255,255,.92)}
    #leads-view .lead-detail:before{display:none}
    #leads-view .lead-header{padding:25px 0 22px}
    #leads-view .lead-header h3{font-size:30px;line-height:1.16;letter-spacing:-.045em}
    #leads-view .lead-header .eyebrow{display:none}
    #leads-view .lead-header p{font-size:13px}
    #leads-view .finding{grid-template-columns:132px minmax(0,1fr);gap:18px;padding:22px 0}
    #leads-view .finding h4{font-size:13px;letter-spacing:.01em}
    #leads-view .finding p{font-size:15px;line-height:1.65}
    #leads-view .sources{gap:16px;margin-top:13px}
    @media(max-width:900px){#leads-view .lead-layout{grid-template-columns:minmax(230px,280px) minmax(0,1fr);gap:20px}#leads-view .lead-detail{padding-inline:22px}}
    @media(max-width:680px){#leads-view .lead-layout{display:block}#leads-view .lead-rail{position:static;border-radius:16px;padding:10px}#leads-view .lead-detail{border-radius:16px;padding:0 16px 20px}#leads-view .lead-header h3{font-size:25px}#leads-view .finding{display:block;padding:18px 0}#leads-view .finding h4{margin-bottom:9px}#leads-view .lead-row{min-height:64px;padding:13px 34px 13px 12px}}
  `;
  document.head.append(workspaceStyle);

  // 统一的素材卡片模板：Miu Miu 与所有生成的线索共用同一张卡片。
  // 结构固定为：照片 → 每张照片的 保留 / 观察 / 排除 → 折叠的「素材信息」来源面板。
  function materialCard(material, choice = '') {
    const id = esc(material.id);
    return `<article class="material-card" data-material-id="${id}"><img src="${esc(material.image)}" alt="${esc(material.title)}" loading="lazy"><div class="photo-actions"><button type="button" data-photo-choice="保留" data-photo="${id}" aria-pressed="${choice === '保留'}">保留</button><button type="button" data-photo-choice="观察" data-photo="${id}" aria-pressed="${choice === '观察'}">观察</button><button type="button" data-photo-choice="排除" data-photo="${id}" aria-pressed="${choice === '排除'}">排除</button></div><details><summary>素材信息</summary><p>${esc(material.title)}</p><p>${esc(material.source)}${material.publishedAt ? ' · ' + esc(date(material.publishedAt)) : ''}</p><a href="${esc(material.url)}" target="_blank" rel="noopener noreferrer">查看来源</a></details></article>`;
  }

  function materialSection(item) {
    const entries = Array.isArray(item?.materials) ? item.materials : [];
    const heading = item?.heading || '鞋履素材';
    if (!entries.length) return `<section class="finding"><h4>${esc(heading)}</h4><div><p>暂无已获取的鞋履素材。</p></div></section>`;
    const values = reviews();
    return `<section class="finding"><h4>${esc(heading)}</h4><div class="material-list">${entries.map(material => materialCard(material, values[material.id] || '')).join('')}</div></section>`;
  }

  function bindPhotoChoices(host) {
    host.querySelectorAll('[data-photo-choice]').forEach(button => button.addEventListener('click', () => {
      saveReview(button.dataset.photo, button.dataset.photoChoice);
      host.querySelectorAll(`[data-photo="${CSS.escape(button.dataset.photo)}"]`).forEach(control => control.setAttribute('aria-pressed', String(control === button)));
    }));
    host.querySelectorAll('.material-card img').forEach(image => image.addEventListener('error', () => {
      const card = image.closest('[data-material-id]');
      const id = card?.dataset.materialId;
      if (!card || !id) return;
      window.dispatchEvent(new CustomEvent('fashion:material-invalid', { detail: { id } }));
      const list = card.parentElement;
      card.remove();
      if (list && !list.querySelector('.material-card') && !list.querySelector('.material-empty')) {
        list.insertAdjacentHTML('beforeend', '<p class="material-empty">本次素材图片无法从公开来源正常加载，已自动剔除。</p>');
      }
    }, { once: true }));
  }

  // 供任务看板复用同一套素材卡片与照片评审。
  window.fashionMaterials = { section: materialSection, card: materialCard, bind: bindPhotoChoices, reviews, saveReview };

  function ensureMobileBack(host) {
    if (!host.querySelector('.mobile-lead-back')) host.insertAdjacentHTML('afterbegin', '<button class="mobile-lead-back" type="button" data-mobile-lead-back>返回线索列表</button>');
  }

  // 手机端：只要有选中的线索就进入完整详情视图，避免详情堆叠在整份列表下方。
  // 「返回线索列表」会收起当前选择，因此没有详情时自动回到列表。
  let mobileWantsDetail = true;
  function syncMobileDetail() {
    const layout = document.querySelector('.lead-layout');
    if (!layout) return;
    const hasDetail = Boolean(document.querySelector('#lead-detail .lead-detail'));
    const open = hasDetail && mobileWantsDetail && window.matchMedia('(max-width: 680px)').matches;
    layout.classList.toggle('mobile-detail-open', open);
  }

  // 收起当前选中的线索（手机端点「返回线索列表」时使用）。
  function collapseSelection() {
    openCandidate = null;
    const expanded = document.querySelector('#lead-list [data-lead][aria-expanded="true"]');
    if (expanded) { expanded.click(); return; }
    const host = document.querySelector('#lead-detail');
    if (host) host.innerHTML = '<p class="quiet">选择一条线索查看详情。</p>';
    render();
    syncMobileDetail();
  }

  function baseMaterials() {
    return (window.MIU_SAMPLE?.items || []).map(item => ({
      id: `miu-${item.id}`,
      title: item.title,
      image: item.image,
      source: 'Miu Miu 官方系列页',
      url: item.source,
      publishedAt: item.first_seen
    }));
  }

  function normalizeBaseLead() {
    const host = document.querySelector('#lead-detail .lead-detail:not(.candidate-detail)');
    if (!host || host.dataset.photoTemplate === 'true') return;
    const heading = host.querySelector('.lead-header h3')?.textContent || '';
    const sourceList = host.querySelector('.material-list');
    if (!heading.includes('Miu Miu') || !sourceList) return;
    const section = sourceList.closest('section');
    if (!section) return;
    host.dataset.photoTemplate = 'true';
    section.outerHTML = materialSection({ materials: baseMaterials() });
    ensureMobileBack(host);
    bindPhotoChoices(host);
    syncMobileDetail();
  }

  function detail(item) {
    const host = document.querySelector('#lead-detail');
    if (!host) return;
    if (!item) { host.innerHTML = '<p class="quiet">选择一条线索查看详情。</p>'; return; }
    host.innerHTML = `<button class="mobile-lead-back" type="button" data-mobile-lead-back>返回线索列表</button><article class="lead-detail candidate-detail">
      <header class="lead-header"><div><p class="eyebrow">时尚热点事件</p><h3>${esc(item.title)}</h3><p>${esc(item.source)}${item.publishedAt ? ' · ' + esc(date(item.publishedAt)) : ''}</p></div><span class="status">待核实</span></header>
      ${materialSection(item)}
    </article>`;
    bindPhotoChoices(host); syncMobileDetail();
  }

  function render() {
    const rail = document.querySelector('#lead-list');
    if (!rail) return;
    const items = read();
    rail.querySelectorAll('[data-candidate-lead]').forEach(node => node.remove());
    items.forEach(item => {
      const button = document.createElement('button');
      const expanded = openCandidate === item.id;
      button.className = 'lead-row'; button.type = 'button'; button.dataset.candidateLead = item.id; button.setAttribute('aria-expanded', String(expanded));
      button.innerHTML = `<strong>${esc(item.title)}</strong><span class="lead-source">来源：${esc(item.source)}${item.publishedAt ? ' · ' + esc(date(item.publishedAt)) : ''}</span><span class="lead-type">时尚热点事件 · 待核实</span>`;
      button.addEventListener('click', () => {
        const shouldOpen = openCandidate !== item.id;
        openCandidate = shouldOpen ? item.id : null;
        mobileWantsDetail = true;
        rail.querySelectorAll('[data-lead]').forEach(row => row.setAttribute('aria-expanded', 'false'));
        render();
        detail(shouldOpen ? item : null);
      });
      rail.append(button);
    });
    const total = document.querySelector('#lead-total');
    if (total) total.textContent = `${1 + items.length} 条`;
  }

  window.addEventListener('fashion:adopt-candidate', event => {
    const candidate = event.detail;
    if (!candidate?.url || !candidate?.title) return;
    const items = read();
    let item = items.find(value => value.url === candidate.url);
    if (!item) {
      item = { ...candidate, id: `candidate-${Date.now()}`, addedAt: new Date().toISOString() };
      items.unshift(item); write(items);
    }
    document.querySelector('[data-view="leads"]')?.click();
    openCandidate = item.id;
    mobileWantsDetail = true;
    requestAnimationFrame(() => { render(); detail(item); });
  });

  window.addEventListener('fashion:materials-ready', event => {
    const { taskId, materials, candidateUrls = [] } = event.detail || {};
    if (!taskId || !Array.isArray(materials)) return;
    const items = read(); let changed = false;
    items.forEach(item => {
      if (item.taskId === taskId || candidateUrls.includes(item.url)) { item.materials = materials; changed = true; }
    });
    if (changed) write(items);
  });

  document.addEventListener('click', event => {
    // The original Miu Miu renderer redraws the list. Re-append stored search leads.
    if (event.target.closest('[data-mobile-lead-back]')) { collapseSelection(); return; }
    if (event.target.closest('[data-lead]')) { openCandidate = null; mobileWantsDetail = true; requestAnimationFrame(syncMobileDetail); }
    if (event.target.closest('[data-view]')) mobileWantsDetail = true;
    if (event.target.closest('[data-view="leads"], [data-lead]')) requestAnimationFrame(render);
  });
  window.addEventListener('resize', () => syncMobileDetail());
  new MutationObserver(normalizeBaseLead).observe(document.body, { childList: true, subtree: true });
  // 会话由 Worker 建立后才加载工作台，因此进入页面即渲染已保存的线索。
  window.addEventListener('fashion:session-ready', () => requestAnimationFrame(render));
  normalizeBaseLead();
  render();
})();
