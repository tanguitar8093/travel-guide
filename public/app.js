import * as ml from '/vendor/maplibre-gl.mjs';
import {createStyle} from './style.js';
const $=id=>document.getElementById(id);
const places=[
{id:'airport',name:'那霸機場',english:'Naha Airport',coordinates:[127.6513,26.2065],color:'blue'},
{id:'kokusai',name:'國際通',english:'Kokusai Street',coordinates:[127.6843,26.2144],color:'terracotta'},
{id:'shuri',name:'首里城',english:'Shuri Castle',coordinates:[127.7192,26.2170],color:'sand'},
{id:'american',name:'美國村',english:'American Village',coordinates:[127.7562,26.3167],color:'terracotta'},
{id:'manzamo',name:'萬座毛',english:'Cape Manzamo',coordinates:[127.8501,26.5048],color:'green'},
{id:'aquarium',name:'沖繩美麗海水族館',english:'Churaumi Aquarium',coordinates:[127.8780,26.6944],color:'blue'},
{id:'kouri',name:'古宇利海灘',english:'Kouri Beach',coordinates:[128.0200,26.6960],color:'blue'},
];
let searchResults=null,searchVersion=0,searchController,searchTimer;
let trip=[places[0],places[1],places[2]],mode='car',map,dark=false,results={},generation=0,controller,pendingPoint,pendingPlace;
const markers=[];
const emptyGeo=()=>({type:'FeatureCollection',features:[]});
function save(){localStorage.setItem('okinawa-trip-v1',JSON.stringify({trip,mode}));}
try{const saved=JSON.parse(localStorage.getItem('okinawa-trip-v1'));if(saved&&Array.isArray(saved.trip)&&saved.trip.length<=10&&saved.trip.every(p=>typeof p.name==='string'&&p.name.length<=40&&Array.isArray(p.coordinates)&&p.coordinates.length===2&&p.coordinates.every(Number.isFinite)&&p.coordinates[0]>=127.58&&p.coordinates[0]<=128.36&&p.coordinates[1]>=25.98&&p.coordinates[1]<=26.9)){trip=saved.trip;if(['car','walk','bike'].includes(saved.mode))mode=saved.mode;}}catch{}
function duration(seconds){const mins=Math.max(1,Math.ceil(seconds/60));return mins<60?`${mins} 分鐘`:`${Math.floor(mins/60)} 小時 ${mins%60} 分鐘`;}
function km(meters){return `${(meters/1000).toFixed(1)} km`;}
function button(text,aria,fn){const b=document.createElement('button');b.type='button';b.textContent=text;if(aria)b.setAttribute('aria-label',aria);b.onclick=fn;return b;}
function navigationLink(p){
 const link=document.createElement('a');
 const [lng,lat]=p.coordinates;
 link.href=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
 link.target='_blank';link.rel='noopener noreferrer';link.className='navigation-link';
 link.title=`導航到 ${p.name}`;link.setAttribute('aria-label',`導航到 ${p.name}（另開分頁）`);
 link.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/></svg>';
 return link;
}
const OKINAWA_BOUNDS=[[127.58,25.98],[128.36,26.9]];
function showOverview(duration=650){if(!map)return;map.resize();const mobile=map.getContainer().clientWidth<600;map.fitBounds(OKINAWA_BOUNDS,{padding:{top:mobile?65:75,bottom:mobile?85:100,left:mobile?25:55,right:mobile?25:55},bearing:0,pitch:0,duration});}
function fit(){if(!map||!trip.length)return;const bounds=new ml.LngLatBounds();trip.forEach(p=>bounds.extend(p.coordinates));map.fitBounds(bounds,{padding:80,maxZoom:14,duration:650});}
function add(p){if(p.needsName){pendingPoint=p.coordinates;pendingPlace=p;$('custom-name').value='';$('custom-coordinates').textContent=`${p.coordinates[1].toFixed(6)}, ${p.coordinates[0].toFixed(6)}`;$('add-dialog').showModal();return;}if(trip.length>=10){$('route-summary').textContent='每份行程最多 10 個地點。';return;}if(trip.some(item=>item.id===p.id))return;trip.push(p);changed();}
function changed(){save();render();refreshRoutes();}
function render(){
 $('itinerary').replaceChildren();$('trip-empty').hidden=trip.length>0;
 trip.forEach((p,i)=>{const li=document.createElement('li');const n=document.createElement('span');n.className='stop-number';n.textContent=i+1;const name=button(p.name,null,()=>map?.flyTo({center:p.coordinates,zoom:14}));name.className='stop-name';const controls=document.createElement('span');controls.className='stop-controls';const up=button('↑',`上移 ${p.name}`,()=>{[trip[i-1],trip[i]]=[trip[i],trip[i-1]];changed();});up.disabled=i===0;const down=button('↓',`下移 ${p.name}`,()=>{[trip[i],trip[i+1]]=[trip[i+1],trip[i]];changed();});down.disabled=i===trip.length-1;controls.append(up,down,button('×',`移除 ${p.name}`,()=>{trip.splice(i,1);changed();}));li.append(n,name,navigationLink(p),controls);$('itinerary').append(li);});
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
 renderPlaces();renderMarkers();
}
function renderPlaces(){const q=$('search').value.trim().toLowerCase();const list=q?(searchResults||[]):places;$('places').replaceChildren();if(!q)$('result-count').textContent='7 個推薦景點';$('empty').hidden=list.length>0;list.forEach(p=>{const card=document.createElement('div');card.className='place';const icon=document.createElement('span');icon.className=`place-icon ${p.color}`;icon.textContent='◇';const body=document.createElement('span');body.className='place-body';const name=button(p.name,null,()=>map?.flyTo({center:p.coordinates,zoom:14}));name.className='plain';const sub=document.createElement('small');sub.textContent=[p.english||p.names?.name||p.category,p.address].filter(Boolean).join(' · ');if(p.locationKind==='map-center'){const note=document.createElement('small');note.textContent='網址提供的是地圖中心點，未必是店家位置';body.append(note);}if(p.locationKind?.startsWith('approximate')){const note=document.createElement('small');note.textContent='區域近似中心，非入口位置';body.append(note);}if(p.aliases?.length){const alias=document.createElement('small');alias.textContent='中文搜尋別名：'+p.aliases.filter(a=>/[\u3400-\u9fff]/.test(a)).slice(0,3).join('、');body.append(alias);}if(p.source){const link=document.createElement('a');link.href=p.source;link.target='_blank';link.rel='noopener';link.textContent=p.sourceKind==='google-url'?'Google 地圖網址 ↗':'OSM 資料 ↗';link.className='osm-source';body.append(link);}const heading=document.createElement('span');heading.className='place-heading';heading.append(name,navigationLink(p));body.append(heading,sub);const added=trip.some(t=>t.id===p.id);const b=button(added?'已加入':'+ 加入',`加入 ${p.name}`,()=>add(p));b.disabled=added;b.className='add-place';card.append(icon,body,b);$('places').append(card);});}
function renderMarkers(){if(!map)return;markers.forEach(m=>m.remove());markers.length=0;const catalog=$('search').value.trim()?(searchResults||[]):places;const all=[...catalog.filter(p=>!trip.some(t=>t.id===p.id)),...trip];all.forEach(p=>{const i=trip.findIndex(t=>t.id===p.id);const el=button(i<0?'＋':String(i+1),p.name,()=>{});el.className=`marker ${i<0?'catalog-marker':'trip-marker'}`;const div=document.createElement('div');div.className='popup-body';const title=document.createElement('strong');title.textContent=p.name;const heading=document.createElement('div');heading.className='place-heading';heading.append(title,navigationLink(p));div.append(heading);if(i<0)div.append(button('加入行程',null,()=>add(p)));else{const tag=document.createElement('p');tag.textContent=`行程第 ${i+1} 站`;div.append(tag);}el.addEventListener('click',e=>e.stopPropagation());markers.push(new ml.Marker({element:el}).setLngLat(p.coordinates).setPopup(new ml.Popup({offset:24}).setDOMContent(div)).addTo(map));});}
function routeLayer(){if(!map?.getStyle())return;if(!map.getSource('route')){map.addSource('route',{type:'geojson',data:emptyGeo()});map.addLayer({id:'route-outline',type:'line',source:'route',paint:{'line-color':'#ffffff','line-width':7},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'route-line',type:'line',source:'route',paint:{'line-color':'#32766d','line-width':4},layout:{'line-cap':'round','line-join':'round'}});}drawRoute();}
function drawRoute(){const result=results[mode];const features=result?.legs?.map(leg=>({type:'Feature',properties:{},geometry:leg.geometry}))||[];window.routeFeatureCount=features.length;map?.getSource('route')?.setData({type:'FeatureCollection',features});}
function displayResults(){
 $('comparison').replaceChildren();$('legs').replaceChildren();const result=results[mode];
 if(trip.length<2){$('route-summary').textContent='請加入至少兩個地點';drawRoute();return;}
 if(!result){$('route-summary').textContent='正在依道路計算…';return;}
 $('route-summary').textContent=result.error?result.error:`約 ${duration(result.duration)} · ${km(result.distance)}`;
 for(const [key,label] of [['car','汽車'],['walk','步行'],['bike','自行車']]){const r=results[key];const b=button(`${label} · ${r?.error?'無路線':r?duration(r.duration):'計算中'}`,null,()=>{mode=key;save();render();displayResults();drawRoute();});b.className=key===mode?'active':'';$('comparison').append(b);}
 if(result.legs)result.legs.forEach((leg,i)=>{const row=document.createElement('div');const title=document.createElement('strong');title.textContent=`${i+1}. ${trip[i].name} → ${trip[i+1].name}`;const detail=document.createElement('span');detail.textContent=`約 ${duration(leg.duration)} · ${km(leg.distance)}`;const snap=document.createElement('small');snap.textContent=`道路外接駁 ${leg.snapDistances[0]} / ${leg.snapDistances[1]} m（未計入）`;row.append(title,detail,snap);$('legs').append(row);});
 drawRoute();
}
async function refreshRoutes(){
 const current=++generation;controller?.abort();controller=new AbortController();results={};drawRoute();displayResults();if(trip.length<2)return;
 const points=trip.map(p=>p.coordinates);await Promise.all(['car','walk','bike'].map(async key=>{try{const response=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points,mode:key}),signal:controller.signal});const r=await response.json();if(current!==generation)return;results[key]=r;displayResults();}catch(error){if(current!==generation||error.name==='AbortError')return;results[key]={error:'路線服務無法連線，請重新整理後再試。'};displayResults();}}));
}
async function searchPlaces(){
 const version=++searchVersion;searchController?.abort();const q=$('search').value.trim();searchResults=[];$('search-note').textContent='';
 if(!q){renderPlaces();renderMarkers();return;}
 searchController=new AbortController();$('result-count').textContent='搜尋中…';renderPlaces();$('empty').hidden=true;renderMarkers();
 try{
 const isLink=/^(?:https?:\/\/|(?:maps\.app\.goo\.gl|goo\.gl|(?:www\.|maps\.)?google\.(?:com|co\.jp|com\.tw))\/)/i.test(q);
 if(isLink){
   $('result-count').textContent='解析網址中…';
   const r=await fetch('/api/parse-map-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:q}),signal:searchController.signal});
   const data=await r.json();if(version!==searchVersion)return;if(!r.ok)throw Error(data.error||'無法取得地址');
   if(!data.inBounds){$('result-count').textContent='不在此範圍';$('search-note').textContent=`${data.warning} 座標：${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`;$('empty').hidden=true;return;}
   const p={id:`google-url-${data.lat}-${data.lng}`,name:data.name||'未命名地點',needsName:!data.name,coordinates:data.coordinates,color:'blue',source:data.resolved_url,sourceKind:'google-url',locationKind:data.locationKind};
   searchResults=[p];$('result-count').textContent='已解析 1 個地點';$('search-note').textContent=data.locationKind==='map-center'?'這是網址的地圖中心點，請確認位置後再加入行程。':data.name?'已解析座標，可加入行程。':'已解析座標；加入行程時請填寫地點名稱。';renderPlaces();renderMarkers();map?.flyTo({center:p.coordinates,zoom:14});return;
 }
 const r=await fetch('/api/search?q='+encodeURIComponent(q),{signal:searchController.signal});const data=await r.json();if(version!==searchVersion)return;if(!r.ok)throw Error(data.error||'搜尋服務無法使用');searchResults=data.results;$('result-count').textContent=`${data.total} 個結果${data.total>30?' · 顯示前 30 個':''}`;$('search-note').textContent=data.suggestion||'';renderPlaces();renderMarkers();}

 catch(e){if(version!==searchVersion||e.name==='AbortError')return;$('result-count').textContent='搜尋失敗';$('search-note').textContent=e.message;$('empty').hidden=true;}
}
$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(searchTimer);searchPlaces();}});
$('search').oninput=()=>{clearTimeout(searchTimer);++searchVersion;searchController?.abort();searchResults=[];$('search-note').textContent='';renderPlaces();renderMarkers();$('empty').hidden=true;$('result-count').textContent=$('search').value.trim()?'搜尋中…':'';searchTimer=setTimeout(searchPlaces,220);};$('clear-trip').onclick=()=>{trip=[];changed();};
$('modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;save();render();displayResults();drawRoute();};
$('reset').onclick=()=>showOverview();$('fit-trip').onclick=fit;
for(const id of ['light','dark'])$(id).onclick=()=>{if(!map)return;dark=id==='dark';for(const k of ['light','dark']){$(k).classList.toggle('active',id===k);$(k).setAttribute('aria-pressed',String(id===k));}map.setStyle(createStyle(dark));};
$('cancel-add').onclick=()=>$('add-dialog').close();$('add-form').onsubmit=e=>{e.preventDefault();const name=$('custom-name').value.trim();if(!name)return;add({...pendingPlace,id:pendingPlace?.id||crypto.randomUUID(),name,needsName:false,coordinates:pendingPoint,color:pendingPlace?.color||'green'});pendingPlace=null;$('add-dialog').close();};
$('service-info').onclick=()=>$('info-dialog').showModal();$('close-dialog').onclick=()=>$('info-dialog').close();
async function init(){render();try{const r=await fetch('/api/health');if(!r.ok)throw Error('本機沖繩圖資服務無法使用。');const health=await r.json();$('server-status').textContent='沖繩本機服務運行中';$('dataset-info').textContent=`道路資料：${health.dataTimestamp} · 地點資料：${health.placeDataTimestamp||health.dataTimestamp} · ${health.roadCount.toLocaleString()} 條道路 · ${(health.placeCount||0).toLocaleString()} 個可搜尋地點`;
map=new ml.Map({container:'map',style:createStyle(),center:[127.89,26.46],zoom:9.5,minZoom:5,maxZoom:17,pitchWithRotate:false,dragRotate:false,attributionControl:false});window.demoMap=map;showOverview(0);map.addControl(new ml.NavigationControl({showCompass:false}),'bottom-right');map.addControl(new ml.AttributionControl({compact:false}),'bottom-right');map.addControl(new ml.ScaleControl(),'bottom-left');map.on('load',()=>{$('loading').hidden=true;routeLayer();});map.on('style.load',routeLayer);map.on('zoom',()=>{$('zoom-level').textContent=`ZOOM ${map.getZoom().toFixed(1)}`;});map.on('error',e=>{console.error(e.error);$('loading').hidden=true;$('map-error').hidden=false;$('map-error').textContent='地圖載入失敗，請確認本機圖資與 WebGL 可用。';});map.on('click',e=>{if(trip.length>=10){$('route-summary').textContent='每份行程最多 10 個地點。';return;}pendingPlace=null;pendingPoint=[e.lngLat.lng,e.lngLat.lat];$('custom-name').value='';$('custom-coordinates').textContent=`${pendingPoint[1].toFixed(5)}, ${pendingPoint[0].toFixed(5)}`;$('add-dialog').showModal();});renderMarkers();await refreshRoutes();}catch(error){$('loading').hidden=true;$('map-error').hidden=false;$('map-error').textContent=error.message;}}
init();
