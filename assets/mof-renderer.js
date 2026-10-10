/* CIF-derived periodic cells, front pore views, and a common physical scale. */
(() => {
  'use strict';
  const colors = { Cu:'#b77a49', Zn:'#2879b8', Mg:'#58a17c', Zr:'#8064ad', O:'#c75a57', N:'#436fb7', C:'#657786' };
  const radii = { Cu:.65, Zn:.64, Mg:.60, Zr:.70, O:.40, N:.35, C:.30 };
  const prepared = new WeakMap(), catalogs = new WeakMap();
  const repetitions = { 'cu-btc':[2,2,1], 'calf-20':[1,3,3], 'mg-mof-74':[2,2,1], 'nu-1000':[1,1,1] };
  const dot = (a,b) => a.reduce((sum,x,i) => sum+x*b[i],0);
  const normalize = v => { const n=Math.hypot(...v); return v.map(x=>x/n); };
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const pointKey = p => p.map(x=>Math.round(x*1e6)).join(',');
  function geometry(model) {
    if (prepared.has(model)) return prepared.get(model);
    const vectors=model.cell_vectors, poreAxis=model.slug==='calf-20'?0:2;
    const depth=normalize(vectors[poreAxis]), horizontal=vectors[poreAxis===0?1:0];
    const right=normalize(horizontal.map((x,i)=>x-dot(horizontal,depth)*depth[i]));
    const basis=[right,cross(depth,right),depth];
    const corners=Array.from({length:8},(_,i)=>[0,1,2].map(d=>vectors.reduce((sum,v,axis)=>sum+(((i>>axis)&1)-.5)*v[d],0)));
    const edges=[];
    for(let i=0;i<8;i++) for(let axis=0;axis<3;axis++) if(!(i&(1<<axis))) edges.push([i,i|(1<<axis)]);
    const repeat=repetitions[model.slug]||[1,1,1], atoms=new Map(), bonds=new Map(), cellPoints=new Map(), cellEdges=new Map();
    const displayCorners=[], displayEdges=[];
    const center=repeat.map(n=>Math.floor((n-1)/2));
    let labelCorners=corners;
    function cornerIndex(p) {
      const key=pointKey(p);
      if(!cellPoints.has(key)) { cellPoints.set(key,displayCorners.length); displayCorners.push(p); }
      return cellPoints.get(key);
    }
    for(let i=0;i<repeat[0];i++) for(let j=0;j<repeat[1];j++) for(let k=0;k<repeat[2];k++) {
      const copy=[i,j,k], offset=[0,1,2].map(d=>vectors.reduce((sum,v,axis)=>sum+(copy[axis]-(repeat[axis]-1)/2)*v[d],0));
      const shift=p=>p.map((x,d)=>x+offset[d]);
      const primary=copy.every((x,axis)=>x===center[axis]);
      const cell=corners.map(shift), indices=cell.map(cornerIndex);
      if(primary) labelCorners=cell;
      for(const [a,b] of edges) {
        const pair=[indices[a],indices[b]].sort((x,y)=>x-y), key=pair.join(',');
        if(!cellEdges.has(key)||primary) cellEdges.set(key,{pair,primary});
      }
      for(const [element,...p] of model.atoms) {const position=shift(p); atoms.set(element+':'+pointKey(position),[element,...position]);}
      for(const [element,...p] of model.bond_segments) {
        const a=shift(p.slice(0,3)),b=shift(p.slice(3));
        const key=element+':'+[pointKey(a),pointKey(b)].sort().join('|');
        bonds.set(key,[element,...a,...b]);
      }
    }
    displayEdges.push(...cellEdges.values());
    const displayAtoms=[...atoms.values()],displayBonds=[...bonds.values()];
    let envelopeX=0,envelopeY=0,extent=0;
    function include(p,radius=0) {
      const [x,y]=basis.map(v=>dot(v,p));
      envelopeX=Math.max(envelopeX,Math.abs(x)+radius); envelopeY=Math.max(envelopeY,Math.abs(y)+radius);
      extent=Math.max(extent,Math.hypot(...p)+radius);
    }
    displayCorners.forEach(p=>include(p)); displayAtoms.forEach(([e,...p])=>include(p,radii[e]||.35));
    const value={corners,edges,basis,poreAxis,viewDirection:poreAxis===0?'[100]':'[001]',repetitions:repeat,
      displayAtoms,displayBonds,displayCorners,displayEdges,labelCorners,envelopeX,envelopeY,extent};
    prepared.set(model,value); return value;
  }
  function chooseModel(models,random=Math.random) { return models[Math.min(models.length-1,Math.floor(random()*models.length))]; }
  function viewScale(model,width,height,zoom=1) {
    const models=globalThis.MOF_MODELS?.length?globalThis.MOF_MODELS:[model];
    let bounds=catalogs.get(models);
    if(!bounds) {bounds={x:Math.max(...models.map(m=>geometry(m).envelopeX)),y:Math.max(...models.map(m=>geometry(m).envelopeY))};catalogs.set(models,bounds);}
    const padding=Math.min(24,Math.min(width,height)*.2);
    return Math.max(.001,Math.min((width-2*padding)/(2*bounds.x),(height-2*padding)/(2*bounds.y)))*zoom;
  }
  function quaternionMatrix(quaternion=[1,0,0,0]) {
    const [w,x,y,z]=normalize(quaternion);
    return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
      [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
      [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
  }
  function project(model,width,height,camera={}) {
    const scene=geometry(model),matrix=quaternionMatrix(camera.quaternion),scale=viewScale(model,width,height,camera.zoom??1);
    function point(p) {
      const local=scene.basis.map(v=>dot(v,p)),[x,y,z]=matrix.map(v=>dot(v,local));
      return {x:width/2+x*scale,y:height/2-y*scale,z};
    }
    const cell=scene.displayCorners.map(point),shapes=[];
    function segment(a,b,kind,color,width,extra={}) {
      shapes.push({kind,x:a.x,y:a.y,x2:b.x,y2:b.y,z:(a.z+b.z)/2,color,width,...extra});
    }
    for(const {pair:[i,j],primary} of scene.displayEdges) {
      const back=(cell[i].z+cell[j].z)<0;
      segment(cell[i],cell[j],'cell','#52718d',primary?1.4:.8,{alpha:primary?(back?.4:.78):.23,dashed:back});
    }
    for(const [element,...p] of scene.displayBonds) {
      segment(point(p.slice(0,3)),point(p.slice(3)),'bond',colors[element]||'#657786',Math.max(.85,scale*.14));
    }
    for(const [element,...p] of scene.displayAtoms) {
      shapes.push({kind:'atom',...point(p),element,r:Math.max(.95,(radii[element]||.35)*scale),color:colors[element]||'#657786'});
    }
    shapes.sort((a,b)=>a.z-b.z);
    const labels=scene.labelCorners.map(point);
    for(let axis=0;axis<3;axis++) {
      const a=labels[0],b=labels[1<<axis],x=(a.x+b.x)/2,y=(a.y+b.y)/2;
      const dx=x-width/2,dy=y-height/2,length=Math.hypot(dx,dy)||1;
      const endOn=Math.hypot(a.x-b.x,a.y-b.y)<1;
      shapes.push({kind:'label',x:x+dx/length*12,y:y+dy/length*12,text:'abc'[axis]+(endOn?' ⊙':''),color:'#52718d'});
    }
    return shapes;
  }
  function draw(ctx, model, width, height, camera) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    for (const p of project(model, width, height, camera)) {
      ctx.globalAlpha = p.alpha ?? 1;
      if (p.kind === 'bond' || p.kind === 'cell') {
        ctx.setLineDash(p.dashed ? [3, 4] : []);
        ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      } else if (p.kind === 'label') {
        ctx.fillStyle = p.color; ctx.font = 'italic 13px Archivo, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.arc(p.x - p.r * .25, p.y - p.r * .3, p.r * .33, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  function toSvg(model, width = 1000, height = 650, camera = {}) {
    const escape = text => String(text).replace(/[&<>"']/g, ch =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
    const number = n => n.toFixed(3);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(model.name)}</title><desc>Full crystallographic unit cell with periodic bonds. Hydrogen atoms omitted.</desc>`];
    for (const p of project(model, width, height, camera)) {
      if (p.kind === 'cell' || p.kind === 'bond') {
        parts.push(`<path d="M${number(p.x)} ${number(p.y)}L${number(p.x2)} ${number(p.y2)}" stroke="${p.color}" stroke-width="${number(p.width)}" stroke-linecap="round" opacity="${p.alpha ?? 1}"${p.dashed ? ' stroke-dasharray="3 4"' : ''}/>`);
      } else if (p.kind === 'label') {
        parts.push(`<text x="${number(p.x)}" y="${number(p.y)}" fill="${p.color}" font-family="sans-serif" font-size="13" font-style="italic" text-anchor="middle" dominant-baseline="middle">${p.text}</text>`);
      } else {
        parts.push(`<circle cx="${number(p.x)}" cy="${number(p.y)}" r="${number(p.r)}" fill="${p.color}"/><circle cx="${number(p.x - p.r * .25)}" cy="${number(p.y - p.r * .3)}" r="${number(p.r * .33)}" fill="white" opacity=".45"/>`);
      }
    }
    return parts.join('') + '</svg>';
  }
  globalThis.MofRenderer = { project, draw, toSvg, geometry, chooseModel, viewScale, quaternionMatrix };
})();
