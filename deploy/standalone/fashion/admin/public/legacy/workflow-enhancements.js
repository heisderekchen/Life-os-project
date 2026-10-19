(() => {
  const root = document;
  const sample = window.MIU_SAMPLE;
  const state = { lead: false, tasks: 0, channels: 0, verified: false };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const style = root.createElement('style');
  style.textContent = `.page-title>p,.sidebar-foot,.detail-context,.lead-row>small,.lead-header>div>h3+p{display:none!important}.workflow-shell{max-width:1080px;border-top:2px solid var(--ink)}.workflow-map{display:grid;grid-template-columns:240px minmax(0,1fr);gap:40px;padding:24px 0}.workflow-stages{border-right:1px solid var(--line);padding-right:22px}.workflow-stage{display:grid;grid-template-columns:30px 1fr;gap:10px;width:100%;padding:15px 0;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}.workflow-stage:hover,.workflow-stage[aria-pressed=true]{color:var(--accent)}.workflow-stage[aria-pressed=true]{font-weight:700}.stage-no{color:var(--muted);font-size:11px}.workflow-stage small{display:block;margin-top:3px;color:var(--muted);font-size:12px;font-weight:400}.stage-panel h3{font-size:28px;letter-spacing:-.05em}.stage-panel>p{max-width:52ch;margin:8px 0 22px;color:var(--muted)}.stage-config{border-top:1px solid var(--line)}.stage-config-row{display:grid;grid-template-columns:165px minmax(0,1fr);gap:18px;padding:16px 0;border-bottom:1px solid var(--line)}.stage-config-row strong{font-size:14px}.stage-config-row span{color:#3a4956;line-height:1.65}.stage-action{display:flex;align-items:center;gap:12px;margin-top:20px}.stage-result{color:var(--good);font-size:13px;font-weight:700}.lead-row .lead-source{display:block;margin-top:8px;color:var(--muted);font-size:11px}.lead-row .lead-status{display:inline-block;margin-top:6px;border:1px solid #bed9ca;border-radius:999px;padding:2px 7px;color:var(--good);font-size:11px}@media(max-width:680px){.workflow-map{grid-template-columns:1fr;gap:21px}.workflow-stages{display:flex;gap:16px;overflow:auto;border-right:0;border-bottom:1px solid var(--line);padding:0 0 12px}.workflow-stage{display:block;min-width:135px;border-bottom:0;padding:0}.stage-no{display:block;margin-bottom:5px}.stage-config-row{grid-template-columns:1fr;gap:4px}.stage-action{align-items:flex-start;flex-direction:column}}`;
  root.head.append(style);
  const stages = [
    ['01','时尚线索','定义要追踪什么','先把发生了什么、关联品牌和待查问题说明白，再进入采集。',[['线索类型','时尚热点事件、新品与系列、穿搭风格、设计元素、市场信号。'],['当前样本','Miu Miu 2027 春夏发布，来自公开官网与主办方。']],'新增线索'],
    ['02','查找任务','把线索变成问题','将品牌、系列、鞋型、时间、来源和细节拆成可以完成的查找任务。',[['任务模板','确认原始发布、定位鞋履细节、核对季节与来源。'],['完成标准','关键事实可追溯，并能关联到具体素材。']],'生成查找任务'],
    ['03','渠道获取','确定去哪里找','渠道是获得与验证线索的入口，来源与时间需要和素材一起保留。',[['公开渠道','品牌官网、发布会页面、时装周主办方与公开媒体。'],['后续渠道','需登录社媒在获得授权后补充。']],'登记渠道来源'],
    ['04','核实与整理','确认、去重、关联','过滤非鞋履内容，归并同一事件素材，保留原始出处与核实记录。',[['核实字段','品牌、系列/季节、事件时间、原始来源、素材核实时间。'],['当前状态','样本内三项鞋履素材已完成人工目视核实。']],'更新核实状态'],
    ['05','线索评估','判断开发价值','先评估整条线索，再单独判断每项关联素材；两类结果彼此独立。',[['线索评估','记录整条线索是否值得开发、是否需要继续研究。'],['素材评估','对每张鞋履素材分别记录判断与意见。']],'进入线索评估']
  ];
  const message = index => index === 0 ? (state.lead ? '已新增一条待整理线索' : '') : index === 1 ? (state.tasks ? `已生成 ${state.tasks} 项查找任务` : '') : index === 2 ? (state.channels ? `已登记 ${state.channels} 个渠道来源` : '') : index === 3 && state.verified ? '核实状态已更新为：已核实' : '';
  function renderWorkflow(index = 0) {
    const flow = root.querySelector('#flow-view'); if (!flow) return; const active = stages[index];
    flow.innerHTML = `<div class="page-title"><div><h2>线索工作流程</h2></div><p>从线索定义到评估，五个阶段分别保留输入、处理和结果。</p></div><section class="workflow-shell"><div class="workflow-map"><nav class="workflow-stages">${stages.map((stage, position) => `<button class="workflow-stage" data-stage="${position}" aria-pressed="${position === index}"><span class="stage-no">${stage[0]}</span><span>${stage[1]}<small>${stage[2]}</small></span></button>`).join('')}</nav><section class="stage-panel"><h3>${active[1]}</h3><p>${active[3]}</p><div class="stage-config">${active[4].map(row => `<div class="stage-config-row"><strong>${row[0]}</strong><span>${row[1]}</span></div>`).join('')}</div><div class="stage-action"><button class="primary" data-stage-action="${index}">${active[5]}</button><span class="stage-result" aria-live="polite">${message(index)}</span></div></section></div></section>`;
    flow.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => renderWorkflow(Number(button.dataset.stage))));
    flow.querySelector('[data-stage-action]').addEventListener('click', () => { if (index === 0) state.lead = true; if (index === 1) state.tasks += 1; if (index === 2) state.channels += 1; if (index === 3) state.verified = true; if (index === 4) { root.querySelectorAll('[data-view="leads"]').forEach(button => button.click()); root.querySelector('#lead-detail')?.scrollIntoView({behavior:'smooth',block:'start'}); return; } renderWorkflow(index); });
  }
  function enhanceLeadView() {
    root.querySelectorAll('.nav-button[data-view="flow"],.mobile-nav [data-view="flow"]').forEach(button => { if (button.textContent !== '线索工作流程') button.textContent = '线索工作流程'; });
    const topbarTitle = root.querySelector('.topbar h1'); if (topbarTitle && topbarTitle.textContent !== '工作台') topbarTitle.replaceChildren('工作台');
    root.querySelectorAll('.lead-row:not([data-candidate-lead])').forEach(row => { if (!row.querySelector('.lead-source')) row.insertAdjacentHTML('beforeend','<small class="lead-source">来源：Miu Miu 官方系列页 / FHCM 主办方</small><span class="lead-status">已核实</span>'); });
    const reviewTitle = root.querySelector('.lead-review h4'); if (reviewTitle && reviewTitle.textContent !== '整体结论') reviewTitle.replaceChildren('整体结论');
  }
  new MutationObserver(enhanceLeadView).observe(root.body,{childList:true,subtree:true});
  // 切换账号 = 退出当前会话：由 Worker 清除会话 Cookie，再回到登录页。
  root.querySelector('#switch')?.addEventListener('click', event => { event.stopImmediatePropagation(); root.querySelector('#identity').textContent=''; window.fashionSession?.logout?.(); },true);
  renderWorkflow(); enhanceLeadView();
})();
