(() => {
  const sessionKey = 'fashion-intelligence-demo-user';
  const feedbackKey = 'fashion-intelligence-local-feedback';
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  // The prototype keeps its own browser-only session and feedback. Public
  // searches are deliberately forwarded to the isolated fashion endpoint,
  // never to HappySPA's business /api namespace.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    const username = sessionStorage.getItem(sessionKey);
    if (url.pathname === '/api/session') return json({authenticated:true,username:'管理员'});
    if (url.pathname === '/api/logout') {location.replace('/fashion-admin/settings/sources');return json({ok:true});}
    const body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
    if (url.pathname === '/api/search/events' || url.pathname === '/api/search/materials') {
      const isolatedPath = url.pathname.replace('/api/', '/fashion/api/');
      return nativeFetch(new Request(new URL(isolatedPath, location.origin), { method: init.method || 'POST', headers: init.headers, body: init.body }));
    }
    if (url.pathname.startsWith('/api/feedback')) {
      const all = JSON.parse(localStorage.getItem(feedbackKey) || '{}');
      if (init.method === 'PUT') { all[url.pathname] = body; localStorage.setItem(feedbackKey, JSON.stringify(all)); }
      return json({ feedback: all[url.pathname] || body || {} });
    }
    return json({ error: '此演示功能不连接 HappySPA 业务接口。' });
  };
  document.addEventListener('click', event => {
    if (event.target.closest('#logout,#switch')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      sessionStorage.removeItem(sessionKey);
      location.replace('/fashion-admin/settings/sources');
    }
  }, true);
})();
