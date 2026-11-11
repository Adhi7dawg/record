import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, getDoc, setDoc, addDoc,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const configReady = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("GANTI_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("GANTI_");
let auth, db, currentUser = null, albums = [], tracks = [], rankings = [], trackRankings = [], authMode = "login";
let editingAlbumId = null, editingTrackId = null, editingRankingId = null, editingTrackRankingId = null;
let selectedRankingId = null, selectedTrackRankingId = null, collectionView = "grid", trackView = "grid";
let draggedRankId = null, draggedTrackRankId = null;

const albumDialog = $("album-dialog"), trackDialog = $("track-dialog"), rankingDialog = $("ranking-dialog"), detailDialog = $("detail-dialog"), trackDetailDialog = $("track-detail-dialog");

const owned = () => albums.filter(a => a.status !== "wishlist");
const wishlist = () => albums.filter(a => a.status === "wishlist");
const userAlbums = () => collection(db, "users", currentUser.uid, "albums");
const userTracks = () => collection(db, "users", currentUser.uid, "tracks");
const userRankings = () => collection(db, "users", currentUser.uid, "rankings");
const userTrackRankings = () => collection(db, "users", currentUser.uid, "trackRankings");

const safeText = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials = (s) => (s || "RC").split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase();
const coverMarkup = (a, cls="album-cover") => `<div class="${cls}">${a.coverUrl ? `<img src="${safeText(a.coverUrl)}" alt="${safeText(a.title)} cover" loading="lazy" onerror="this.remove();this.parentElement.innerHTML='<span class=&quot;cover-fallback&quot;>${safeText(initials(a.title))}</span>'">` : `<span class="cover-fallback">${safeText(initials(a.title))}</span>`}</div>`;
const dateValue = (v) => v?.toDate ? v.toDate() : (v ? new Date(v) : null);
const fmtDate = (v) => { const d=dateValue(v); return d && !isNaN(d) ? d.toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "—"; };
function toast(message){const t=$("toast");t.textContent=message;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function setNotice(message){$("notice").textContent=message;$("notice").classList.toggle("hidden",!message)}

function showPage(name){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  $("sidebar").classList.remove("open");
  if(name==="statistics")renderStatistics();
  if(name==="timeline")renderTimeline();
  if(name==="rankings")renderRankings();
  if(name==="track-rankings")renderTrackRankings();
  if(name==="collection")renderCollection();
  if(name==="tracks")renderTracks();
  if(name==="wishlist")renderWishlist();
  window.scrollTo({top:0,behavior:"smooth"});
}

function empty(message){return `<p class="empty-note">${safeText(message)}</p>`}

function card(a, showActions=false){
  const id=safeText(a.id);
  return `<article class="album-card" data-album-id="${id}">
    ${coverMarkup(a)}
    <div class="album-meta"><h3>${safeText(a.title)}</h3><p>${safeText(a.artist)}</p>
    <div class="album-meta-line"><span>${safeText(a.releaseYear || "YEAR UNKNOWN")}</span><span class="rating">${a.rating !== "" && a.rating != null ? `★ ${safeText(a.rating)}` : "UNRATED"}</span></div>
    ${showActions?`<div class="card-actions"><button class="tiny-button" data-edit="${id}">Edit</button><button class="tiny-button" data-delete="${id}">Remove</button></div>`:""}</div></article>`;
}

function trackCard(t, showActions=false){
  const id=safeText(t.id);
  return `<article class="album-card" data-track-id="${id}">
    ${coverMarkup(t)}
    <div class="album-meta"><h3>${safeText(t.title)}</h3><p>${safeText(t.artist)} ${t.albumTitle?`· ${safeText(t.albumTitle)}`:""}</p>
    <div class="album-meta-line"><span>${safeText(t.duration || t.releaseYear || "—")}</span><span class="rating">${t.rating !== "" && t.rating != null ? `★ ${safeText(t.rating)}` : "UNRATED"}</span></div>
    ${showActions?`<div class="card-actions"><button class="tiny-button" data-edit-track="${id}">Edit</button><button class="tiny-button" data-delete-track="${id}">Remove</button></div>`:""}</div></article>`;
}

function miniRow(a){return `<div class="mini-row" data-album-id="${safeText(a.id)}">${a.coverUrl?`<img src="${safeText(a.coverUrl)}" alt="" onerror="this.style.display='none'">`:`<span class="mini-cover">${safeText(initials(a.title))}</span>`}<span><strong>${safeText(a.title)}</strong><small>${safeText(a.artist)}</small></span></div>`}
function miniTrackRow(t){return `<div class="mini-row" data-track-id="${safeText(t.id)}">${t.coverUrl?`<img src="${safeText(t.coverUrl)}" alt="" onerror="this.style.display='none'">`:`<span class="mini-cover">${safeText(initials(t.title))}</span>`}<span><strong>${safeText(t.title)}</strong><small>${safeText(t.artist)}</small></span></div>`}

function bindAlbumCards(container){
  container.querySelectorAll("[data-album-id]").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.closest("button"))return;openDetail(el.dataset.albumId);
  }));
  container.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();openAlbumForm(b.dataset.edit)}));
  container.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();removeAlbum(b.dataset.delete)}));
}

function bindTrackCards(container){
  container.querySelectorAll("[data-track-id]").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.closest("button"))return;openTrackDetail(el.dataset.trackId);
  }));
  container.querySelectorAll("[data-edit-track]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();openTrackForm(b.dataset.editTrack)}));
  container.querySelectorAll("[data-delete-track]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();removeTrack(b.dataset.deleteTrack)}));
}

function renderOverview(){
  const own=owned(), wish=wishlist(), artists=new Set(own.map(a=>a.artist.toLowerCase())).size;
  $("overview-total").textContent=own.length;
  $("overview-tracks-total").textContent=tracks.length;
  $("overview-artists").textContent=artists;
  const rated=own.filter(a=>a.rating!==""&&a.rating!=null&&Number.isFinite(Number(a.rating)));
  $("overview-rating").textContent=rated.length?(rated.reduce((s,a)=>s+Number(a.rating),0)/rated.length).toFixed(1):"—";
  $("nav-owned-count").textContent=own.length;
  $("nav-tracks-count").textContent=tracks.length;
  
  const recentTracks=[...tracks].sort((a,b)=>timeOf(b.dateAdded)-timeOf(a.dateAdded)).slice(0,5);
  $("overview-recent-tracks").innerHTML=recentTracks.length?recentTracks.map(t=>trackCard(t)).join(""):empty("No tracks saved yet. Add your favorite individual songs.");
  bindTrackCards($("overview-recent-tracks"));

  const recent=[...own].sort((a,b)=>timeOf(b.dateAdded)-timeOf(a.dateAdded)).slice(0,5);
  $("recent-grid").innerHTML=recent.length?recent.map(a=>card(a)).join(""):empty("Your shelf is empty. Add the first album to begin your archive.");
  bindAlbumCards($("recent-grid"));
  
  $("overview-wishlist-list").innerHTML=wish.length?wish.slice(0,4).map(miniRow).join(""):empty("No albums on your discovery list yet.");
  $("overview-favorite-tracks").innerHTML=tracks.filter(t=>t.isFavorite).slice(0,4).map(miniTrackRow).join("")||empty("Favorite tracks will appear here.");
  
  bindAlbumCards($("overview-wishlist-list"));
  $("overview-favorite-tracks").querySelectorAll("[data-track-id]").forEach(el=>el.addEventListener("click",()=>openTrackDetail(el.dataset.trackId)));

  const featured=own.find(a=>a.isAlbumOfMonth);
  $("monthly-title").textContent=featured?.title||"Not chosen yet.";
  $("monthly-copy").textContent=featured?`${featured.artist} · ${featured.releaseYear||"Year unknown"}`:"Choose an album from its edit form to feature it here.";
  $("monthly-cover").innerHTML=featured?(featured.coverUrl?`<img src="${safeText(featured.coverUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">`:safeText(initials(featured.title))):"RC";
}

function timeOf(v){const d=dateValue(v);return d&&!isNaN(d)?d.getTime():0}

function renderCollection(){
  const term=$("collection-search").value.toLowerCase().trim(), genre=$("filter-genre").value, year=$("filter-year").value, rating=$("filter-rating").value, sort=$("sort-collection").value;
  let list=owned().filter(a=>(!term||`${a.title} ${a.artist}`.toLowerCase().includes(term))&&(!genre||a.genre===genre)&&(!year||String(a.releaseYear||"")===year)&&(!rating||(a.rating!==""&&a.rating!=null&&Number(a.rating)>=Number(rating))));
  list.sort((a,b)=>sort==="rating"?Number(b.rating||0)-Number(a.rating||0):sort==="year-new"?Number(b.releaseYear||0)-Number(a.releaseYear||0):sort==="year-old"?Number(b.releaseYear||99999)-Number(a.releaseYear||99999):sort==="title"?a.title.localeCompare(b.title):sort==="artist"?a.artist.localeCompare(b.artist):timeOf(b.dateAdded)-timeOf(a.dateAdded));
  $("collection-count").textContent=`${list.length} RECORD${list.length===1?"":"S"} SHOWN`;
  $("collection-grid").classList.toggle("list-view",collectionView==="list");
  $("collection-grid").innerHTML=list.length?list.map(a=>card(a,true)).join(""):empty(owned().length?"No albums match those filters.":"Nothing on the shelf yet. Add an album to get started.");
  bindAlbumCards($("collection-grid"));
  const genres=[...new Set(owned().map(a=>a.genre).filter(Boolean))].sort();
  const years=[...new Set(owned().map(a=>String(a.releaseYear||"")).filter(Boolean))].sort((a,b)=>b-a);
  setOptions($("filter-genre"),genres,"All genres");setOptions($("filter-year"),years,"All years");
}

function renderTracks(){
  const term=$("tracks-search").value.toLowerCase().trim(), genre=$("filter-track-genre").value, artist=$("filter-track-artist").value, year=$("filter-track-year").value, rating=$("filter-track-rating").value, sort=$("sort-tracks").value;
  let list=tracks.filter(t=>(!term||`${t.title} ${t.artist} ${t.albumTitle||""}`.toLowerCase().includes(term))&&(!genre||t.genre===genre)&&(!artist||t.artist===artist)&&(!year||String(t.releaseYear||"")===year)&&(!rating||(t.rating!==""&&t.rating!=null&&Number(t.rating)>=Number(rating))));
  
  list.sort((a,b)=>sort==="rating"?Number(b.rating||0)-Number(a.rating||0):sort==="title"?a.title.localeCompare(b.title):sort==="artist"?a.artist.localeCompare(b.artist):sort==="duration"?(a.duration||"").localeCompare(b.duration):timeOf(b.dateAdded)-timeOf(a.dateAdded));
  
  $("tracks-count").textContent=`${list.length} TRACK${list.length===1?"":"S"} SHOWN`;
  $("tracks-grid").classList.toggle("list-view",trackView==="list");
  $("tracks-grid").innerHTML=list.length?list.map(t=>trackCard(t,true)).join(""):empty(tracks.length?"No tracks match those filters.":"No tracks archived yet. Add your first song.");
  bindTrackCards($("tracks-grid"));

  const genres=[...new Set(tracks.map(t=>t.genre).filter(Boolean))].sort();
  const artists=[...new Set(tracks.map(t=>t.artist).filter(Boolean))].sort();
  const years=[...new Set(tracks.map(t=>String(t.releaseYear||"")).filter(Boolean))].sort((a,b)=>b-a);
  setOptions($("filter-track-genre"),genres,"All genres");
  setOptions($("filter-track-artist"),artists,"All artists");
  setOptions($("filter-track-year"),years,"All years");
}

function setOptions(el,values,first){const old=el.value;el.innerHTML=`<option value="">${first}</option>`+values.map(v=>`<option value="${safeText(v)}">${safeText(v)}</option>`).join("");if(values.includes(old))el.value=old}

function renderWishlist(){
  const list=wishlist().sort((a,b)=>timeOf(b.dateAdded)-timeOf(a.dateAdded));
  $("wishlist-grid").innerHTML=list.length?list.map(a=>`${card(a,true)}<div class="wishlist-note">${a.note?safeText(a.note):""}</div>`).join(""):empty("Your want-to-listen list is clear. Add records you want to hear next.");
  bindAlbumCards($("wishlist-grid"));
}

function renderTimeline(){
  const artist=$("timeline-artist").value.toLowerCase().trim(),genre=$("timeline-genre").value,period=$("timeline-period").value;
  let list=owned().filter(a=>(!artist||a.artist.toLowerCase().includes(artist))&&(!genre||a.genre===genre));
  if(period==="unknown")list=list.filter(a=>!a.releaseYear);
  else if(period==="older")list=list.filter(a=>a.releaseYear&&Number(a.releaseYear)<1970);
  else if(period)list=list.filter(a=>a.releaseYear&&Math.floor(Number(a.releaseYear)/10)*10===Number(period));
  const groups={};list.forEach(a=>{const y=a.releaseYear?String(a.releaseYear):"Unknown Year";(groups[y]??=[]).push(a)});
  const years=Object.keys(groups).sort((a,b)=>a==="Unknown Year"?1:b==="Unknown Year"?-1:Number(b)-Number(a));
  $("timeline-content").innerHTML=years.length?years.map(y=>`<div class="timeline-year ${y==="Unknown Year"?"timeline-unknown":""}"><h2>${safeText(y)}</h2><div class="timeline-albums">${groups[y].map(a=>card(a)).join("")}</div></div>`).join(""):empty("No albums match this timeline filter.");
  bindAlbumCards($("timeline-content"));
  setOptions($("timeline-genre"),[...new Set(owned().map(a=>a.genre).filter(Boolean))].sort(),"All genres");
}

function renderRankings(){
  const host=$("ranking-content");
  if(!rankings.length){host.innerHTML=`<div class="ranking-list-picker">${empty("No rankings yet. Create your first personal list.")}</div><div class="ranking-detail">${empty("Your lists are completely manual — no automatic rating sort.")}</div>`;return}
  if(!rankings.some(r=>r.id===selectedRankingId))selectedRankingId=rankings[0].id;
  const selected=rankings.find(r=>r.id===selectedRankingId);
  host.innerHTML=`<div class="ranking-list-picker">${rankings.map(r=>`<button class="ranking-picker-item ${r.id===selected.id?"active":""}" data-ranking="${safeText(r.id)}"><strong>${safeText(r.title)}</strong><small>${(r.albumIds||[]).length} ALBUMS</small></button>`).join("")}</div>
  <div class="ranking-detail"><div class="ranking-detail-head"><div><p class="eyebrow">YOUR LIST / ${String(rankings.indexOf(selected)+1).padStart(2,"0")}</p><h2>${safeText(selected.title)}</h2><p>${safeText(selected.description||"No description.")}</p></div><div class="card-actions"><button class="tiny-button" id="edit-ranking">Edit</button><button class="tiny-button" id="delete-ranking">Delete list</button></div></div>
  <div class="ranking-items" id="ranking-items">${(selected.albumIds||[]).map((id,i)=>{const a=albums.find(x=>x.id===id);return a?`<div class="ranked-item" draggable="true" data-rank-album="${safeText(id)}"><span class="rank-number">${String(i+1).padStart(2,"0")}</span>${a.coverUrl?`<img src="${safeText(a.coverUrl)}" alt="">`:`<span class="mini-cover">${safeText(initials(a.title))}</span>`}<span><strong>${safeText(a.title)}</strong><small>${safeText(a.artist)}</small></span><button class="tiny-button" data-move-up="${safeText(id)}" aria-label="Move up">↑</button><button class="tiny-button" data-move-down="${safeText(id)}" aria-label="Move down">↓</button><button class="tiny-button remove-rank" data-remove-rank="${safeText(id)}">Remove</button></div>`:""}).join("")||empty("This ranking is empty. Add albums from your collection.")}</div>
  <div class="ranking-add-row"><select id="ranking-add-album"><option value="">Add an album from your collection…</option>${owned().filter(a=>!(selected.albumIds||[]).includes(a.id)).map(a=>`<option value="${safeText(a.id)}">${safeText(a.title)} — ${safeText(a.artist)}</option>`).join("")}</select><button id="ranking-add-button" class="button button-outline">Add</button></div></div>`;
  host.querySelectorAll("[data-ranking]").forEach(b=>b.addEventListener("click",()=>{selectedRankingId=b.dataset.ranking;renderRankings()}));
  $("edit-ranking").onclick=()=>openRankingForm(selected);
  $("delete-ranking").onclick=()=>deleteRanking(selected.id);
  $("ranking-add-button").onclick=()=>addToRanking(selected.id,$("ranking-add-album").value);
  host.querySelectorAll("[data-remove-rank]").forEach(b=>b.onclick=()=>removeFromRanking(selected.id,b.dataset.removeRank));
  host.querySelectorAll("[data-move-up]").forEach(b=>b.onclick=()=>shiftRank(selected.id,b.dataset.moveUp,-1));
  host.querySelectorAll("[data-move-down]").forEach(b=>b.onclick=()=>shiftRank(selected.id,b.dataset.moveDown,1));
  const items=$("ranking-items");
  items.querySelectorAll("[data-rank-album]").forEach(el=>{
    el.addEventListener("dragstart",()=>{draggedRankId=el.dataset.rankAlbum;el.classList.add("dragging")});
    el.addEventListener("dragend",()=>{draggedRankId=null;el.classList.remove("dragging")});
    el.addEventListener("dragover",e=>e.preventDefault());
    el.addEventListener("drop",e=>{e.preventDefault();const target=el.dataset.rankAlbum;if(draggedRankId&&target&&draggedRankId!==target)reorderRanking(selected.id,draggedRankId,target)});
  });
}

function renderTrackRankings(){
  const host=$("track-ranking-content");
  if(!trackRankings.length){host.innerHTML=`<div class="ranking-list-picker">${empty("No track rankings yet. Create your first song list.")}</div><div class="ranking-detail">${empty("Your track lists are completely manual.")}</div>`;return}
  if(!trackRankings.some(r=>r.id===selectedTrackRankingId))selectedTrackRankingId=trackRankings[0].id;
  const selected=trackRankings.find(r=>r.id===selectedTrackRankingId);
  host.innerHTML=`<div class="ranking-list-picker">${trackRankings.map(r=>`<button class="ranking-picker-item ${r.id===selected.id?"active":""}" data-track-ranking="${safeText(r.id)}"><strong>${safeText(r.title)}</strong><small>${(r.trackIds||[]).length} TRACKS</small></button>`).join("")}</div>
  <div class="ranking-detail"><div class="ranking-detail-head"><div><p class="eyebrow">TRACK LIST / ${String(trackRankings.indexOf(selected)+1).padStart(2,"0")}</p><h2>${safeText(selected.title)}</h2><p>${safeText(selected.description||"No description.")}</p></div><div class="card-actions"><button class="tiny-button" id="edit-track-ranking">Edit</button><button class="tiny-button" id="delete-track-ranking">Delete list</button></div></div>
  <div class="ranking-items" id="track-ranking-items">${(selected.trackIds||[]).map((id,i)=>{const t=tracks.find(x=>x.id===id);return t?`<div class="ranked-item" draggable="true" data-rank-track="${safeText(id)}"><span class="rank-number">${String(i+1).padStart(2,"0")}</span>${t.coverUrl?`<img src="${safeText(t.coverUrl)}" alt="">`:`<span class="mini-cover">${safeText(initials(t.title))}</span>`}<span><strong>${safeText(t.title)}</strong><small>${safeText(t.artist)}</small></span><button class="tiny-button" data-move-track-up="${safeText(id)}" aria-label="Move up">↑</button><button class="tiny-button" data-move-track-down="${safeText(id)}" aria-label="Move down">↓</button><button class="tiny-button remove-rank" data-remove-track-rank="${safeText(id)}">Remove</button></div>`:""}).join("")||empty("This ranking is empty. Add tracks from your archive.")}</div>
  <div class="ranking-add-row"><select id="ranking-add-track-select"><option value="">Add a track from your collection…</option>${tracks.filter(t=>!(selected.trackIds||[]).includes(t.id)).map(t=>`<option value="${safeText(t.id)}">${safeText(t.title)} — ${safeText(t.artist)}</option>`).join("")}</select><button id="track-ranking-add-button" class="button button-outline">Add</button></div></div>`;
  host.querySelectorAll("[data-track-ranking]").forEach(b=>b.addEventListener("click",()=>{selectedTrackRankingId=b.dataset.trackRanking;renderTrackRankings()}));
  $("edit-track-ranking").onclick=()=>openRankingForm(selected, true);
  $("delete-track-ranking").onclick=()=>deleteTrackRanking(selected.id);
  $("track-ranking-add-button").onclick=()=>addToTrackRanking(selected.id,$("ranking-add-track-select").value);
  host.querySelectorAll("[data-remove-track-rank]").forEach(b=>b.onclick=()=>removeFromTrackRanking(selected.id,b.dataset.removeTrackRank));
  host.querySelectorAll("[data-move-track-up]").forEach(b=>b.onclick=()=>shiftTrackRank(selected.id,b.dataset.moveTrackUp,-1));
  host.querySelectorAll("[data-move-track-down]").forEach(b=>b.onclick=()=>shiftTrackRank(selected.id,b.dataset.moveTrackDown,1));
  const items=$("track-ranking-items");
  items.querySelectorAll("[data-rank-track]").forEach(el=>{
    el.addEventListener("dragstart",()=>{draggedTrackRankId=el.dataset.rankTrack;el.classList.add("dragging")});
    el.addEventListener("dragend",()=>{draggedTrackRankId=null;el.classList.remove("dragging")});
    el.addEventListener("dragover",e=>e.preventDefault());
    el.addEventListener("drop",e=>{e.preventDefault();const target=el.dataset.rankTrack;if(draggedTrackRankId&&target&&draggedTrackRankId!==target)reorderTrackRanking(selected.id,draggedTrackRankId,target)});
  });
}

function renderStatistics(){
  const own=owned(), rated=own.filter(a=>a.rating!==""&&a.rating!=null), avg=rated.length?(rated.reduce((s,a)=>s+Number(a.rating),0)/rated.length).toFixed(1):"—";
  const trackRated=tracks.filter(t=>t.rating!==""&&t.rating!=null), trackAvg=trackRated.length?(trackRated.reduce((s,t)=>s+Number(t.rating),0)/trackRated.length).toFixed(1):"—";
  const artists=new Set(own.map(a=>a.artist.toLowerCase())).size;
  const genreCounts=countBy(own,a=>a.genre||"Unspecified"),yearCounts=countBy(own,a=>a.releaseYear?String(Math.floor(Number(a.releaseYear)/10)*10)+"s":"Unknown");
  const trackGenreCounts=countBy(tracks,t=>t.genre||"Unspecified");
  const months=countBy(own,a=>{const d=dateValue(a.dateAdded);return d&&!isNaN(d)?d.toLocaleDateString("en-US",{month:"short",year:"numeric"}):"Unknown"});
  const top=[...rated].sort((a,b)=>Number(b.rating)-Number(a.rating))[0];
  const topTrack=[...trackRated].sort((a,b)=>Number(b.rating)-Number(a.rating))[0];

  $("statistics-content").innerHTML=`<div class="stats-grid">
    <div class="stat-card"><span class="eyebrow">TOTAL ALBUMS</span><strong>${own.length}</strong><small>IN YOUR COLLECTION</small></div>
    <div class="stat-card"><span class="eyebrow">TOTAL TRACKS</span><strong>${tracks.length}</strong><small>ARCHIVED SONGS</small></div>
    <div class="stat-card"><span class="eyebrow">UNIQUE ARTISTS</span><strong>${artists}</strong><small>BASED ON ARTIST NAME</small></div>
    <div class="stat-card"><span class="eyebrow">AVG ALBUM RATING</span><strong>${avg}</strong><small>${rated.length} RATED ALBUMS</small></div>
    <div class="stat-card"><span class="eyebrow">AVG TRACK RATING</span><strong>${trackAvg}</strong><small>${trackRated.length} RATED TRACKS</small></div>
    <div class="stat-card"><span class="eyebrow">TOP TRACK</span><strong>${topTrack?safeText(topTrack.rating):"—"}</strong><small>${topTrack?safeText(topTrack.title):"NO RATINGS YET"}</small></div>
  </div>
  ${barChart("ALBUM GENRES",genreCounts)}${barChart("TRACK GENRES",trackGenreCounts)}${barChart("RELEASE DECADES (ALBUMS)",yearCounts)}${barChart("ALBUMS ADDED BY MONTH",months)}`;
}

function countBy(list,fn){return list.reduce((o,x)=>{const k=fn(x);o[k]=(o[k]||0)+1;return o},{})}
function barChart(title,data){const entries=Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,8),max=Math.max(1,...entries.map(x=>x[1]));return `<div class="chart-sheet"><p class="eyebrow">${title}</p>${entries.length?entries.map(([k,v])=>`<div class="bar-row"><span>${safeText(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%"></div></div><b>${v}</b></div>`).join(""):empty("Not enough data yet.")}</div>`}

async function loadData(){
  const [a,t,r,tr]=await Promise.all([
    getDocs(query(userAlbums(),orderBy("dateAdded","desc"))).catch(()=>getDocs(userAlbums())),
    getDocs(query(userTracks(),orderBy("dateAdded","desc"))).catch(()=>getDocs(userTracks())),
    getDocs(userRankings()).catch(()=>getDocs(userRankings())),
    getDocs(userTrackRankings()).catch(()=>getDocs(userTrackRankings()))
  ]);
  albums=a.docs.map(d=>({id:d.id,...d.data()}));
  tracks=t.docs.map(d=>({id:d.id,...d.data()}));
  rankings=r.docs.map(d=>({id:d.id,...d.data()}));
  trackRankings=tr.docs.map(d=>({id:d.id,...d.data()}));
  
  renderOverview();renderCollection();renderTracks();renderWishlist();renderTimeline();renderRankings();renderTrackRankings();
}

function setAuthMode(mode){
  authMode=mode;const reg=mode==="register";
  $("auth-title").textContent=reg?"Create your archive.":"Welcome back.";
  $("auth-kicker").textContent=reg?"START YOUR PERSONAL ARCHIVE":"YOUR PRIVATE ARCHIVE";
  $("auth-subtitle").textContent=reg?"One account. A lifetime of listening.":"Sign in to return to your collection.";
  $("confirm-wrap").classList.toggle("hidden",!reg);$("forgot-password").classList.toggle("hidden",reg);
  $("auth-submit").innerHTML=reg?'Create account <span>↗</span>':'Sign in <span>↗</span>';
  $("auth-switch-copy").innerHTML=reg?'Already have an account? <button id="auth-switch" class="text-button link-button">Sign in</button>':'New here? <button id="auth-switch" class="text-button link-button">Create an account</button>';
  $("auth-password").autocomplete=reg?"new-password":"current-password";
  $("auth-switch").onclick=()=>setAuthMode(reg?"login":"register");$("auth-message").textContent="";
}

async function handleAuth(e){
  e.preventDefault();$("auth-message").textContent="";
  const email=$("auth-email").value.trim(),password=$("auth-password").value;
  try{
    if(authMode==="register"){
      if(password.length<6)throw new Error("Password minimal 6 karakter.");
      if(password!==$("auth-confirm").value)throw new Error("Konfirmasi password tidak cocok.");
      const cred=await createUserWithEmailAndPassword(auth,email,password);
      await setDoc(doc(db,"users",cred.user.uid),{email,createdAt:serverTimestamp()});
    }else await signInWithEmailAndPassword(auth,email,password);
  }catch(err){$("auth-message").textContent=authError(err)}
}

function authError(err){const code=err.code||"";return code.includes("email-already-in-use")?"Email ini sudah terdaftar.":code.includes("invalid-email")?"Format email tidak valid.":code.includes("weak-password")?"Password terlalu lemah.":code.includes("user-not-found")||code.includes("invalid-credential")?"Email atau password salah.":code.includes("too-many-requests")?"Terlalu banyak percobaan. Coba lagi nanti.":err.message||"Terjadi kesalahan."}

function openAlbumForm(id=null,initial=null){
  editingAlbumId=id;const a=id?albums.find(x=>x.id===id):initial||{};
  $("album-modal-kicker").textContent=id?"EDIT YOUR RECORD":"ADD TO ARCHIVE";$("album-modal-title").textContent=id?"Edit album":"Add an album";
  $("album-form").reset();$("lookup-results").innerHTML="";$("album-form-message").textContent="";
  $("album-title").value=a.title||"";$("album-artist").value=a.artist||"";$("album-year").value=a.releaseYear||"";
  $("album-genre").value=a.genre||"";$("album-cover").value=a.coverUrl||"";$("album-listened").value=a.listeningDate||"";
  $("album-rating").value=a.rating??"";$("album-tracks").value=Array.isArray(a.tracklist)?a.tracklist.join("\n"):(a.tracklist||"");
  $("album-review").value=a.review||"";$("album-favorite").checked=!!a.isFavorite;$("album-month").checked=!!a.isAlbumOfMonth;
  if(a.status==="wishlist"){$("album-modal-kicker").textContent="DISCOVERY LIST";$("album-form-message").textContent="Save this record to your collection when ready."}
  albumDialog.showModal();
}

async function saveAlbum(e){
  e.preventDefault();const title=$("album-title").value.trim(),artist=$("album-artist").value.trim();
  if(!title||!artist)return;
  const data={title,artist,releaseYear:$("album-year").value?Number($("album-year").value):null,genre:$("album-genre").value.trim(),coverUrl:$("album-cover").value.trim(),listeningDate:$("album-listened").value,rating:$("album-rating").value===""?null:Number($("album-rating").value),tracklist:$("album-tracks").value.split("\n").map(x=>x.trim()).filter(Boolean),review:$("album-review").value.trim(),isFavorite:$("album-favorite").checked,isAlbumOfMonth:$("album-month").checked,status:$("album-status").value,note:$("album-note").value.trim(),updatedAt:serverTimestamp()};
  if(data.isAlbumOfMonth)await Promise.all(owned().filter(a=>a.id!==editingAlbumId&&a.isAlbumOfMonth).map(a=>updateDoc(doc(userAlbums(),a.id),{isAlbumOfMonth:false})));
  const duplicate=owned().find(a=>a.id!==editingAlbumId&&a.title.toLowerCase()===title.toLowerCase()&&a.artist.toLowerCase()===artist.toLowerCase());
  if(duplicate&&!confirm(`Album "${title}" oleh ${artist} sudah ada. Tetap simpan sebagai album terpisah?`))return;
  try{
    if(editingAlbumId)await updateDoc(doc(userAlbums(),editingAlbumId),data);
    else await addDoc(userAlbums(),{...data,dateAdded:serverTimestamp(),userId:currentUser.uid});
    albumDialog.close();await loadData();toast(editingAlbumId?"Album updated.":"Album added to your archive.");
  }catch(err){$("album-form-message").textContent=err.message}
}

// Track Form Handling
function openTrackForm(id=null){
  editingTrackId=id;const t=id?tracks.find(x=>x.id===id):{};
  $("track-modal-kicker").textContent=id?"EDIT TRACK":"ADD TRACK ARCHIVE";
  $("track-modal-title").textContent=id?"Edit track":"Add a track";
  $("track-form").reset();$("track-lookup-results").innerHTML="";$("track-form-message").textContent="";
  
  const albumSelect=$("track-album-select");
  albumSelect.innerHTML=`<option value="">Select from collection…</option>`+owned().map(a=>`<option value="${safeText(a.id)}" data-cover="${safeText(a.coverUrl||"")}" data-artist="${safeText(a.artist)}" data-album="${safeText(a.title)}" data-year="${safeText(a.releaseYear||"")}" data-genre="${safeText(a.genre||"")}">${safeText(a.title)} — ${safeText(a.artist)}</option>`).join("");

  $("track-title").value=t.title||"";
  $("track-artist").value=t.artist||"";
  $("track-album-title").value=t.albumTitle||"";
  $("track-duration").value=t.duration||"";
  $("track-year").value=t.releaseYear||"";
  $("track-genre").value=t.genre||"";
  $("track-cover").value=t.coverUrl||"";
  $("track-listened").value=t.listeningDate||"";
  $("track-rating").value=t.rating??"";
  $("track-review").value=t.review||"";
  $("track-favorite").checked=!!t.isFavorite;

  if(t.albumId)albumSelect.value=t.albumId;
  albumSelect.onchange=()=>{
    const opt=albumSelect.selectedOptions[0];
    if(opt&&opt.value){
      $("track-album-title").value=opt.dataset.album||"";
      $("track-artist").value=opt.dataset.artist||$("track-artist").value;
      $("track-cover").value=opt.dataset.cover||$("track-cover").value;
      $("track-year").value=opt.dataset.year||$("track-year").value;
      $("track-genre").value=opt.dataset.genre||$("track-genre").value;
    }
  };

  trackDialog.showModal();
}

async function saveTrack(e){
  e.preventDefault();
  const title=$("track-title").value.trim(), artist=$("track-artist").value.trim();
  if(!title||!artist)return;
  const data={
    title, artist,
    albumId:$("track-album-select").value||null,
    albumTitle:$("track-album-title").value.trim(),
    duration:$("track-duration").value.trim(),
    releaseYear:$("track-year").value?Number($("track-year").value):null,
    genre:$("track-genre").value.trim(),
    coverUrl:$("track-cover").value.trim(),
    listeningDate:$("track-listened").value,
    rating:$("track-rating").value===""?null:Number($("track-rating").value),
    review:$("track-review").value.trim(),
    isFavorite:$("track-favorite").checked,
    updatedAt:serverTimestamp()
  };
  try{
    if(editingTrackId)await updateDoc(doc(userTracks(),editingTrackId),data);
    else await addDoc(userTracks(),{...data,dateAdded:serverTimestamp(),userId:currentUser.uid});
    trackDialog.close();await loadData();toast(editingTrackId?"Track updated.":"Track added to archive.");
  }catch(err){$("track-form-message").textContent=err.message}
}

async function lookupTracks(){
  const term=$("track-lookup").value.trim();if(!term)return;
  $("track-lookup-results").innerHTML=empty("Searching MusicBrainz…");
  try{
    const url=`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(term)}&fmt=json&limit=8`;
    const res=await fetch(url,{headers:{"Accept":"application/json"}});if(!res.ok)throw new Error("MusicBrainz is temporarily unavailable.");
    const data=await res.json();const results=data.recordings||[];
    if(!results.length){$("track-lookup-results").innerHTML=empty("No results. Enter track manually.");return}
    $("track-lookup-results").innerHTML=results.map(r=>`<button type="button" class="lookup-result" data-title="${safeText(r.title)}" data-artist="${safeText(r["artist-credit"]?.map(x=>x.name||x.artist?.name).join("")||"")}" data-album="${safeText(r.releases?.[0]?.title||"")}" data-year="${safeText((r.releases?.[0]?.date||"").slice(0,4))}"><span class="mini-cover">${safeText(initials(r.title))}</span><div><strong>${safeText(r.title)}</strong><small>${safeText(r["artist-credit"]?.map(x=>x.name||x.artist?.name).join("")||"Unknown")} · ${safeText(r.releases?.[0]?.title||"Single")}</small></div><span>＋</span></button>`).join("");
    $("track-lookup-results").querySelectorAll("[data-title]").forEach(b=>b.onclick=()=>{
      $("track-title").value=b.dataset.title;
      $("track-artist").value=b.dataset.artist;
      $("track-album-title").value=b.dataset.album;
      $("track-year").value=b.dataset.year;
      $("track-lookup").value=b.dataset.title;
      toast("Track details imported. Review and save.");
    });
  }catch(err){$("track-lookup-results").innerHTML=empty(`${err.message} Enter manually.`)}
}

async function lookupAlbums(){
  const term=$("album-lookup").value.trim();if(!term)return;
  $("lookup-results").innerHTML=empty("Searching MusicBrainz…");
  try{
    const url=`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(term)}&fmt=json&limit=8`;
    const res=await fetch(url,{headers:{"Accept":"application/json"}});if(!res.ok)throw new Error("MusicBrainz is temporarily unavailable.");
    const data=await res.json();const results=data["release-groups"]||[];
    if(!results.length){$("lookup-results").innerHTML=empty("No results. You can enter the album manually.");return}
    $("lookup-results").innerHTML=results.map(r=>`<button type="button" class="lookup-result" data-mbid="${safeText(r.id)}" data-title="${safeText(r.title)}" data-artist="${safeText(r["artist-credit"]?.map(x=>x.name||x.artist?.name).join("")||"")}" data-year="${safeText((r["first-release-date"]||"").slice(0,4))}"><span class="mini-cover">${safeText(initials(r.title))}</span><div><strong>${safeText(r.title)}</strong><small>${safeText(r["artist-credit"]?.map(x=>x.name||x.artist?.name).join("")||"Unknown artist")} · ${safeText((r["first-release-date"]||"").slice(0,4)||"Year unknown")}</small></div><span>＋</span></button>`).join("");
    $("lookup-results").querySelectorAll("[data-mbid]").forEach(b=>b.onclick=async()=>{
      $("album-title").value=b.dataset.title;$("album-artist").value=b.dataset.artist;$("album-year").value=b.dataset.year;
      $("album-lookup").value=b.dataset.title;
      const cover=`https://coverartarchive.org/release-group/${b.dataset.mbid}/front-250`;
      try{const check=await fetch(cover,{method:"HEAD"});$("album-cover").value=check.ok?cover:""}catch{$("album-cover").value=""}
      toast("Album details imported. Review and complete the form.");
    });
  }catch(err){$("lookup-results").innerHTML=empty(`${err.message} Add the album manually instead.`)}
}

async function removeAlbum(id){
  const a=albums.find(x=>x.id===id);if(!a||!confirm(`Remove "${a.title}" from your archive?`))return;
  try{
    await deleteDoc(doc(userAlbums(),id));
    await Promise.all(rankings.filter(r=>(r.albumIds||[]).includes(id)).map(r=>updateDoc(doc(userRankings(),r.id),{albumIds:r.albumIds.filter(x=>x!==id),updatedAt:serverTimestamp()})));
    await loadData();toast("Album removed.");
  }catch(err){toast("Could not remove album: "+err.message)}
}

async function removeTrack(id){
  const t=tracks.find(x=>x.id===id);if(!t||!confirm(`Remove "${t.title}" from archive?`))return;
  try{
    await deleteDoc(doc(userTracks(),id));
    await Promise.all(trackRankings.filter(r=>(r.trackIds||[]).includes(id)).map(r=>updateDoc(doc(userTrackRankings(),r.id),{trackIds:r.trackIds.filter(x=>x!==id),updatedAt:serverTimestamp()})));
    await loadData();toast("Track removed.");
  }catch(err){toast("Could not remove track: "+err.message)}
}

function openDetail(id){
  const a=albums.find(x=>x.id===id);if(!a)return;
  $("detail-content").innerHTML=`<div class="modal-head" style="padding:20px 22px 0;border:0;margin:0"><p class="eyebrow">FROM YOUR ARCHIVE</p><button class="icon-button" id="detail-close">×</button></div><div class="detail-inner">${a.coverUrl?`<img class="detail-cover" src="${safeText(a.coverUrl)}" alt="">`:`<div class="detail-cover cover-fallback">${safeText(initials(a.title))}</div>`}<div class="detail-copy"><p class="eyebrow">${a.status==="wishlist"?"WANT TO LISTEN":"ALBUM DETAILS"}</p><h2>${safeText(a.title)}</h2><p class="artist">${safeText(a.artist)}</p><p class="detail-year">${safeText(a.releaseYear||"YEAR UNKNOWN")} · ${safeText(a.genre||"GENRE UNSPECIFIED")}</p><p class="rating">${a.rating!=null?`★ ${safeText(a.rating)} / 10`:"NOT RATED"} ${a.isFavorite?" · ♥ FAVORITE":""}</p><p class="eyebrow" style="margin-top:17px">LISTENING DATE</p><p>${safeText(fmtDate(a.listeningDate))}</p><p class="eyebrow" style="margin-top:15px">TRACKLIST</p><div class="detail-tracklist">${safeText((a.tracklist||[]).join("\n")||"No tracklist added.")}</div><div class="detail-review">${safeText(a.review||"No personal review yet.")}</div><div class="detail-actions"><button class="button button-primary" id="detail-edit">Edit record</button>${a.status==="wishlist"?`<button class="button button-outline" id="detail-move">Move to collection</button>`:""}<button class="button button-outline" id="detail-delete">Remove</button></div></div></div>`;
  $("detail-close").onclick=()=>detailDialog.close();
  $("detail-edit").onclick=()=>{detailDialog.close();openAlbumForm(id)};
  $("detail-delete").onclick=()=>{detailDialog.close();removeAlbum(id)};
  if($("detail-move"))$("detail-move").onclick=async()=>{await updateDoc(doc(userAlbums(),id),{status:"owned",dateAdded:serverTimestamp()});detailDialog.close();await loadData();toast("Moved to your collection.")};
  detailDialog.showModal();
}

function openTrackDetail(id){
  const t=tracks.find(x=>x.id===id);if(!t)return;
  $("track-detail-content").innerHTML=`<div class="modal-head" style="padding:20px 22px 0;border:0;margin:0"><p class="eyebrow">TRACK ARCHIVE</p><button class="icon-button" id="track-detail-close">×</button></div><div class="detail-inner">${t.coverUrl?`<img class="detail-cover" src="${safeText(t.coverUrl)}" alt="">`:`<div class="detail-cover cover-fallback">${safeText(initials(t.title))}</div>`}<div class="detail-copy"><p class="eyebrow">TRACK DETAILS</p><h2>${safeText(t.title)}</h2><p class="artist">${safeText(t.artist)} ${t.albumTitle?`· ${safeText(t.albumTitle)}`:""}</p><p class="detail-year">${safeText(t.releaseYear||"YEAR UNKNOWN")} · ${safeText(t.genre||"GENRE UNSPECIFIED")} ${t.duration?`· ${safeText(t.duration)}`:""}</p><p class="rating">${t.rating!=null?`★ ${safeText(t.rating)} / 10`:"NOT RATED"} ${t.isFavorite?" · ♥ FAVORITE":""}</p><p class="eyebrow" style="margin-top:17px">LISTENING DATE</p><p>${safeText(fmtDate(t.listeningDate))}</p><div class="detail-review">${safeText(t.review||"No personal review yet.")}</div><div class="detail-actions"><button class="button button-primary" id="track-detail-edit">Edit track</button><button class="button button-outline" id="track-detail-delete">Remove</button></div></div></div>`;
  $("track-detail-close").onclick=()=>trackDetailDialog.close();
  $("track-detail-edit").onclick=()=>{trackDetailDialog.close();openTrackForm(id)};
  $("track-detail-delete").onclick=()=>{trackDetailDialog.close();removeTrack(id)};
  trackDetailDialog.showModal();
}

async function openRankingForm(r=null, isTrack=false){
  if(isTrack){
    editingTrackRankingId=r?.id||null;
    $("ranking-modal-title").textContent=r?"Edit track ranking":"New track ranking";
  } else {
    editingRankingId=r?.id||null;
    $("ranking-modal-title").textContent=r?"Edit ranking":"New ranking";
  }
  $("ranking-title").value=r?.title||"";$("ranking-description").value=r?.description||"";$("ranking-form-message").textContent="";
  rankingDialog.showModal();
  rankingDialog.dataset.type=isTrack?"track":"album";
}

async function saveRanking(e){
  e.preventDefault();
  const isTrack=rankingDialog.dataset.type==="track";
  const data={title:$("ranking-title").value.trim(),description:$("ranking-description").value.trim(),updatedAt:serverTimestamp()};
  try{
    if(isTrack){
      if(editingTrackRankingId)await updateDoc(doc(userTrackRankings(),editingTrackRankingId),data);
      else{const ref=await addDoc(userTrackRankings(),{...data,trackIds:[],createdAt:serverTimestamp(),userId:currentUser.uid});selectedTrackRankingId=ref.id}
      rankingDialog.close();await loadData();showPage("track-rankings");toast("Track ranking saved.");
    } else {
      if(editingRankingId)await updateDoc(doc(userRankings(),editingRankingId),data);
      else{const ref=await addDoc(userRankings(),{...data,albumIds:[],createdAt:serverTimestamp(),userId:currentUser.uid});selectedRankingId=ref.id}
      rankingDialog.close();await loadData();showPage("rankings");toast("Ranking saved.");
    }
  }catch(err){$("ranking-form-message").textContent=err.message}
}

async function deleteRanking(id){const r=rankings.find(x=>x.id===id);if(!r||!confirm(`Delete ranking "${r.title}"?`))return;await deleteDoc(doc(userRankings(),id));selectedRankingId=null;await loadData();toast("Ranking deleted.")}
async function deleteTrackRanking(id){const r=trackRankings.find(x=>x.id===id);if(!r||!confirm(`Delete ranking "${r.title}"?`))return;await deleteDoc(doc(userTrackRankings(),id));selectedTrackRankingId=null;await loadData();toast("Ranking deleted.")}

async function addToRanking(rid,aid){if(!aid)return;const r=rankings.find(x=>x.id===rid);if(!r)return;await updateDoc(doc(userRankings(),rid),{albumIds:[...(r.albumIds||[]),aid],updatedAt:serverTimestamp()});await loadData()}
async function addToTrackRanking(rid,tid){if(!tid)return;const r=trackRankings.find(x=>x.id===rid);if(!r)return;await updateDoc(doc(userTrackRankings(),rid),{trackIds:[...(r.trackIds||[]),tid],updatedAt:serverTimestamp()});await loadData()}

async function removeFromRanking(rid,aid){const r=rankings.find(x=>x.id===rid);if(!r)return;await updateDoc(doc(userRankings(),rid),{albumIds:(r.albumIds||[]).filter(x=>x!==aid),updatedAt:serverTimestamp()});await loadData()}
async function removeFromTrackRanking(rid,tid){const r=trackRankings.find(x=>x.id===rid);if(!r)return;await updateDoc(doc(userTrackRankings(),rid),{trackIds:(r.trackIds||[]).filter(x=>x!==tid),updatedAt:serverTimestamp()});await loadData()}

async function reorderRanking(rid,from,to){const r=rankings.find(x=>x.id===rid);if(!r)return;const ids=[...(r.albumIds||[])],i=ids.indexOf(from),j=ids.indexOf(to);if(i<0||j<0)return;ids.splice(i,1);ids.splice(j,0,from);await updateDoc(doc(userRankings(),rid),{albumIds:ids,updatedAt:serverTimestamp()});await loadData()}
async function reorderTrackRanking(rid,from,to){const r=trackRankings.find(x=>x.id===rid);if(!r)return;const ids=[...(r.trackIds||[])],i=ids.indexOf(from),j=ids.indexOf(to);if(i<0||j<0)return;ids.splice(i,1);ids.splice(j,0,from);await updateDoc(doc(userTrackRankings(),rid),{trackIds:ids,updatedAt:serverTimestamp()});await loadData()}

async function shiftRank(rid,albumId,offset){const r=rankings.find(x=>x.id===rid);if(!r)return;const ids=[...(r.albumIds||[])],i=ids.indexOf(albumId),j=i+offset;if(i<0||j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await updateDoc(doc(userRankings(),rid),{albumIds:ids,updatedAt:serverTimestamp()});await loadData()}
async function shiftTrackRank(rid,trackId,offset){const r=trackRankings.find(x=>x.id===rid);if(!r)return;const ids=[...(r.trackIds||[])],i=ids.indexOf(trackId),j=i+offset;if(i<0||j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await updateDoc(doc(userTrackRankings(),rid),{trackIds:ids,updatedAt:serverTimestamp()});await loadData()}

function wire(){
  document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
  $("mobile-menu").onclick=()=>$("sidebar").classList.toggle("open");
  $("top-add").onclick=$("collection-add").onclick=()=>openAlbumForm();
  $("top-add-track").onclick=$("tracks-add-btn").onclick=()=>openTrackForm();
  $("wishlist-add").onclick=()=>openAlbumForm(null,{status:"wishlist"});
  
  $("auth-form").addEventListener("submit",handleAuth);$("auth-switch").onclick=()=>setAuthMode("register");
  $("toggle-password").onclick=()=>{$("auth-password").type=$("auth-password").type==="password"?"text":"password";$("toggle-password").textContent=$("auth-password").type==="password"?"SHOW":"HIDE"};
  $("forgot-password").onclick=async()=>{const email=$("auth-email").value.trim();if(!email){$("auth-message").textContent="Masukkan email terlebih dahulu.";return}try{await sendPasswordResetEmail(auth,email);$("auth-message").textContent="Link reset password telah dikirim ke email."; $("auth-message").classList.add("success")}catch(e){$("auth-message").textContent=authError(e)}};
  $("logout-button").onclick=()=>signOut(auth);
  
  $("album-form").addEventListener("submit",saveAlbum);$("lookup-button").onclick=lookupAlbums;$("album-lookup").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();lookupAlbums()}});
  $("track-form").addEventListener("submit",saveTrack);$("track-lookup-button").onclick=lookupTracks;$("track-lookup").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();lookupTracks()}});
  
  $("new-ranking").onclick=()=>openRankingForm(null, false);
  $("new-track-ranking").onclick=()=>openRankingForm(null, true);
  $("ranking-form").addEventListener("submit",saveRanking);
  
  $("collection-search").oninput=renderCollection;$("filter-genre").onchange=renderCollection;$("filter-year").onchange=renderCollection;$("filter-rating").onchange=renderCollection;$("sort-collection").onchange=renderCollection;
  $("tracks-search").oninput=renderTracks;$("filter-track-genre").onchange=renderTracks;$("filter-track-artist").onchange=renderTracks;$("filter-track-year").onchange=renderTracks;$("filter-track-rating").onchange=renderTracks;$("sort-tracks").onchange=renderTracks;
  
  $("timeline-artist").oninput=renderTimeline;$("timeline-genre").onchange=renderTimeline;$("timeline-period").onchange=renderTimeline;
  
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{collectionView=b.dataset.view;document.querySelectorAll("[data-view]").forEach(x=>x.classList.toggle("active",x===b));renderCollection()});
  document.querySelectorAll("[data-track-view]").forEach(b=>b.onclick=()=>{trackView=b.dataset.trackView;document.querySelectorAll("[data-track-view]").forEach(x=>x.classList.toggle("active",x===b));renderTracks()});
  
  document.querySelectorAll(".close-modal").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));
  $("today-label").textContent=new Date().toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
}

function boot(){
  wire();
  if(!configReady){setNotice("Firebase belum dikonfigurasi. Isi firebase-config.js mengikuti panduan README.md, lalu buka website melalui hosting atau local web server. Login dan penyimpanan belum aktif.");$("auth-screen").classList.remove("hidden");$("auth-message").textContent="Setup diperlukan: lengkapi firebase-config.js terlebih dahulu.";return}
  try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
    onAuthStateChanged(auth,async user=>{
      currentUser=user;
      $("auth-screen").classList.toggle("hidden",!!user);$("app").classList.toggle("hidden",!user);
      if(user){$("sidebar-email").textContent=user.email||"Your account";$("settings-email").textContent=user.email||"";setNotice("");try{await setDoc(doc(db,"users",user.uid),{email:user.email,updatedAt:serverTimestamp()},{merge:true});await loadData()}catch(err){setNotice("Gagal memuat data: "+err.message)}}
    });
  }catch(err){setNotice("Firebase configuration tidak valid: "+err.message)}
}
boot();
