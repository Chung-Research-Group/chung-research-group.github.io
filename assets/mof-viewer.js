(() => {
  'use strict';
  const instances=new Map();
  let catalog;
  function loadCatalog(url) {
    return catalog ||= fetch(url).then(response=>{
      if(!response.ok) throw new Error('MOF catalog could not be loaded.');
      return response.json();
    }).then(models=>{globalThis.MOF_MODELS=models;return models;});
  }
  async function init(figure) {
    if(instances.has(figure)||!globalThis.MofRenderer) return;
    instances.set(figure,()=>{});
    try {await loadCatalog(figure.dataset.mofViewer);} catch {instances.delete(figure);return;}
    if(!figure.isConnected) {instances.delete(figure);return;}
    let model=MofRenderer.chooseModel(globalThis.MOF_MODELS),scene=MofRenderer.geometry(model);
    const canvas=figure.querySelector('canvas'),poster=figure.querySelector('.mof-poster');
    const link=figure.querySelector('[data-mof-cif]'),source=figure.querySelector('[data-mof-source]');
    const select=figure.querySelector('[data-mof-select]'),details=figure.querySelector('.mof-cell-details');
    const scaleLine=figure.querySelector('.mof-scale-line'),interact=figure.querySelector('[data-mof-interact]');
    const hint=figure.querySelector('.mof-hint');
    let ctx;
    try {ctx=canvas.getContext('2d');} catch {ctx=null;}
    let width=1,height=1,frame=0,destroyed=false,touchMode=false;
    // A gentle tilt keeps the pore opening legible while showing cell depth.
    const tiltX=-7*Math.PI/360,tiltY=12*Math.PI/360;
    const initialQuaternion=[Math.cos(tiltY)*Math.cos(tiltX),Math.cos(tiltY)*Math.sin(tiltX),Math.sin(tiltY)*Math.cos(tiltX),-Math.sin(tiltY)*Math.sin(tiltX)];
    const camera={quaternion:initialQuaternion.slice(),zoom:1},pointers=new Map(),listeners=[];
    const touchLayout=matchMedia('(max-width:840px), (pointer:coarse)');
    function listen(element,type,handler,options) {
      if(!element) return;
      element.addEventListener(type,handler,options);
      listeners.push(()=>element.removeEventListener(type,handler,options));
    }
    function updateHint() {
      if(hint) hint.textContent=touchLayout.matches
        ? (touchMode?'Drag to rotate · Pinch to zoom':'Scroll to browse · Enable touch rotation to interact')
        : 'Drag to rotate · Shift + scroll to zoom';
    }
    function clearPointers() {
      for(const id of pointers.keys()) {
        try {if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);} catch {}
      }
      pointers.clear();delete figure.dataset.dragging;
    }
    function setTouchMode(enabled) {
      touchMode=!!enabled;figure.dataset.mofTouch=String(touchMode);
      clearPointers();
      if(interact) {
        const label=touchMode?'Return to page scrolling':'Enable touch rotation';
        interact.setAttribute('aria-label',label);interact.setAttribute('title',label);
        interact.setAttribute('aria-pressed',String(touchMode));
        interact.textContent=touchMode?'Scroll':'Rotate';
      }
      updateHint();
    }
    function updateModel() {
      scene=MofRenderer.geometry(model);
      const description=model.name+': '+scene.repetitions.join(' × ')+' periodic unit cells, pore direction '+scene.viewDirection+', initial view gently tilted for depth; hydrogen atoms omitted.';
      figure.dataset.mofName=model.name;figure.dataset.mofSlug=model.slug;
      figure.dataset.mofView=scene.viewDirection;figure.dataset.mofRepetitions=scene.repetitions.join('x');
      if(select) select.value=model.slug;
      if(link) {link.textContent='CIF';link.href=model.download_url||model.source_url;link.setAttribute('aria-label','Download '+model.name+' CIF');}
      if(source) {source.textContent='Source';source.href=model.source_url;source.setAttribute('aria-label','Structure source for '+model.name);}
      if(details) details.textContent=' · '+scene.repetitions.join(' × ')+' cells · PBC · H atoms omitted';
      poster.alt=description;
      canvas.setAttribute('aria-label',description+' Drag or use arrow keys to rotate; Shift + scroll or use plus/minus to zoom. For touch rotation and pinch, enable touch rotation. Home resets the pore view.');
    }
    if(select) {
      select.replaceChildren(...globalThis.MOF_MODELS.map(item=>{
        const option=document.createElement('option');
        option.value=item.slug;option.textContent=item.name;return option;
      }));
    }
    function updateScale(bounds) {
      if(scaleLine) {
        const cssToScreen=bounds.width/canvas.clientWidth||1;
        scaleLine.style.width=(10*MofRenderer.viewScale(model,width,height,camera.zoom)/cssToScreen)+'px';
      }
    }
    function draw() {
      frame=0;
      if(destroyed||!figure.isConnected) return;
      if(ctx) MofRenderer.draw(ctx,model,width,height,camera);
      else poster.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(MofRenderer.toSvg(model,width,height,camera));
      updateScale(canvas.getBoundingClientRect());
    }
    function invalidate() {if(!frame&&!destroyed) frame=requestAnimationFrame(draw);}
    function resize() {
      if(!figure.isConnected) {destroy();return;}
      const bounds=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
      width=Math.max(1,bounds.width);height=Math.max(1,bounds.height);
      if(ctx) {canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
      draw();
    }
    function multiply(a,b) {
      const [w,x,y,z]=a,[v,i,j,k]=b;
      const q=[w*v-x*i-y*j-z*k,w*i+x*v+y*k-z*j,w*j-x*k+y*v+z*i,w*k+x*j-y*i+z*v];
      const length=Math.hypot(...q);return q.map(n=>n/length);
    }
    function rotate(dx,dy) {
      const speed=3/Math.max(120,Math.min(width,height)),x=-dy*speed/2,y=dx*speed/2;
      camera.quaternion=multiply([Math.cos(y),0,Math.sin(y),0],multiply([Math.cos(x),Math.sin(x),0,0],camera.quaternion));
      invalidate();
    }
    function zoom(factor) {camera.zoom=Math.max(.35,Math.min(4,camera.zoom*factor));invalidate();}
    function reset() {camera.quaternion=initialQuaternion.slice();camera.zoom=1;setTouchMode(false);invalidate();}
    function distance() {const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;}
    function down(event) {
      if((event.pointerType==='mouse'&&event.button!==0)||(event.pointerType==='touch'&&!touchMode)) return;
      event.preventDefault();canvas.focus({preventScroll:true});
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      try {canvas.setPointerCapture(event.pointerId);} catch {}
      figure.dataset.dragging='true';
    }
    function move(event) {
      const previous=pointers.get(event.pointerId);if(!previous) return;
      const before=distance();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===1) rotate(event.clientX-previous.x,event.clientY-previous.y);
      else if(pointers.size===2&&before>0) zoom(distance()/before);
    }
    function up(event) {
      pointers.delete(event.pointerId);
      if(!pointers.size) delete figure.dataset.dragging;
    }
    function wheel(event) {
      if(!event.shiftKey) return;
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?height:1);
      zoom(Math.exp(-Math.max(-600,Math.min(600,delta))*.0015));
    }
    function key(event) {
      const rotations={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]};
      if(rotations[event.key]) {event.preventDefault();rotate(...rotations[event.key]);}
      else if(['+','='].includes(event.key)) {event.preventDefault();zoom(1.2);}
      else if(['-','_'].includes(event.key)) {event.preventDefault();zoom(1/1.2);}
      else if(event.key==='Home') {event.preventDefault();reset();}
    }
    listen(select,'change',()=>{
      const chosen=globalThis.MOF_MODELS.find(item=>item.slug===select.value);
      if(chosen) {model=chosen;reset();updateModel();}
    });
    listen(figure.querySelector('[data-mof-zoom-in]'),'click',()=>zoom(1.2));
    listen(figure.querySelector('[data-mof-zoom-out]'),'click',()=>zoom(1/1.2));
    listen(figure.querySelector('[data-mof-reset]'),'click',reset);
    listen(touchLayout,'change',updateHint);
    setTouchMode(false);updateModel();
    if(ctx) {
      listen(canvas,'pointerdown',down);listen(canvas,'pointermove',move);
      for(const type of ['pointerup','pointercancel','lostpointercapture']) listen(canvas,type,up);
      listen(canvas,'wheel',wheel,{passive:false});listen(canvas,'keydown',key);
      listen(interact,'click',()=>setTouchMode(!touchMode));
      figure.dataset.mofReady='true';poster.setAttribute('aria-hidden','true');
    } else {figure.dataset.mofFallback='true';if(interact) interact.hidden=true;}
    const resizeObserver=new ResizeObserver(resize);
    function destroy() {
      if(destroyed) return;
      destroyed=true;cancelAnimationFrame(frame);resizeObserver.disconnect();listeners.forEach(remove=>remove());clearPointers();instances.delete(figure);
    }
    instances.set(figure,destroy);
    resizeObserver.observe(figure.querySelector('.mof-stage'));resize();
  }
  function scan(root) {
    if(root.matches?.('[data-mof-viewer]')) init(root);
    root.querySelectorAll?.('[data-mof-viewer]').forEach(init);
  }
  function boot() {
    scan(document);
    new MutationObserver(records=>{
      for(const record of records) for(const node of record.addedNodes) if(node.nodeType===1) scan(node);
      for(const [figure,destroy] of instances) if(!figure.isConnected) destroy();
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
