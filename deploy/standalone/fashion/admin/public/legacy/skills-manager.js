(() => {
  const key = 'fashion-intelligence-skills-v1';
  const defaults = [{ id: 'shoe-photo-intelligence', name: '鞋履照片情报', enabled: true, updatedAt: '2026-10-06T18:10:00+08:00', summary: '检索、筛选并组织可追溯的鞋履照片。', rules: ['鞋履主体清楚可辨', '排除人体局部、服装主图和通用品牌图', '每张照片单独评估并保留来源'] }];
  const read = () => { try { const value = JSON.parse(localStorage.getItem(key)); const skills = Array.isArray(value) && value.length ? value : defaults; return skills.map(skill => ({ ...skill, updatedAt: skill.updatedAt || '2026-10-06T18:10:00+08:00' })); } catch { return defaults; } };
  const write = value => localStorage.setItem(key, JSON.stringify(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const updated = value => { try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return String(value || '未记录'); } };
  window.fashionSkills = { isEnabled: id => read().some(skill => skill.id === id && skill.enabled) };

  const style = document.createElement('style');
  style.textContent = `#skills-view{padding:8px clamp(8px,2vw,18px) 28px}.skills-shell{max-width:1040px;margin:0 auto;padding:clamp(16px,2vw,26px);border:1px solid var(--glass-line);border-radius:22px;background:var(--glass);box-shadow:0 24px 58px rgba(66,100,122,.15),inset 0 1px rgba(255,255,255,.86);backdrop-filter:blur(28px) saturate(1.2)}.skills-list{display:grid;gap:10px}.skill-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start;padding:17px 0;border-bottom:1px solid rgba(77,110,124,.16)}.skill-row:last-child{border-bottom:0}.skill-name{font-size:17px}.skill-summary{margin:5px 0 0;color:var(--muted);font-size:13px}.skill-updated{display:block;margin-top:6px;color:var(--muted);font-size:12px}.skill-tools{display:flex;gap:8px;align-items:center}.skill-tools button{min-height:34px;border:1px solid rgba(93,125,139,.28);border-radius:8px;padding:0 10px;background:rgba(255,255,255,.7);color:var(--ink);font-weight:700;cursor:pointer}.skill-details{display:none;grid-column:1/-1;padding:13px 0 2px;color:#405b65;font-size:13px}.skill-row[data-open=true] .skill-details{display:block}.skill-details ul{margin:0;padding-left:18px}.skill-switch{display:flex;align-items:center;justify-content:flex-start;width:44px;height:26px;min-height:26px!important;border:0!important;border-radius:999px!important;padding:4px!important;background:#b9c6cc!important;transition:background .18s}.skill-switch:after{display:block;flex:0 0 18px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18);content:"";transition:transform .18s}.skill-switch[aria-checked=true]{background:#2f8a78!important}.skill-switch[aria-checked=true]:after{transform:translateX(18px)}@media(max-width:680px){.skill-row{grid-template-columns:1fr}.skill-tools{justify-content:space-between}}`;
  document.head.append(style);
  const switchStyle = document.createElement('style');
  switchStyle.textContent = '.skill-switch{box-sizing:border-box;align-items:center;justify-content:flex-start;flex:0 0 auto;align-self:center}.skill-switch:after{margin:0;flex:0 0 18px}@media(max-width:680px){.skill-tools button:not(.skill-switch){min-height:44px}}';
  document.head.append(switchStyle);

  function ensure() {
    const flowButton = document.querySelector('.sidebar [data-view="flow"]');
    if (flowButton && !document.querySelector('[data-skills-panel]')) { const button = document.createElement('button'); button.className = 'nav-button'; button.type = 'button'; button.dataset.skillsPanel = 'true'; button.textContent = '技能管理'; flowButton.after(button); }
    const mobileFlow = document.querySelector('.mobile-nav [data-view="flow"]');
    if (mobileFlow && !document.querySelector('.mobile-nav [data-skills-panel]')) { const button = document.createElement('button'); button.type = 'button'; button.dataset.skillsPanel = 'true'; button.textContent = '技能'; mobileFlow.after(button); }
    if (!document.querySelector('#skills-view')) { const view = document.createElement('section'); view.id = 'skills-view'; view.hidden = true; document.querySelector('.main')?.append(view); }
    document.querySelectorAll('[data-skills-panel]').forEach(button => button.onclick = show);
  }
  function render() {
    const view = document.querySelector('#skills-view'); if (!view || view.hidden) return;
    const skills = read();
    view.innerHTML = `<div class="page-title"><h2>技能管理</h2></div><section class="skills-shell"><div class="skills-list">${skills.map(skill => `<article class="skill-row" data-skill="${escape(skill.id)}" data-open="false"><div><strong class="skill-name">${escape(skill.name)}</strong><p class="skill-summary">${escape(skill.summary)}</p><time class="skill-updated" datetime="${escape(skill.updatedAt)}">更新于 ${escape(updated(skill.updatedAt))}</time></div><div class="skill-tools"><button type="button" data-skill-detail="${escape(skill.id)}">规则</button><button type="button" class="skill-switch" role="switch" aria-checked="${skill.enabled}" aria-label="${escape(skill.name)}" data-skill-toggle="${escape(skill.id)}"></button></div><div class="skill-details"><ul>${skill.rules.map(rule => `<li>${escape(rule)}</li>`).join('')}</ul></div></article>`).join('')}</div></section>`;
    view.querySelectorAll('[data-skill-detail]').forEach(button => button.onclick = () => { const row = button.closest('.skill-row'); row.dataset.open = row.dataset.open !== 'true'; });
    view.querySelectorAll('[data-skill-toggle]').forEach(button => button.onclick = () => {
      const skills = read();
      const skill = skills.find(item => item.id === button.dataset.skillToggle);
      if (!skill) return;
      skill.enabled = !skill.enabled;
      skill.updatedAt = new Date().toISOString();
      write(skills);
      // 就地更新开关与「更新于」时间，避免整页重绘丢失展开状态。
      button.setAttribute('aria-checked', String(skill.enabled));
      const row = button.closest('.skill-row');
      const time = row?.querySelector('.skill-updated');
      if (time) { time.setAttribute('datetime', skill.updatedAt); time.textContent = `更新于 ${updated(skill.updatedAt)}`; }
    });
  }
  function show() {
    ensure(); document.querySelector('#leads-view').hidden = true; document.querySelector('#flow-view').hidden = true; document.querySelector('#tasks-view')?.setAttribute('hidden', ''); document.querySelector('#skills-view').hidden = false;
    document.querySelectorAll('[data-view],[data-task-panel],[data-skills-panel]').forEach(button => button.setAttribute('aria-current', 'false')); document.querySelectorAll('[data-skills-panel]').forEach(button => button.setAttribute('aria-current', 'true')); render();
  }
  document.addEventListener('click', event => { if (event.target.closest('[data-view],[data-task-panel]')) { document.querySelector('#skills-view')?.setAttribute('hidden', ''); document.querySelectorAll('[data-skills-panel]').forEach(button => button.setAttribute('aria-current', 'false')); } });
  ensure();
})();
