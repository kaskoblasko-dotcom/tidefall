import * as W from '../public/shared/world.js';
import {tideLevel} from '../public/shared/constants.js';
const {heightAt}=W;
let rows=[];
for(let z=-120;z<=120;z+=4){let s='';for(let x=-120;x<=120;x+=2){const y=heightAt(x,z);
 s+= y<-1.2?'~': y<0.2?'-': y<1.2?'=': y<3.6?'.': y<4.2?',': y<8?'o': y<13?'O':'#';}rows.push(s);}
console.log(rows.join('\n'));
console.log('spawns',W.SPAWNS.length,W.SPAWNS.map(s=>s.x.toFixed(0)+','+s.z.toFixed(0)).join(' | '));
console.log('relics',W.RELIC_SITES.map(r=>`${r.kind}@${r.x.toFixed(0)},${r.z.toFixed(0)} y${r.y.toFixed(2)}`).join('\n'));
console.log('props',Object.fromEntries(Object.entries(W.props).map(([k,v])=>[k,v.length])),'colliders',W.colliders.length,'huts',W.structures.huts.length,'piers',W.structures.piers.length);
const c1=heightAt(-78,30); console.log('causeway sample',[-66,-72,-78,-84,-90].map(x=>heightAt(x, 22+(x+66)/-24*14).toFixed(2)));
