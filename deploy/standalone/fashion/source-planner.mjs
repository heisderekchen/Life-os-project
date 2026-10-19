import { photoQuery } from './photo-search.mjs';

const categories = { official: 'brand', media: 'media', retail: 'retail' };
const scopeGroups = { official: ['brand'], media: ['media', 'industry', 'trend'], retail: ['retail'] };
const compact = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function sourceSearchPlan(input, sources) {
  if (input.sourceScope === undefined) return null;
  const subject = compact(photoQuery(input.subject));
  const normalize = d => String(d || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const excluded = new Set(sources.filter(s => s.review === 'exclude').map(s => normalize(s.domain)));
  const seen = new Set();
  const eligible = sources.map(s => ({...s, domain: normalize(s.domain)})).filter(s => {
    if (excluded.has(s.domain) || seen.has(s.domain) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.domain)) return false;
    seen.add(s.domain); return true;
  });
  const brandMatches = eligible.filter(s => s.category === 'brand' && [s.name, s.domain.split('.')[0]].some(name => {
    const term = compact(name); return term.length >= 3 && subject.includes(term);
  }));
  const sports = /nike|adidas|puma|jordan|newbalance|asics|sneaker|运动|球鞋/.test(subject);
  const rank = source => (source.priority === 'high' ? 100 : source.priority === 'reserve' ? -20 : 0) +
    (source.review === 'retain' ? 40 : 0) + (source.shoeRelevance === '鞋履直接相关' ? 12 : 0) + (source.footwearSignal ? 8 : 0) +
    (source.accessStatus === 'accessible' ? 4 : 0) +
    (sports && /sneaker|kicks|sole|footwear|hypebeast|highsnobiety|footlocker|jdsports|finishline|endclothing|farfetch|ssense|mrporter|size\?|运动|球鞋/i.test(source.name + ' ' + source.domain) ? 30 : 0);
  const isBrandMatch = s => brandMatches.some(b => b.domain === s.domain);
  const catalogueOf = domains => domains.includes('nike.com') && brandMatches.some(s => s.domain === 'nike.com') ? 'nike' : null;

  const plans = [];

  if (input.sourceScope === 2) {
    const selectedGroups = new Set();
    for (const id of input.sources || []) {
      for (const g of scopeGroups[id] || []) selectedGroups.add(g);
    }
    const pool = eligible.filter(s => selectedGroups.has(s.category)).map(s => ({
      source: s,
      score: rank(s) + (s.category === 'brand' && isBrandMatch(s) ? 1000 : 0)
    }));
    pool.sort((a, b) => b.score - a.score || a.source.domain.localeCompare(b.source.domain));
    const domainsList = pool.map(p => p.source.domain);
    for (let i = 0; i < domainsList.length; i += 5) {
      const domains = domainsList.slice(i, i + 5);
      if (!domains.length) continue;
      plans.push({ label: '来源检索', domains, catalogue: catalogueOf(domains) });
    }
  } else {
    const take = input.sourceScope === 1 ? 6 : 3;
    for (const id of input.sources || []) {
      const pool = id === 'official' && brandMatches.length ? brandMatches : eligible.filter(s => s.category === categories[id]);
      const chosen = [...pool].sort((a, b) => rank(b) - rank(a) || a.domain.localeCompare(b.domain)).slice(0, take);
      for (let i = 0; i < chosen.length; i += 3) {
        const domains = chosen.slice(i, i + 3).map(s => s.domain);
        plans.push({ label: { official: '品牌官方', media: '专业媒体', retail: '零售平台' }[id], domains, catalogue: catalogueOf(domains) });
      }
    }
  }

  for (const domain of input.domains || []) {
    const lower = String(domain || '').toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(lower) || plans.some(p => p.domains.includes(lower))) continue;
    const excluded = sources.some(s => s.review === 'exclude' && String(s.domain).toLowerCase().replace(/^www\./, '') === lower);
    if (excluded) continue;
    plans.push({ label: '补充来源', domains: [lower], catalogue: catalogueOf([lower]) });
  }

  const excludedDomains = sources
    .filter(s => s.review === 'exclude')
    .map(s => String(s.domain || '').toLowerCase().replace(/^www\./, ''))
    .filter(Boolean);
  plans.excludedDomains = [...new Set(excludedDomains)];
  return plans;
}
