(function () {
  'use strict';

  const CFG = window.AUXMYPIC_CONFIG || {};
  const API_URL = (CFG.API_URL || 'http://localhost:8080').replace(/\/$/, '');

  const state = {
    photoFile: null,
    photoDataUrl: '',
    loading: false,
  };

  const $ = id => document.getElementById(id);

  function init() {
    $('playlist-url').addEventListener('input', checkReady);
    checkReady();
  }

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
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) applyPhoto(file);
  }

  function onFileChange(input) {
    if (input.files && input.files[0]) applyPhoto(input.files[0]);
  }

  function applyPhoto(file) {
    if (!file.type.startsWith('image/')) {
      showError('Alege o imagine JPG, PNG sau WEBP.');
      return;
    }
    state.photoFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      state.photoDataUrl = e.target.result;
      $('photo-preview').src = state.photoDataUrl;
      $('photo-preview').style.display = 'block';
      $('dropzone-idle').style.display = 'none';
      clearError();
      checkReady();
    };
    reader.readAsDataURL(file);
  }

  async function match() {
    if (state.loading) return;
    const playlistUrl = $('playlist-url').value.trim();
    if (!isSpotifyPlaylist(playlistUrl)) {
      showError('Pune un link valid de playlist Spotify, de forma https://open.spotify.com/playlist/...');
      return;
    }
    if (!state.photoFile) {
      showError('Adauga o poza ca sa pot cauta vibe-ul.');
      return;
    }

    state.loading = true;
    clearError();
    setLoading(true, 'Analizez poza si citesc playlistul...');
    $('vibe-section').style.display = 'none';
    $('tracks-section').style.display = 'none';

    try {
      const form = new FormData();
      form.append('playlistUrl', playlistUrl);
      form.append('image', state.photoFile);

      const res = await fetch(`${API_URL}/api/match`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Backend-ul nu a putut procesa cererea.');

      renderResults(data);
    } catch (e) {
      showError(e.message);
    } finally {
      state.loading = false;
      setLoading(false);
      checkReady();
    }
  }

  function renderResults(data) {
    const vibe = data.vibe || {};
    const playlist = data.playlist || {};
    const tracks = data.tracks || [];

    $('vibe-photo').src = state.photoDataUrl;
    $('vibe-mood').textContent = vibe.mood || 'Vibe gasit';
    $('vibe-color').textContent = vibe.colorPalette || '';
    $('vibe-desc').textContent = vibe.description || '';
    $('playlist-name').textContent = playlist.name || 'Playlist Spotify';
    $('playlist-count').textContent = `${data.totalTracks || tracks.length} piese citite`;
    $('spotify-link').href = playlist.spotifyUrl || $('playlist-url').value.trim();

    const tags = $('vibe-tags');
    tags.innerHTML = '';
    [...(vibe.keywords || []), ...(vibe.genreSuggestions || [])].forEach(tag => {
      const el = document.createElement('span');
      el.className = 'tag';
      el.textContent = tag;
      tags.appendChild(el);
    });

    setBar('energy', vibe.energyScore);
    setBar('valence', vibe.valenceScore);
    setBar('dance', vibe.danceabilityScore);
    setBar('acoustic', vibe.acousticnessScore);

    const list = $('track-list');
    list.innerHTML = '';
    tracks.forEach((track, index) => list.appendChild(trackElement(track, index)));

    $('tracks-meta').textContent = `${tracks.length} recomandari`;
    $('vibe-section').style.display = 'block';
    $('tracks-section').style.display = 'block';
    setTimeout(() => $('vibe-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function trackElement(track, index) {
    const link = document.createElement('a');
    link.className = 'track-item';
    link.href = track.spotifyUrl || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const artists = Array.isArray(track.artists) ? track.artists.join(', ') : '';
    const score = typeof track.vibeScore === 'number' ? Math.round(track.vibeScore) : 0;

    link.innerHTML = `
      <span class="track-rank">${index + 1}</span>
      <img class="track-cover" src="${esc(track.albumImageUrl || '')}" alt="">
      <span class="track-main">
        <span class="track-name">${esc(track.name || 'Piesa fara titlu')}</span>
        <span class="track-artist">${esc(artists)}</span>
        <span class="track-reason">${esc(track.matchReason || track.moodLabel || 'Se potriveste cu vibe-ul pozei')}</span>
      </span>
      <span class="track-score">${score}%</span>
    `;
    return link;
  }

  function isSpotifyPlaylist(value) {
    return /^(https?:\/\/open\.spotify\.com\/playlist\/|spotify:playlist:|[A-Za-z0-9]{22}$)/.test(value);
  }

  function checkReady() {
    const ready = isSpotifyPlaylist($('playlist-url').value.trim()) && !!state.photoFile && !state.loading;
    $('btn-match').disabled = !ready;
  }

  function setLoading(active, text) {
    $('btn-match').disabled = active;
    $('btn-match').textContent = active ? 'Se cauta piesele...' : 'Gaseste piesele potrivite';
    $('statusbar').classList.toggle('visible', active);
    $('statusbar-text').textContent = text || '';
  }

  function setBar(id, value) {
    const val = Math.max(0, Math.min(1, Number(value) || 0));
    $(`pct-${id}`).textContent = `${Math.round(val * 100)}%`;
    $(`bar-${id}`).style.transform = `scaleX(${val})`;
  }

  function showError(message) {
    const el = $('error-box');
    el.textContent = message;
    el.classList.add('visible');
  }

  function clearError() {
    $('error-box').classList.remove('visible');
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.App = { dragOver, dragLeave, drop, onFileChange, match };
  document.addEventListener('DOMContentLoaded', init);
})();
