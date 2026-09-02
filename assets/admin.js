let token = localStorage.getItem('fcm_admin_token') || '';
let quotes = [];
let socket = null;
const $ = id => document.getElementById(id);

function showApp() { $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden'); }
function showLogin() { $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden'); }
function authHeaders() { return {'Authorization': `Bearer ${token}`}; }

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginError').textContent = '';
  try {
    const r = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});
    const data = await r.json();
    if(!r.ok) throw new Error(data.detail || 'Login failed');
    token=data.token; localStorage.setItem('fcm_admin_token',token); showApp(); await loadQuotes(); await loadReviews(); connectRealtime();
  } catch(err){$('loginError').textContent=err.message}
});
$('logout').addEventListener('click',()=>{token='';localStorage.removeItem('fcm_admin_token');socket?.close();showLogin()});
$('refresh').addEventListener('click',loadQuotes);
$('search').addEventListener('input',render);
$('statusFilter').addEventListener('change',loadQuotes);
$('closeModal').addEventListener('click',()=> $('detailModal').classList.add('hidden'));
$('detailModal').addEventListener('click',e=>{if(e.target.id==='detailModal')$('detailModal').classList.add('hidden')});

async function loadQuotes(){
  if(!token)return;
  const params=new URLSearchParams(); const status=$('statusFilter').value; const search=$('search').value.trim(); if(status)params.set('status',status); if(search)params.set('search',search);
  try{const r=await fetch('/api/quotes?'+params,{headers:authHeaders()}); if(r.status===401){logout();return} const data=await r.json(); quotes=data.quotes||[]; render(); $('lastUpdated').textContent='Updated '+new Date().toLocaleTimeString();}catch(err){$('lastUpdated').textContent='Unable to load data'}
}
function render(){
  const search=$('search').value.trim().toLowerCase(); const status=$('statusFilter').value;
  let rows=quotes.filter(q=>!status||q.status===status).filter(q=>!search||[q.customer_name,q.phone,q.email,q.service_type,q.pickup_suburb,q.dropoff_suburb].some(v=>String(v||'').toLowerCase().includes(search)));
  $('quotesBody').innerHTML=rows.length?rows.map(q=>`<tr><td><strong>${esc(q.customer_name)}</strong><br><small>${esc(q.phone)}</small></td><td>${esc(q.service_type)}</td><td class="route">${esc(q.pickup_suburb)} → ${esc(q.dropoff_suburb)}</td><td>${q.move_date?formatDate(q.move_date):'—'}</td><td><select class="status-select" data-status-id="${q.id}">${['New','Contacted','Quoted','Booked','Completed','Cancelled'].map(s=>`<option ${s===q.status?'selected':''}>${s}</option>`).join('')}</select></td><td><button class="view-btn" data-view-id="${q.id}">View</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">No matching quote requests.</td></tr>';
  $('quotesBody').querySelectorAll('[data-status-id]').forEach(el=>el.addEventListener('change',()=>updateStatus(el.dataset.statusId,el.value)));
  $('quotesBody').querySelectorAll('[data-view-id]').forEach(el=>el.addEventListener('click',()=>showDetail(el.dataset.viewId)));
  updateStats();
}
function updateStats(){ $('total').textContent=quotes.length; $('newCount').textContent=quotes.filter(q=>q.status==='New').length; $('contacted').textContent=quotes.filter(q=>q.status==='Contacted').length; $('quoted').textContent=quotes.filter(q=>q.status==='Quoted').length; $('booked').textContent=quotes.filter(q=>q.status==='Booked').length; }
async function updateStatus(id,status){
  try{const r=await fetch('/api/quotes/'+id+'/status',{method:'PATCH',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({status})}); if(!r.ok){const d=await r.json();throw new Error(d.detail||'Update failed')} const data=await r.json(); upsert(data.quote); render();}catch(e){alert(e.message);loadQuotes()}
}
function upsert(q){const i=quotes.findIndex(x=>x.id===q.id);if(i<0)quotes.unshift(q);else quotes[i]=q;}
function showDetail(id){const q=quotes.find(x=>x.id===id);if(!q)return;$('detailContent').innerHTML=`<div class="detail-grid"><div><small>Customer</small><b>${esc(q.customer_name)}</b></div><div><small>Phone</small><b>${esc(q.phone)}</b></div><div><small>Email</small><b>${esc(q.email)}</b></div><div><small>Service</small><b>${esc(q.service_type)}</b></div><div><small>Pickup</small><b>${esc(q.pickup_suburb)}</b></div><div><small>Drop-off</small><b>${esc(q.dropoff_suburb)}</b></div><div><small>Move date</small><b>${q.move_date?formatDate(q.move_date):'Not specified'}</b></div><div><small>Status</small><b>${esc(q.status)}</b></div></div><div class="detail-message"><b>Additional details</b><br>${esc(q.message||'No additional details.')}</div>`;$('detailModal').classList.remove('hidden')}
function connectRealtime(){
  if(!token)return; socket?.close(); const protocol=location.protocol==='https:'?'wss':'ws'; socket=new WebSocket(`${protocol}://${location.host}/ws/admin?token=${encodeURIComponent(token)}`);
  socket.onopen=()=>{$('liveDot').textContent='● Live';$('liveDot').className='online'};
  socket.onclose=()=>{$('liveDot').textContent='● Offline';$('liveDot').className='offline'; if(token)setTimeout(connectRealtime,2500)};
  socket.onerror=()=>socket.close();
  socket.onmessage=e=>{try{const event=JSON.parse(e.data);if(event.type==='quote_created'||event.type==='quote_updated'){upsert(event.quote);render();$('lastUpdated').textContent='Live update '+new Date().toLocaleTimeString();}}catch(_) {}};
}
async function loadReviews(){try{const r=await fetch('/api/admin/reviews',{headers:authHeaders()});if(!r.ok)return;const d=await r.json();$('reviewsAdmin').innerHTML=d.reviews?.length?d.reviews.map(reviewHtml).join(''):'<div class="empty">No reviews yet.</div>';bindReviewButtons()}catch(_) {}}
function reviewHtml(r){return `<div class="review-item"><div><b>${esc(r.customer_name)} — ${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</b><p class="review-text">${esc(r.review_text)}</p></div><div class="review-actions"><button class="${r.approved?'unapprove':'approve'}" data-review-id="${r.id}" data-approved="${r.approved?'false':'true'}">${r.approved?'Hide':'Approve'}</button></div></div>`}
function bindReviewButtons(){$('reviewsAdmin').querySelectorAll('[data-review-id]').forEach(b=>b.addEventListener('click',async()=>{await fetch('/api/admin/reviews/'+b.dataset.reviewId+'?approved='+b.dataset.approved,{method:'PATCH',headers:authHeaders()});loadReviews()}))}
function formatDate(s){const d=new Date(s+'T00:00:00');return d.toLocaleDateString()}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function logout(){token='';localStorage.removeItem('fcm_admin_token');socket?.close();showLogin()}
if(token){showApp();loadQuotes();loadReviews();connectRealtime()}else showLogin();
