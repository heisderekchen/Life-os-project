(() => {
  // The count is intentionally limited to verified leads. Search attempts and
  // candidates live in the task board until an operator verifies them.
  const render = () => {
    const total = document.querySelector('#lead-total');
    const rail = document.querySelector('.lead-rail');
    if (!total || !rail) return;
    total.setAttribute('aria-label', `已核实线索 ${total.textContent}`);
    if (!rail.querySelector('[data-open-task-output]')) {
      const action = document.createElement('button');
      action.type = 'button'; action.dataset.openTaskOutput = 'true';
      action.textContent = '查看任务产出';
      action.addEventListener('click', () => document.querySelector('[data-task-panel]')?.click());
      rail.append(action);
    }
  };
  const css = document.createElement('style');
  css.textContent = `
    :root{--muted:#4f5f6a}
    #leads-view .lead-rail [data-open-task-output]{width:100%;margin-top:12px;border:1px solid rgba(47,121,133,.28);border-radius:10px;padding:10px 12px;color:#176f79;background:rgba(232,248,248,.72);font:inherit;font-size:13px;font-weight:700;text-align:left}
    #leads-view .lead-rail [data-open-task-output]:hover{border-color:#2f7f8d;background:#e0f4f3}
    @media(max-width:680px){#leads-view .lead-rail [data-open-task-output]{min-height:44px}}
  `;
  document.head.append(css);
  window.addEventListener('fashion:session-ready', () => requestAnimationFrame(render));
  new MutationObserver(render).observe(document.body, { childList: true, subtree: true });
  render();
})();
