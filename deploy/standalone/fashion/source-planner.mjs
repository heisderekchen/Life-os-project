import { photoQuery } from './photo-search.mjs';
const categories = { official: 'brand', media: 'media', retail: 'retail' };
const compact = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function sourceSearchPlan(input, sources) {
  if (input.sourceScope === undefined) return null;
  const subject = compact(photoQuery(input.subject));
  const eligible = sources.filter(s => s.review !== 'exclude' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.domain));
  const brandMatches = eligible.filter(s => s.category === 'brand' && [s.name, s.domain.split('.')[0]].some(name => {
    const term = compact(name); return term.length >= 3 && subject.includes(term);
  }));
  const sports = /nike|adidas|puma|jordan|newbalance|asics|sneaker|运动|球鞋/.test(subject);
  const rank = source => (source.priority === 'high' ? 100 : source.priority === 'reserve' ? -20 : 0) +
    (source.review === 'retain' ? 40 : 0) + (source.shoeRelevance === '鞋履直接相关' ? 12 : 0) + (source.footwearSignal ? 8 : 0) +
    (source.accessStatus === 'accessible' ? 4 : 0) +
    (sports && /sneaker|kicks|sole|footwear|hypebeast|highsnobiety|footlocker|jdsports|finishline|endclothing|farfetch|ssense|mrporter|size\?|运动|球鞋/i.test(source.name + ' ' + source.domain) ? 30 : 0);
  const take = input.sourceScope === 2 ? 9 : input.sourceScope === 1 ? 6 : 3;
  const plans = [];
  for (const id of input.sources || []) {
    const pool = id === 'official' && brandMatches.length ? brandMatches : eligible.filter(s => s.category === categories[id]);
    const chosen = [...pool].sort((a, b) => rank(b) - rank(a) || a.domain.localeCompare(b.domain)).slice(0, take);
    for (let i = 0; i < chosen.length; i += 3) {
      const domains = chosen.slice(i, i + 3).map(s => s.domain);
      plans.push({ label: { official: '品牌官方', media: '专业媒体', retail: '零售平台' }[id], domains,
        catalogue: domains.includes('nike.com') && brandMatches.some(s => s.domain === 'nike.com') ? 'nike' : null });
    }
  }
  for (const domain of input.domains || []) plans.push({ label: '补充来源', domains: [domain] });
  plans.excludedDomains = sources.filter(s => s.review === 'exclude').map(s => s.domain);
  return plans;
}
