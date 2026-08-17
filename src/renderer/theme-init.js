// Startup flash prevention: set data-theme before the stylesheet paints.
// This file loads synchronously before renderer.css via a <script> tag in index.html.
(function () {
  try {
    var t = localStorage.getItem('znxstudio-theme') || 'znxstudio-dark';
    if (t === 'system') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'znxstudio-dark'
        : 'znxstudio-light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'znxstudio-dark');
  }
})();
