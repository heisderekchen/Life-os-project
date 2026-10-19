import test from 'node:test';
import assert from 'node:assert/strict';
import {isTargetPage} from '../target-page.mjs';
const deny=['/cn/sale/air-jordan','/en/brands/air-jordan/sneakers','/en-gb/collections/new','/products','/search/x','/category/shoes','/new-arrivals'];
const allow=['/cn/product/nike-dunk','/shoes/nike-dunk-release','/nike-sale-announced','/news/brand-partnership','/en/products/shoe','/en-cn/products/nike-shoe','/news/brand/story'];
for(const u of deny)test('deny '+u,()=>assert.equal(isTargetPage("https://source.test"+u),false));
for(const u of allow)test('allow '+u,()=>assert.equal(isTargetPage("https://source.test"+u),true));
test('invalid',()=>{assert.equal(isTargetPage('not a url'),false);assert.equal(isTargetPage('/'),false);assert.equal(isTargetPage('ftp://x/y'),false);});
