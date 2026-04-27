/* ============================================================
   AuxMyPic — App Logic cu Spotify OAuth
   ============================================================ */

(function () {
  'use strict';

  const API_URL = (window.AUXMYPIC_CONFIG && window.AUXMYPIC_CONFIG.API_URL)
    ? window.AUXMYPIC_CONFIG.API_URL.replace(/\/$/, '')
    : '';

  const state = {
    sessionId:    null,
    playlistId:   null,
    playlistUrl:  null,
    photoFile:    null,
    photoDataUrl: null,
    loading:      false,
  };

  const $ = (id) => document.getElementById(id);

  // ── INIT ──────────────────────────────────────────────────────────────────
  // Ruleaza la incarcarea paginii

  (function init() {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const auth    = params.get('auth');

    // Curata URL-ul
    if (session || auth) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (auth === 'error') {
      showError('Autentificare Spotify eșuată. Încearcă din nou.');
    }

    if (session && auth === 'success') {
      // Tocmai ne-am intors de la Spotify
      localStorage.setItem('auxmypic_session', session);
      state.sessionId = session;
      showApp();
      return;
    }

    // Verifica sesiune salvata
    const saved = localStorage.getItem('auxmypic_session');
    if (saved) {
      state.sessionId = saved;
      // Verifica daca sesiunea e inca valida
      fetch(`${API_URL}/api/auth/check?sessionId=${saved}`)
        .then(r => r.json())
        .then(data => {
          if (data.authenticated) {
            showApp();
          } else {
            localStorage.removeItem('auxmypic_session');
            showConnect();
          }
        })
        .catch(() => showConnect());
    } else {
      showConnect();
    }
  })();

  // ── UI STATE ──────────────────────────────────────────────────────────────

  function showConnect() {
    $('connect-section').style.display = 'flex';
    $('app-section').style.display = 'none';
    $('spotify-badge').style.display = 'none';
  }

  function showApp() {
    $('connect-section').style.display = 'none';
    $('app-section').style.display = 'block';
    $('spotify-badge').style.display = 'flex';
  }

  // ── SPOTIFY CONNECT ───────────────────────────────────────────────────────

  async function connectSpotify() {
    const btn = $('btn-connect');
    btn.disabled = true;
    btn.textContent = 'Se conectează...';

    try {
      const res  = await fetch(`${API_URL}/api/auth/login`);
      const data = await res.json();
      // Salveaza sessionId inainte de redirect
      localStorage.setItem('auxmypic_pending_session', data.sessionId);
      // Redirecteaza la Spotify
      window.location.href = data.authUrl;
    } catch (e) {
      showError('Nu pot conecta cu Spotify. Verifică conexiunea.');
      btn.disabled = false;
      btn.textContent = 'Conectează Spotify';
    }
  }

  function logout() {
    localStorage.removeItem('auxmypic_session');
    state.sessionId = null;
    state.playlistId = null;
    state.photoFile = null;
    showConnect();
    $('vibe-section').style.display = 'none';
    $('tracks-section').style.display = 'none';
  }

  // ── DRAG & DROP ───────────────────────────────────────────────────────────

  function dragOver(e) { e.preventDefault(); $('dropzone').classList.add('dragover'); }
  function dragLeave(e) { e.preventDefault(); $('dropzone').classList.remove('dragover'); }
  function drop(e) {
    e.preventDefault(); $('dropzone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) applyPhoto(file);
  }
  function onFileChange(input) { if (input.files && input.files[0]) applyPhoto(input.files[0]); }

  function applyPhoto(file) {
    state.photoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      state.photoDataUrl = e.target.result;
      const preview = $('photo-preview');
      preview.src = state.photoDataUrl;
      preview.style.display = 'block';
      $('dropzone-idle').style.display = 'none';
      checkReady();
    };
    reader.readAsDataURL(file);
  }

  // ── LOAD PLAYLIST ─────────────────────────────────────────────────────────

  async function loadPlaylist() {
    const url = $('playlist-url').value.trim();
    if (!url) return;

    clearError();
    const el = $('playlist-status');
    el.className = 'playlist-status'; el.textContent = '';

    const btn = $('btn-load');
    btn.disabled = true; btn.textContent = '...';
    showStatus('Se încarcă playlist-ul...');

    try {
      const res = await fetch(`${API_URL}/api/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: url, sessionId: state.sessionId }),
      });

      const data = await res.json();

      if (res.status === 401) {
        // Token expirat
        localStorage.removeItem('auxmypic_session');
        showConnect();
        throw new Error('Sesiunea Spotify a expirat. Reconectează-te.');
      }

      if (!res.ok) throw new Error(data.error || `Eroare ${res.status}`);

      state.playlistId  = data.playlistId;
      state.playlistUrl = url;
      $('spotify-link').href = url;

      el.textContent = `✓ ${data.trackCount} piese încărcate`;
      el.className = 'playlist-status ok';
      checkReady();

    } catch (err) {
      el.textContent = '✗ ' + err.message;
      el.className = 'playlist-status fail';
      state.playlistId = null;
      checkReady();
    } finally {
      btn.disabled = false; btn.textContent = 'Load';
      hideStatus();
    }
  }

  // ── MATCH ─────────────────────────────────────────────────────────────────

  async function match() {
    if (!state.playlistId || !state.photoFile || state.loading) return;

    state.loading = true;
    clearError();
    $('btn-match').disabled = true;
    $('vibe-section').style.display = 'none';
    $('tracks-section').style.display = 'none';
    showStatus('AI analizează poza ta... ✦');

    try {
      const form = new FormData();
      form.append('image',      state.photoFile);
      form.append('playlistId', state.playlistId);
      form.append('sessionId',  state.sessionId);
      form.append('topN',       '12');

      const res  = await fetch(`${API_URL}/api/match`, { method: 'POST', body: form });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem('auxmypic_session');
        showConnect();
        throw new Error('Sesiunea Spotify a expirat. Reconectează-te.');
      }

      if (!res.ok) throw new Error(data.error || `Eroare ${res.status}`);
      renderResults(data.vibe, data.tracks, data.total);

    } catch (err) {
      showError('Eroare: ' + err.message);
    } finally {
      state.loading = false;
      $('btn-match').disabled = false;
      hideStatus();
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  function renderResults(vibe, tracks, total) {
    $('vibe-photo').src = state.photoDataUrl;
    $('vibe-mood').textContent  = vibe.mood || '—';
    $('vibe-color').textContent = vibe.colorPalette || '';
    $('vibe-desc').textContent  = vibe.description || '';

    const tagsEl = $('vibe-tags');
    tagsEl.innerHTML = '';
    (vibe.keywords || []).forEach(k => tagsEl.insertAdjacentHTML('beforeend', `<span class="tag">${esc(k)}</span>`));
    (vibe.genreSuggestions || []).forEach(g => tagsEl.insertAdjacentHTML('beforeend', `<span class="tag genre">${esc(g)}</span>`));

    setBar('energy', vibe.energyScore); setBar('valence', vibe.valenceScore);
    setBar('dance', vibe.danceabilityScore); setBar('acoustic', vibe.acousticnessScore);

    $('vibe-section').style.display = 'block';

    $('tracks-meta').textContent = `${tracks.length} din ${total} piese analizate`;
    const list = $('track-list');
    list.innerHTML = '';

    tracks.forEach((track, i) => {
      const artists = Array.isArray(track.artists) ? track.artists.join(', ') : (track.artists || '');
      const score   = typeof track.vibeScore === 'number' ? track.vibeScore.toFixed(0) : '—';
      const isTop   = i < 3;
      const a = document.createElement('a');
      a.className = 'track-item';
      a.href = esc(track.spotifyUrl || '#');
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.style.animationDelay = `${(i * 0.045).toFixed(3)}s`;
      a.innerHTML = `
        ${isTop ? `<span class="track-rank gold">✦</span>` : `<span class="track-rank">#${i+1}</span>`}
        <img class="track-cover" src="${esc(track.albumImageUrl||'')}" alt="" onerror="this.style.background='var(--surface2)';this.removeAttribute('src')">
        <div class="track-info">
          <div class="track-name">${esc(track.name)}</div>
          <div class="track-artist">${esc(artists)}</div>
        </div>
        <div class="track-mood">${esc(track.moodLabel||'')}</div>
        <div class="track-score">${score}%</div>`;
      list.appendChild(a);
    });

    $('tracks-section').style.display = 'block';
    setTimeout(() => $('vibe-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    setTimeout(() => {
      animBar('bar-energy', vibe.energyScore); animBar('bar-valence', vibe.valenceScore);
      animBar('bar-dance', vibe.danceabilityScore); animBar('bar-acoustic', vibe.acousticnessScore);
    }, 160);
  }

  function checkReady() { $('btn-match').disabled = !(state.playlistId && state.photoFile); }
  function setBar(id, val) { $(`pct-${id}`).textContent = Math.round((val||0)*100)+'%'; }
  function animBar(id, val) { const el=$(id); if(el) el.style.transform=`scaleX(${Math.max(0,Math.min(1,val||0))})`; }
  function showStatus(msg) { $('statusbar').classList.add('visible'); $('statusbar-text').textContent = msg; }
  function hideStatus() { $('statusbar').classList.remove('visible'); }
  function showError(msg) { const el=$('error-box'); el.textContent=msg; el.classList.add('visible'); }
  function clearError() { $('error-box').classList.remove('visible'); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.App = { connectSpotify, logout, loadPlaylist, match, dragOver, dragLeave, drop, onFileChange };

})();
