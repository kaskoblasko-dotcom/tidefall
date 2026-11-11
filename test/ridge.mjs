import * as W from '../public/shared/world.js';
for (const [ax,az,bx,bz] of [[-66,22,-90,36],[56,-4,76,-17]]) { const o=[]; for(let t=0;t<=1;t+=.1) o.push(W.heightAt(ax+(bx-ax)*t, az+(bz-az)*t).toFixed(2)); console.log(o.join(' ')); }
console.log(W.structures.piers.map(p=>[p.x.toFixed(0),p.z.toFixed(0),W.heightAt(p.x,p.z).toFixed(1)].join(',')).join(' | '));
console.log(W.structures.huts.map(p=>[p.x.toFixed(0),p.z.toFixed(0),p.y.toFixed(1)].join(',')).join(' | '));
console.log(W.structures.wrecks.map(p=>[p.name,p.x.toFixed(0),p.z.toFixed(0),p.y.toFixed(1)].join(',')).join(' | '));
let mx=-9,mn=9; for(const h of W.heights){mx=Math.max(mx,h);mn=Math.min(mn,h)} console.log('range',mn.toFixed(1),mx.toFixed(1), 'props',W.props.palms.length,W.props.reeds.length);
console.log('spawn',W.SPAWNS.map(s=>`${s.x.toFixed(0)},${s.z.toFixed(0)},${s.y.toFixed(1)}`).join(' '));
