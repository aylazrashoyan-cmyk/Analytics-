const Screens = window.Screens || {};
Screens.rails = async function(root) {
  root.innerHTML = `
    <div class="header"><h1 class="h1">Рейлы</h1></div>
    <div class="card empty-state">
      <h2>В разработке</h2>
      <p>Здесь будет настройка рядов и рейлов.</p>
    </div>
  `;
};
window.Screens = Screens;
