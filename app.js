/* ============================================================
   AuxMyPic — App Logic
   API_URL vine din config.js (window.AUXMYPIC_CONFIG.API_URL)
   ============================================================ */

(function () {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────────
  const API_URL = (window.AUXMYPIC_CONFIG && window.AUXMYPIC_CONFIG.API_URL)
    ? window.AUXMYPIC_CONFIG.API_URL.replace(/\/$/, '')
    : '';

  if (!API_URL) {
    console.error('[AuxMyPic] API_URL nu este setat în config.js!');
  }

  // ── STATE ─────────────────────────────────────────────────────────────────
  const state = {
    playlistId:   null,
    playlistUrl:  null,
    photoFile:    null,
    photoDataUrl: null,
    loading:      false,
  };

  // ── DOM HELPERS ───────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  function showStatus(msg) {
    $('statusbar').classList.add('visible');
    $('statusbar-text').textContent = msg;
  }

  function hideStatus() {
    $('statusbar').classList.remove('visible');
  }

  function showError(msg) {
    const el = $('error-box');
    el.textContent = msg;
    el.classList.add('visible');
  }

  function clearError() {
    $('error-box').classList.remove('visible');
  }

  function setPlaylistStatus(msg, type) {
    const el = $('playlist-status');
    el.textContent = msg;
    el.className = 'playlist-status ' + type;
  }

  function clearPlaylistStatus() {
    const el = $('playlist-status');
    el.className = 'playlist-status';
    el.textContent = '';
  }

  function checkMatchReady() {
    $('btn-match').disabled = !(state.playlistId && state.photoFile);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── DRAG & DROP ───────────────────────────────────────────────────────────
  function dragOver(e) {
    e.preventDefault();
    $('dropzone').classList.add('dragover');
  }

  function dragLeave(e) {
    e.preventDefault();
    $('dropzone').classList.remove('dragover');
  }

  function drop(e) {
    e.preventDefault();
    $('dropzone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) applyPhoto(file);
  }

  function onFileChange(input) {
    if (input.files && input.files[0]) applyPhoto(input.files[0]);
  }

  function applyPhoto(file) {
    state.photoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      state.photoDataUrl = e.target.result;
      const preview = $('photo-preview');
      preview.src = state.photoDataUrl;
      preview.style.display = 'block';
      $('dropzone-idle').style.display = 'none';
      checkMatchReady();
    };
    reader.readAsDataURL(file);
  }

  // ── LOAD PLAYLIST ─────────────────────────────────────────────────────────
  async function loadPlaylist() {
    const url = $('playlist-url').value.trim();
    if (!url) return;

    clearError();
    clearPlaylistStatus();

    const btn = $('btn-load');
    btn.disabled = true;
    btn.textContent = '...';
    showStatus('Se încarcă playlist-ul de pe Spotify...');

    try {
      const res = await fetch(`${API_URL}/api/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: url }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      state.playlistId  = data.playlistId;
      state.playlistUrl = url;
      $('spotify-link').href = url;

      setPlaylistStatus(`✓ ${data.trackCount} piese încărcate`, 'ok');
      checkMatchReady();

    } catch (err) {
      setPlaylistStatus('✗ ' + err.message, 'fail');
      state.playlistId = null;
      checkMatchReady();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Load';
      hideStatus();
    }
  }

  // ── MATCH ─────────────────────────────────────────────────────────────────
  async function match() {
    if (!state.playlistId || !state.photoFile || state.loading) return;

    state.loading = true;
    clearError();
    $('btn-match').disabled = true;
    $('vibe-section').style.display   = 'none';
    $('tracks-section').style.display = 'none';

    showStatus('AI analizează poza ta... ✦');

    try {
      const form = new FormData();
      form.append('image',      state.photoFile);
      form.append('playlistId', state.playlistId);
      form.append('topN',       '12');

      const res = await fetch(`${API_URL}/api/match`, {
        method: 'POST',
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      renderResults(data.vibe, data.tracks, data.total);

    } catch (err) {
      showError('Eroare: ' + err.message +
        '. Verifică că backend-ul rulează și că URL-ul din config.js este corect.');
    } finally {
      state.loading = false;
      $('btn-match').disabled = false;
      hideStatus();
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  function renderResults(vibe, tracks, total) {
    $('vibe-photo').src = state.photoDataUrl;
    $('vibe-mood').textContent  = vibe.mood         || '—';
    $('vibe-color').textContent = vibe.colorPalette  || '';
    $('vibe-desc').textContent  = vibe.description   || '';

    // Tags
    const tagsEl = $('vibe-tags');
    tagsEl.innerHTML = '';
    (vibe.keywords || []).forEach((k) => {
      tagsEl.insertAdjacentHTML('beforeend', `<span class="tag">${esc(k)}</span>`);
    });
    (vibe.genreSuggestions || []).forEach((g) => {
      tagsEl.insertAdjacentHTML('beforeend', `<span class="tag genre">${esc(g)}</span>`);
    });

    // Bars — text imediat, animatie dupa paint
    setBar('energy',  vibe.energyScore);
    setBar('valence', vibe.valenceScore);
    setBar('dance',   vibe.danceabilityScore);
    setBar('acoustic',vibe.acousticnessScore);

    $('vibe-section').style.display = 'block';

    // Tracks
    $('tracks-meta').textContent = `${tracks.length} din ${total} piese analizate`;
    const list = $('track-list');
    list.innerHTML = '';

    tracks.forEach((track, i) => {
      const artists  = Array.isArray(track.artists) ? track.artists.join(', ') : (track.artists || '');
      const score    = typeof track.vibeScore === 'number' ? track.vibeScore.toFixed(0) : '—';
      const isTop    = i < 3;
      const rankHtml = isTop
        ? `<span class="track-rank gold">✦</span>`
        : `<span class="track-rank">#${i + 1}</span>`;

      const a = document.createElement('a');
      a.className = 'track-item';
      a.href      = esc(track.spotifyUrl || '#');
      a.target    = '_blank';
      a.rel       = 'noopener noreferrer';
      a.style.animationDelay = `${(i * 0.045).toFixed(3)}s`;
      a.innerHTML = `
        ${rankHtml}
        <img class="track-cover"
             src="${esc(track.albumImageUrl || '')}"
             alt=""
             onerror="this.style.background='var(--surface2)';this.removeAttribute('src')">
        <div class="track-info">
          <div class="track-name">${esc(track.name)}</div>
          <div class="track-artist">${esc(artists)}</div>
        </div>
        <div class="track-mood">${esc(track.moodLabel || '')}</div>
        <div class="track-score">${score}%</div>
      `;
      list.appendChild(a);
    });

    $('tracks-section').style.display = 'block';

    setTimeout(() => {
      $('vibe-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);

    setTimeout(() => {
      animBar('bar-energy',  vibe.energyScore);
      animBar('bar-valence', vibe.valenceScore);
      animBar('bar-dance',   vibe.danceabilityScore);
      animBar('bar-acoustic',vibe.acousticnessScore);
    }, 160);
  }

  function setBar(id, val) {
    $(`pct-${id}`).textContent = Math.round((val || 0) * 100) + '%';
  }

  function animBar(id, val) {
    const el = $(id);
    if (el) el.style.transform = `scaleX(${Math.max(0, Math.min(1, val || 0))})`;
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  window.App = { loadPlaylist, match, dragOver, dragLeave, drop, onFileChange };

})();
