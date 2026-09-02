const form = document.getElementById('quoteForm');
const button = document.getElementById('submitBtn');
const statusBox = document.getElementById('formStatus');
const menu = document.getElementById('menu');
const mobileNav = document.getElementById('mobileNav');

menu?.addEventListener('click', () => mobileNav.classList.toggle('open'));
document.querySelectorAll('.mobile-nav a').forEach(a => a.addEventListener('click', () => mobileNav.classList.remove('open')));

function showStatus(message, ok) {
  statusBox.textContent = message;
  statusBox.className = 'status ' + (ok ? 'ok' : 'error');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) { form.reportValidity(); return; }
  button.disabled = true;
  button.textContent = 'Sending...';
  statusBox.className = 'status';
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.move_date) data.move_date = null;
    const response = await fetch('/api/quotes', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || 'Unable to send your quote request.');
    form.reset();
    showStatus('Thanks! Your quote request has been received. We will contact you soon.', true);
  } catch (error) {
    showStatus(error.message || 'Something went wrong. Please call us directly.', false);
  } finally {
    button.disabled = false;
    button.textContent = 'Request My Free Quote';
  }
});

async function loadReviews() {
  try {
    const response = await fetch('/api/reviews');
    if (!response.ok) return;
    const data = await response.json();
    if (!data.reviews?.length) return;
    const list = document.getElementById('reviewsList');
    list.innerHTML = data.reviews.map(r => `<article><div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div><p>${escapeHtml(r.review_text)}</p><b>${escapeHtml(r.customer_name)}</b></article>`).join('');
  } catch (_) {}
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
loadReviews();
