# AuxMyPic — Frontend

Repo **public**, hostat pe **GitHub Pages**.

## Structura

```
auxmypic-frontend/
├── index.html   ← pagina principala
├── style.css    ← toate stilurile
├── app.js       ← toata logica JS
└── config.js    ← ← ← SINGURA LINIE PE CARE O MODIFICI dupa deploy backend
```

## Dupa deploy backend pe Render

Deschide `config.js` si pune URL-ul tau real:

```js
window.AUXMYPIC_CONFIG = {
  API_URL: 'https://auxmypic-api.onrender.com'  // <- URL-ul tau
};
```

## Deploy pe GitHub Pages

1. Push pe GitHub (repo public: `auxmypic-frontend`)
2. Settings → Pages → Branch: `main`, Folder: `/ (root)`
3. URL final: `https://USERNAME.github.io/auxmypic-frontend`
