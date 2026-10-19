import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, normalizeInput, queriesFor, parseRSS, searchPlan, runSearch } from "../server.mjs";
const rss = (
  date = new Date().toUTCString(),
  link = "https://example.com/new-shoe",
) =>
  `<rss><channel><item><title>New women loafers</title><link>${link}</link><source>Example</source><pubDate>${date}</pubDate><description>New footwear collection</description></item></channel></rss>`;
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "shoe-v1-"));
  const app = createApp({
    dataDir: dir,
    photoSearch: false,
    fetcher: async () => new Response(rss()),
    ...options,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await Promise.allSettled([...app.jobs.values()]);
    await new Promise((r) => app.server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  return { ...app, dir, base: `http://127.0.0.1:${app.server.address().port}` };
}
function client(base) {
  let cookie = "";
  return async (path, body) => {
    const response = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { code: response.status, ...(await response.json()) };
  };
}
test("检索条件真实限制网站与日期，不附加秀场词", () => {
  const input = normalizeInput({
    subject: "女款乐福鞋",
    days: 7,
    domains: "example.com\nwww.example.org",
  });
  assert.equal(input.domains.length, 2);
  assert(queriesFor(input)[0].includes("loafers"));
  assert(!queriesFor(input)[0].includes("runway"));
  assert(queriesFor(input)[0].includes("site:example.com"));
  assert.equal(parseRSS(rss("Mon, 01 Jan 2024 00:00:00 GMT"), input).length, 0);
  assert.equal(
    parseRSS(rss("", "https://example.com/no-date"), input).length,
    0,
  );
  assert.equal(
    parseRSS(rss(undefined, "https://other.com/shoe"), input).length,
    0,
  );
  assert.equal(
    parseRSS(rss(undefined, "https://sub.example.com/shoe"), input).length,
    1,
  );
  assert.equal(
    parseRSS(rss(undefined, "https://example.com.evil.org/shoe"), input).length,
    0,
  );
  assert.equal(
    parseRSS(rss("", "https://example.com/no-date"), { ...input, days: 0 })[0]
      .publishedAt,
    null,
  );
  assert.throws(() =>
    normalizeInput({ subject: "鞋", domains: "http://127.0.0.1" }),
  );
});
test("人工核查、交付快照、账号隔离与重启保存", async (t) => {
  const { base, dir, server } = await setup(t);
  const a = client(base),
    b = client(base);
  assert.equal((await a("/tasks")).code, 401);
  await a("/login", { account: "demo-a" });
  await b("/login", { account: "demo-b" });
  let { task } = await a("/sample", {});
  const id = task.id,
    item = task.items[0];
  assert.equal(task.sample, true);
  assert.equal(item.publishedAt, null);
  assert.equal((await b("/tasks")).tasks.length, 0);
  assert.equal((await b("/tasks/" + id)).code, 404);
  assert.equal((await a("/tasks/" + id + "/deliver", {})).code, 400);
  assert.equal(
    (
      await a("/tasks/" + id + "/review", {
        id: item.id,
        review: "pending",
        selected: true,
        note: "",
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await a("/tasks/" + id + "/review", {
        id: item.id,
        review: "verified",
        selected: true,
        note: "",
      })
    ).code,
    400,
  );
  let r = await a("/tasks/" + id + "/review", {
    id: item.id,
    review: "verified",
    selected: true,
    note: "原文与图片对应，外观可供参考",
  });
  assert.equal(r.code, 200);
  assert.equal(r.task.items[0].selected, true);
  r = await a("/tasks/" + id + "/deliver", {});
  assert.equal(r.task.status, "delivered");
  assert.equal(r.task.delivery.items.length, 1);
  assert.equal(
    (
      await a("/tasks/" + id + "/review", {
        id: item.id,
        review: "excluded",
        selected: false,
        note: "",
      })
    ).code,
    409,
  );
  assert.equal((await a("/tasks/" + id + "/deliver", {})).code, 409);
  const stored = JSON.parse(await readFile(join(dir, "demo-a.json"), "utf8"));
  assert.equal(
    stored.tasks[0].delivery.items[0].note,
    "原文与图片对应，外观可供参考",
  );
  const second = createApp({ dataDir: dir });
  await new Promise((r) => second.server.listen(0, "127.0.0.1", r));
  const restored = client("http://127.0.0.1:" + second.server.address().port);
  await restored("/login", { account: "demo-a" });
  assert.equal((await restored("/tasks")).tasks[0].delivery.items.length, 1);
  await new Promise((r) => second.server.close(r));
  await a("/tasks/" + id + "/reopen", {});
  r = await a("/tasks/" + id + "/review", {
    id: item.id,
    review: "excluded",
    selected: false,
    note: "撤销，款式不合适",
  });
  assert.equal(r.task.delivery, null);
  assert.equal(r.task.items[0].selected, false);
});
test("真实任务先保存、渠道失败留存、重试后成功，未核查结果不自动交付", async (t) => {
  let fail = true;
  const { base, jobs } = await setup(t, {
    fetcher: async (url) => {
      if (fail) throw Error("upstream failed");
      if (
        String(url).includes("news.google.com") ||
        String(url).includes("bing.com")
      )
        return new Response(rss());
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    },
  });
  const a = client(base);
  await a("/login", { account: "demo-a" });
  const r = await a("/tasks", { subject: "loafers", days: 30 });
  assert.equal(r.code, 201);
  assert.equal(r.task.status, "running");
  await Promise.all([...jobs.values()]);
  let d = await a("/tasks/" + r.task.id);
  assert.equal(d.task.status, "error");
  assert.equal((await a("/tasks")).tasks.length, 1);
  fail = false;
  await a("/tasks/" + r.task.id + "/retry", {});
  await Promise.all([...jobs.values()]);
  d = await a("/tasks/" + r.task.id);
  assert.equal(d.task.status, "review");
  assert.equal(d.task.items.length, 1);
  assert.equal(d.task.items[0].review, "pending");
  assert.equal(d.task.items[0].image, null);
  assert.equal(d.task.delivery, null);
});
test("所有渠道无匹配保持空结果，不用历史示例填充", async (t) => {
  const { base, jobs } = await setup(t, {
    fetcher: async () => new Response("<rss><channel></channel></rss>"),
  });
  const a = client(base);
  await a("/login", { account: "demo-a" });
  const { task } = await a("/tasks", { subject: "女鞋", days: 7 });
  await Promise.all([...jobs.values()]);
  const r = await a("/tasks/" + task.id);
  assert.equal(r.task.items.length, 0);
  assert.equal(r.task.status, "review");
  assert.match(r.task.message, /未找到/);
  assert(!r.task.sample);
});
test("配置正式账号时阻止体验账号进入，跨站写入拒绝", async (t) => {
  const { base } = await setup(t, { users: { client: "test-secret" } });
  const a = client(base);
  assert.equal((await a("/session")).demo, false);
  assert.equal((await a("/login", { account: "demo-a" })).code, 401);
  assert.equal(
    (await a("/login", { account: "client", password: "wrong" })).code,
    401,
  );
  assert.equal(
    (await a("/login", { account: "client", password: "test-secret" })).code,
    200,
  );
  const response = await fetch(base + "/api/sample", {
    method: "POST",
    headers: {
      origin: "https://other.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
});

test('手机预览直接进入、刷新保留会话，浏览器之间不共享任务',async t=>{
 const {base}=await setup(t,{guestPreview:true});
 const a=client(base),b=client(base);
 const first=await a('/session');assert.equal(first.guest,true);assert(first.account.startsWith('guest-'));
 assert.equal((await a('/login',{account:'demo-a'})).code,405);
 assert.equal((await a('/sample',{})).code,404);await a('/tasks',{subject:'women loafers',days:0});assert.equal((await a('/tasks')).tasks.length,1);
 assert.equal((await a('/session')).account,first.account);
 const second=await b('/session');assert.notEqual(second.account,first.account);assert.equal((await b('/tasks')).tasks.length,0);
});

test("来源范围真实控制查询边界，日期未知置后，多渠道结果按最新排序", async () => {
  const focus = normalizeInput({ subject: "乐福鞋", days: 0, sourceScope: 0, sources: ["official"] });
  assert.equal(focus.days, 0);
  const focusedPlan = searchPlan(focus);
  assert(focusedPlan.every(entry => entry.domains.length && entry.providers.every(provider => provider === "Bing")));
  assert(focusedPlan.every(entry => entry.domains.every(domain => ["miumiu.com", "camper.com"].includes(domain))));
  const balanced = searchPlan({ ...focus, sourceScope: 1 });
  assert(balanced.some(entry => entry.label === "相关新闻"));
  assert(!balanced.some(entry => entry.label === "公开网页"));
  assert(searchPlan({ ...focus, sourceScope: 2 }).some(entry => entry.label === "公开网页"));
  assert.throws(() => normalizeInput({ subject: "鞋", sourceScope: 0, sources: [] }));
  assert.throws(() => normalizeInput({ subject: "鞋", sourceScope: 2, sources: ["social"] }));
  const restricted = await runSearch(focus, async () => new Response(rss(undefined, "https://example.com/outside")));
  assert.equal(restricted.items.length, 0);
  const seen = [];
  const searched = await runSearch({ subject: "鞋", days: 0, domains: [] }, async value => {
    const url = new URL(value);
    if (!["news.google.com", "www.bing.com"].includes(url.hostname)) return new Response("", { status: 403 });
    seen.push(url.hostname);
    const link = url.hostname === "news.google.com" ? "https://news.google.com/old" : "https://news.google.com/recent";
    const date = url.hostname === "news.google.com" ? "Fri, 01 Jan 2021 00:00:00 GMT" : "Mon, 01 Jan 2024 00:00:00 GMT";
    return new Response(rss(date, link));
  });
  assert.equal(new Set(seen).size, 2);
  assert.match(searched.items[0].url, /recent/);
});
