/* ============================================================
   AuxMyPic v3 — cu Spotify OAuth + Playlist Picker
   ============================================================ */
(function () {
  'use strict';

  const API = (window.AUXMYPIC_CONFIG && window.AUXMYPIC_CONFIG.API_URL)
    ? window.AUXMYPIC_CONFIG.API_URL.replace(/\/$/, '') : '';

  const state = {
    sessionId:    null,
    playlistId:   null,
    playlistUrl:  null,
    photoFile:    null,
    photoDataUrl: null,
    loading:      false,
  };

  const $ = id => document.getElementById(id);

  // ── INIT ──────────────────────────────────────────────────────────────────

  (function init() {
    const params  = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const auth    = params.get('auth');

    if (session || auth)
      window.history.replaceState({}, '', window.location.pathname);

    if (auth === 'error') showError('Autentificare Spotify eșuată. Încearcă din nou.');

    if (session && auth === 'success') {
      localStorage.setItem('amp_session', session);
      state.sessionId = session;
      showApp();
      return;
    }

    const saved = localStorage.getItem('amp_session');
    if (saved) {
      state.sessionId = saved;
      fetch(`${API}/api/auth/check?sessionId=${saved}`)
        .then(r => r.json())
        .then(d => { if (d.authenticated) showApp(); else { localStorage.removeItem('amp_session'); showConnect(); } })
        .catch(() => showConnect());
    } else {
      showConnect();
    }
  })();

  // ── SCREENS ───────────────────────────────────────────────────────────────

  function showConnect() {
    $('screen-connect').style.display = 'block';
    $('screen-app').style.display     = 'none';
    $('spotify-badge').style.display  = 'none';
  }

  function showApp() {
    $('screen-connect').style.display = 'none';
    $('screen-app').style.display     = 'block';
    $('spotify-badge').style.display  = 'flex';
    loadPlaylists();
  }

  // ── SPOTIFY CONNECT ───────────────────────────────────────────────────────

  async function connectSpotify() {
    const btn = $('btn-connect');
    btn.disabled = true;
    btn.textContent = 'Se conectează...';
    try {
      const res  = await fetch(`${API}/api/auth/login`);
      const data = await res.json();
      window.location.href = data.authUrl;
    } catch (e) {
      showError('Nu pot contacta serverul. Încearcă din nou.');
      btn.disabled = false;
      btn.textContent = 'Conectează Spotify';
    }
  }

  function logout() {
    localStorage.removeItem('amp_session');
    state.sessionId = null; state.playlistId = null; state.photoFile = null;
    showConnect();
    $('vibe-section').style.display = 'none';
    $('tracks-section').style.display = 'none';
  }

  // ── LOAD PLAYLISTS ────────────────────────────────────────────────────────

  async function loadPlaylists() {
    $('playlists-loading').style.display = 'flex';
    $('playlists-grid').style.display    = 'none';

    try {
      const res  = await fetch(`${API}/api/playlists?sessionId=${state.sessionId}`);
      const data = await res.json();

      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(data.error);

      renderPlaylistGrid(data.playlists);
    } catch (e) {
      $('playlists-loading').innerHTML = `<span style="color:var(--danger);font-size:.75rem">${e.message}</span>`;
    }
  }

  function renderPlaylistGrid(playlists) {
    $('playlists-loading').style.display = 'none';
    const grid = $('playlists-grid');
    grid.innerHTML = '';
    grid.style.display = 'grid';

    playlists.forEach(pl => {
      const div = document.createElement('div');
      div.className = 'pl-item';
      div.onclick = () => selectPlaylist(pl);
      div.innerHTML = `
        <img class="pl-img" src="${esc(pl.imageUrl||'')}" alt="" onerror="this.style.background='var(--surface2)';this.removeAttribute('src')">
        <div class="pl-name">${esc(pl.name)}</div>
        <div class="pl-count">${pl.trackCount} piese</div>`;
      grid.appendChild(div);
    });
  }

  function selectPlaylist(pl) {
    state.playlistId  = pl.id;
    state.playlistUrl = pl.spotifyUrl;
    $('spotify-link').href = pl.spotifyUrl || '#';

    $('playlists-grid').style.display    = 'none';
    $('selected-playlist').style.display = 'flex';
    $('sel-img').src   = pl.imageUrl || '';
    $('sel-name').textContent  = pl.name;
    $('sel-count').textContent = pl.trackCount + ' piese';

    checkReady();
  }

  function changePlaylist() {
    state.playlistId = null;
    $('selected-playlist').style.display = 'none';
    $('playlists-grid').style.display    = 'grid';
    checkReady();
  }

  // ── PHOTO ─────────────────────────────────────────────────────────────────

  function dragOver(e)  { e.preventDefault(); $('dropzone').classList.add('dragover'); }
  function dragLeave(e) { e.preventDefault(); $('dropzone').classList.remove('dragover'); }
  function drop(e) {
    e.preventDefault(); $('dropzone').classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) applyPhoto(f);
  }
  function onFileChange(input) { if (input.files && input.files[0]) applyPhoto(input.files[0]); }

  function applyPhoto(file) {
    state.photoFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      state.photoDataUrl = e.target.result;
      $('photo-preview').src = state.photoDataUrl;
      $('photo-preview').style.display = 'block';
      $('dropzone-idle').style.display = 'none';
      checkReady();
    };
    reader.readAsDataURL(file);
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

      const res  = await fetch(`${API}/api/match`, { method: 'POST', body: form });
      const data = await res.json();

      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(data.error || `Eroare ${res.status}`);

      renderResults(data.vibe, data.tracks, data.total);
    } catch (e) {
      showError('Eroare: ' + e.message);
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
    (vibe.keywords||[]).forEach(k => tagsEl.insertAdjacentHTML('beforeend',`<span class="tag">${esc(k)}</span>`));
    (vibe.genreSuggestions||[]).forEach(g => tagsEl.insertAdjacentHTML('beforeend',`<span class="tag genre">${esc(g)}</span>`));

    setBar('energy',vibe.energyScore); setBar('valence',vibe.valenceScore);
    setBar('dance',vibe.danceabilityScore); setBar('acoustic',vibe.acousticnessScore);

    $('vibe-section').style.display = 'block';
    $('tracks-meta').textContent = `${tracks.length} din ${total} piese analizate`;

    const list = $('track-list');
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      const artists = Array.isArray(t.artists) ? t.artists.join(', ') : (t.artists||'');
      const score   = typeof t.vibeScore === 'number' ? t.vibeScore.toFixed(0) : '—';
      const a = document.createElement('a');
      a.className = 'track-item';
      a.href = esc(t.spotifyUrl||'#'); a.target='_blank'; a.rel='noopener noreferrer';
      a.style.animationDelay = `${(i*0.045).toFixed(3)}s`;
      a.innerHTML = `
        ${i<3?`<span class="track-rank gold">✦</span>`:`<span class="track-rank">#${i+1}</span>`}
        <img class="track-cover" src="${esc(t.albumImageUrl||'')}" alt="" onerror="this.style.background='var(--surface2)';this.removeAttribute('src')">
        <div class="track-info"><div class="track-name">${esc(t.name)}</div><div class="track-artist">${esc(artists)}</div></div>
        <div class="track-mood">${esc(t.moodLabel||'')}</div>
        <div class="track-score">${score}%</div>`;
      list.appendChild(a);
    });

    $('tracks-section').style.display = 'block';
    setTimeout(() => $('vibe-section').scrollIntoView({ behavior:'smooth', block:'start' }), 80);
    setTimeout(() => {
      animBar('bar-energy',vibe.energyScore); animBar('bar-valence',vibe.valenceScore);
      animBar('bar-dance',vibe.danceabilityScore); animBar('bar-acoustic',vibe.acousticnessScore);
    }, 160);
  }

  function checkReady() { $('btn-match').disabled = !(state.playlistId && state.photoFile); }
  function setBar(id,val) { $(`pct-${id}`).textContent = Math.round((val||0)*100)+'%'; }
  function animBar(id,val) { const el=$(id); if(el) el.style.transform=`scaleX(${Math.max(0,Math.min(1,val||0))})`; }
  function showStatus(msg) { $('statusbar').classList.add('visible'); $('statusbar-text').textContent=msg; }
  function hideStatus() { $('statusbar').classList.remove('visible'); }
  function showError(msg) { const el=$('error-box'); el.textContent=msg; el.classList.add('visible'); }
  function clearError() { $('error-box').classList.remove('visible'); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.App = { connectSpotify, logout, changePlaylist, match, dragOver, dragLeave, drop, onFileChange };
})();
