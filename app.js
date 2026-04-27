/* ============================================================
   AuxMyPic — Final
   Spotify OAuth: complet in browser (PKCE flow)
   Gemini vision: prin backend (cheia nu e expusa)
   ============================================================ */
(function () {
  'use strict';

  const CFG     = window.AUXMYPIC_CONFIG || {};
  const CLIENT_ID    = CFG.SPOTIFY_CLIENT_ID  || '';
  const REDIRECT_URI = CFG.SPOTIFY_REDIRECT_URI || '';
  const API_URL      = (CFG.API_URL || '').replace(/\/$/, '');

  const SCOPES = 'playlist-read-private playlist-read-collaborative user-read-private user-read-email';

  const state = {
    accessToken:  null,
    playlistId:   null,
    playlistUrl:  null,
    playlistName: null,
    tracks:       [],
    photoFile:    null,
    photoDataUrl: null,
    loading:      false,
  };

  const $ = id => document.getElementById(id);

  // ── PKCE HELPERS ──────────────────────────────────────────────────────────

  function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => chars[b % chars.length]).join('');
  }

  async function generateCodeChallenge(verifier) {
    const data   = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // ── INIT ──────────────────────────────────────────────────────────────────

  (async function init() {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const error  = params.get('error');

    if (error) {
      window.history.replaceState({}, '', window.location.pathname);
      showError('Autentificare Spotify anulată.');
      showConnect();
      return;
    }

    if (code) {
      window.history.replaceState({}, '', window.location.pathname);
      await handleCallback(code);
      return;
    }

    // Check saved token
    const saved = localStorage.getItem('amp_token');
    if (saved) {
      state.accessToken = saved;
      // Quick validation
      try {
        const ok = await spotifyGet('/me');
        if (ok && ok.id) {
          showApp(ok.display_name || ok.id);
          return;
        }
      } catch (_) {}
      localStorage.removeItem('amp_token');
    }

    showConnect();
  })();

  // ── SPOTIFY OAUTH (PKCE) ──────────────────────────────────────────────────

  async function connectSpotify() {
    const verifier  = generateRandomString(64);
    const challenge = await generateCodeChallenge(verifier);
    const stateStr  = generateRandomString(16);

    localStorage.setItem('amp_verifier', verifier);
    localStorage.setItem('amp_state',    stateStr);

    const url = 'https://accounts.spotify.com/authorize'
      + '?response_type=code'
      + '&client_id='     + encodeURIComponent(CLIENT_ID)
      + '&scope='         + encodeURIComponent(SCOPES)
      + '&redirect_uri='  + encodeURIComponent(REDIRECT_URI)
      + '&state='         + encodeURIComponent(stateStr)
      + '&code_challenge_method=S256'
      + '&code_challenge=' + encodeURIComponent(challenge);

    window.location.href = url;
  }

  async function handleCallback(code) {
    const verifier = localStorage.getItem('amp_verifier');
    localStorage.removeItem('amp_verifier');
    localStorage.removeItem('amp_state');

    if (!verifier) { showConnect(); return; }

    showStatus('Se finalizează conectarea...');

    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code:          code,
          redirect_uri:  REDIRECT_URI,
          client_id:     CLIENT_ID,
          code_verifier: verifier,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.access_token)
        throw new Error(data.error_description || 'Token exchange failed');

      state.accessToken = data.access_token;
      localStorage.setItem('amp_token', data.access_token);

      // Save refresh token if present
      if (data.refresh_token)
        localStorage.setItem('amp_refresh', data.refresh_token);

      const me = await spotifyGet('/me');
      showApp(me.display_name || me.id);

    } catch (e) {
      showError('Eroare la conectare: ' + e.message);
      showConnect();
    } finally {
      hideStatus();
    }
  }

  function logout() {
    localStorage.removeItem('amp_token');
    localStorage.removeItem('amp_refresh');
    state.accessToken = null; state.playlistId = null;
    state.photoFile = null; state.tracks = [];
    showConnect();
    $('vibe-section').style.display   = 'none';
    $('tracks-section').style.display = 'none';
  }

  // ── SPOTIFY API CALLS (direct din browser) ────────────────────────────────

  async function spotifyGet(path) {
    const res = await fetch('https://api.spotify.com/v1' + path, {
      headers: { 'Authorization': 'Bearer ' + state.accessToken }
    });
    if (!res.ok) throw new Error('Spotify ' + res.status + ' ' + path);
    return res.json();
  }

  async function loadUserPlaylists() {
    $('playlists-loading').style.display = 'flex';
    $('playlists-grid').style.display    = 'none';

    try {
      let playlists = [];
      let url = '/me/playlists?limit=50';

      while (url) {
        const data = await spotifyGet(url);
        playlists = playlists.concat(data.items.filter(p => p && p.id));
        url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
      }

      renderPlaylistGrid(playlists);
    } catch (e) {
      $('playlists-loading').innerHTML = `<span style="color:var(--danger);font-size:.75rem">Eroare: ${e.message}</span>`;
    }
  }

  async function loadPlaylistTracks(playlistId) {
    let tracks = [];
    let url = '/playlists/' + playlistId + '/tracks?limit=100&fields=items(track(id,name,artists,album,preview_url,external_urls,duration_ms,popularity)),next';

    while (url) {
      const data = await spotifyGet(url);
      const valid = data.items
        .filter(i => i.track && i.track.id)
        .map(i => i.track);
      tracks = tracks.concat(valid);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }

    // Get audio features in batches of 100
    const ids = tracks.map(t => t.id);
    const features = {};
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const data = await spotifyGet('/audio-features?ids=' + batch.join(','));
      (data.audio_features || []).forEach(f => { if (f) features[f.id] = f; });
    }

    return tracks.map(t => ({
      id:           t.id,
      name:         t.name,
      artists:      t.artists.map(a => a.name),
      albumName:    t.album.name,
      albumImageUrl: t.album.images?.[0]?.url || '',
      previewUrl:   t.preview_url,
      spotifyUrl:   t.external_urls?.spotify || '',
      durationMs:   t.duration_ms,
      popularity:   t.popularity,
      energy:       features[t.id]?.energy       ?? 0.5,
      valence:      features[t.id]?.valence      ?? 0.5,
      danceability: features[t.id]?.danceability ?? 0.5,
      acousticness: features[t.id]?.acousticness ?? 0.5,
      tempo:        features[t.id]?.tempo        ?? 120,
      moodLabel:    moodLabel(features[t.id] || {}),
    }));
  }

  function moodLabel(f) {
    const e = f.energy || 0.5, v = f.valence || 0.5;
    if (e >= 0.7 && v >= 0.7) return 'Euphoric';
    if (e >= 0.7 && v >= 0.4) return 'Upbeat';
    if (e >= 0.7)              return 'Intense';
    if (e >= 0.4 && v >= 0.6) return 'Chill';
    if (e >= 0.4 && v >= 0.3) return 'Neutral';
    if (e >= 0.4)              return 'Tense';
    if (v >= 0.6)              return 'Peaceful';
    if (v >= 0.3)              return 'Reflective';
    return 'Melancholic';
  }

  // ── SCREENS ───────────────────────────────────────────────────────────────

  function showConnect() {
    $('screen-connect').style.display = 'block';
    $('screen-app').style.display     = 'none';
    $('user-badge').style.display     = 'none';
  }

  function showApp(username) {
    $('screen-connect').style.display = 'none';
    $('screen-app').style.display     = 'block';
    $('user-badge').style.display     = 'flex';
    $('user-name').textContent        = username;
    loadUserPlaylists();
  }

  // ── PLAYLIST GRID ─────────────────────────────────────────────────────────

  function renderPlaylistGrid(playlists) {
    $('playlists-loading').style.display = 'none';
    const grid = $('playlists-grid');
    grid.innerHTML = '';
    grid.style.display = 'grid';

    playlists.forEach(pl => {
      const img = pl.images?.[0]?.url || '';
      const div = document.createElement('div');
      div.className = 'pl-item';
      div.onclick = () => selectPlaylist(pl);
      div.innerHTML = `
        <img class="pl-img" src="${esc(img)}" alt="" onerror="this.style.background='var(--surface2)';this.removeAttribute('src')">
        <div class="pl-name">${esc(pl.name)}</div>
        <div class="pl-count">${pl.tracks?.total || 0} piese</div>`;
      grid.appendChild(div);
    });
  }

  function selectPlaylist(pl) {
    state.playlistId   = pl.id;
    state.playlistUrl  = pl.external_urls?.spotify || '#';
    state.playlistName = pl.name;
    $('spotify-link').href = state.playlistUrl;

    $('playlists-grid').style.display    = 'none';
    $('selected-playlist').style.display = 'flex';
    $('sel-img').src   = pl.images?.[0]?.url || '';
    $('sel-name').textContent  = pl.name;
    $('sel-count').textContent = (pl.tracks?.total || '?') + ' piese';
    checkReady();
  }

  function changePlaylist() {
    state.playlistId = null; state.tracks = [];
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
  function onFileChange(i) { if (i.files?.[0]) applyPhoto(i.files[0]); }

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
    $('vibe-section').style.display   = 'none';
    $('tracks-section').style.display = 'none';

    try {
      // 1. Load tracks from Spotify directly
      showStatus('Se încarcă piesele din playlist...');
      const tracks = await loadPlaylistTracks(state.playlistId);
      if (tracks.length === 0) throw new Error('Playlistul nu are piese accesibile.');
      state.tracks = tracks;

      // 2. Analyze photo via backend (Gemini key stays private)
      showStatus('AI analizează poza ta... ✦');
      const form = new FormData();
      form.append('image', state.photoFile);

      const vibeRes = await fetch(`${API_URL}/api/analyze`, { method: 'POST', body: form });
      const vibe    = await vibeRes.json();
      if (!vibeRes.ok) throw new Error(vibe.error || 'Eroare analiză imagine');

      // 3. Match tracks client-side
      showStatus('Se potrivesc piesele...');
      const matched = matchTracks(tracks, vibe, 12);

      renderResults(vibe, matched, tracks.length);

    } catch (e) {
      showError('Eroare: ' + e.message);
    } finally {
      state.loading = false;
      $('btn-match').disabled = false;
      hideStatus();
    }
  }

  // ── CLIENT-SIDE MATCHING ──────────────────────────────────────────────────

  function matchTracks(tracks, vibe, topN) {
    return tracks
      .map(t => ({
        ...t,
        vibeScore: computeScore(t, vibe)
      }))
      .sort((a, b) => b.vibeScore - a.vibeScore)
      .slice(0, topN);
  }

  function computeScore(t, v) {
    const dist =
      0.35 * Math.abs(t.energy       - v.energyScore)       +
      0.30 * Math.abs(t.valence      - v.valenceScore)       +
      0.20 * Math.abs(t.danceability - v.danceabilityScore)  +
      0.15 * Math.abs(t.acousticness - v.acousticnessScore);
    return Math.min(100, (1 - dist) * 100 + (t.popularity / 100) * 5);
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  function renderResults(vibe, tracks, total) {
    $('vibe-photo').src = state.photoDataUrl;
    $('vibe-mood').textContent  = vibe.mood || '—';
    $('vibe-color').textContent = vibe.colorPalette || '';
    $('vibe-desc').textContent  = vibe.description  || '';

    const tagsEl = $('vibe-tags');
    tagsEl.innerHTML = '';
    (vibe.keywords||[]).forEach(k => tagsEl.insertAdjacentHTML('beforeend', `<span class="tag">${esc(k)}</span>`));
    (vibe.genreSuggestions||[]).forEach(g => tagsEl.insertAdjacentHTML('beforeend', `<span class="tag genre">${esc(g)}</span>`));

    setBar('energy',  vibe.energyScore);
    setBar('valence', vibe.valenceScore);
    setBar('dance',   vibe.danceabilityScore);
    setBar('acoustic',vibe.acousticnessScore);

    $('vibe-section').style.display = 'block';
    $('tracks-meta').textContent = `${tracks.length} din ${total} piese analizate`;

    const list = $('track-list');
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      const artists = Array.isArray(t.artists) ? t.artists.join(', ') : '';
      const score   = typeof t.vibeScore === 'number' ? t.vibeScore.toFixed(0) : '—';
      const a = document.createElement('a');
      a.className = 'track-item';
      a.href = esc(t.spotifyUrl || '#');
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.style.animationDelay = `${(i * 0.045).toFixed(3)}s`;
      a.innerHTML = `
        ${i < 3 ? `<span class="track-rank gold">✦</span>` : `<span class="track-rank">#${i+1}</span>`}
        <img class="track-cover" src="${esc(t.albumImageUrl||'')}" alt="" onerror="this.style.background='var(--surface2)';this.removeAttribute('src')">
        <div class="track-info">
          <div class="track-name">${esc(t.name)}</div>
          <div class="track-artist">${esc(artists)}</div>
        </div>
        <div class="track-mood">${esc(t.moodLabel||'')}</div>
        <div class="track-score">${score}%</div>`;
      list.appendChild(a);
    });

    $('tracks-section').style.display = 'block';
    setTimeout(() => $('vibe-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    setTimeout(() => {
      animBar('bar-energy',  vibe.energyScore);
      animBar('bar-valence', vibe.valenceScore);
      animBar('bar-dance',   vibe.danceabilityScore);
      animBar('bar-acoustic',vibe.acousticnessScore);
    }, 160);
  }

  // ── UTILS ─────────────────────────────────────────────────────────────────

  function checkReady() { $('btn-match').disabled = !(state.playlistId && state.photoFile); }
  function setBar(id, val) { $(`pct-${id}`).textContent = Math.round((val||0)*100)+'%'; }
  function animBar(id, val) { const el=$(id); if(el) el.style.transform=`scaleX(${Math.max(0,Math.min(1,val||0))})`; }
  function showStatus(msg) { $('statusbar').classList.add('visible'); $('statusbar-text').textContent = msg; }
  function hideStatus() { $('statusbar').classList.remove('visible'); }
  function showError(msg) { const el=$('error-box'); el.textContent=msg; el.classList.add('visible'); }
  function clearError() { $('error-box').classList.remove('visible'); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.App = { connectSpotify, logout, changePlaylist, match, dragOver, dragLeave, drop, onFileChange };
})();
