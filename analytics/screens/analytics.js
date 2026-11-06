const Screens = window.Screens || {};
Screens.analytics = async function(root) {
  root.innerHTML = `
    <div class="header"><h1 class="h1">Аналитика</h1></div>
    <div class="card empty-state">
      <h2>В разработке</h2>
      <p>Здесь будет ABC-анализ и рекомендации. Сначала настройте рейлы.</p>
    </div>
  `;
};
window.Screens = Screens;
