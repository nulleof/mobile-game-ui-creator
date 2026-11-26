const sections = { progress: 'Прогресс', activities: 'Активности', events: 'События' };
const statuses = {
  available: { label: 'Доступно', color: '#9df4de' },
  locked: { label: 'Закрыто', color: '#ffcb91' },
  upcoming: { label: 'Скоро', color: '#b5cfe8' },
};
const muted = '#b2cad0';
const panel = '#102835';
const mint = '#a6f5e2';
const ink = '#08232a';

function copy(id, box, text, font = {}, options = {}) {
  return { id, box, text, font: { size: 15, align: 'left', ...font }, ...options };
}

function button(id, box, text, action, primary = false) {
  return copy(id, box, text, {
    size: 14, weight: 740, align: 'center', color: primary ? ink : '#eef9f8',
  }, { action, fill: primary ? mint : panel, radius: 9, qa: 'touch' });
}

export function buildDispatchRecipe(recipe, catalog, { newEvent = false } = {}) {
  const { actions, states, screens, nodes } = recipe;
  const bySection = { progress: [], activities: [], events: [] };

  function addScreen(id, label, section, content, escape) {
    states[id] = { screen: id, label, ...(escape && { escape }) };
    screens[id] = { initial: id };
    bySection[section].push(id);
    nodes.push({ id: `screen-${id}`, screen: id, box: [0, 0, 320, 462], children: content });
  }

  function route(id, from, to, label, options = {}) {
    actions[id] = { type: 'input', from, navigate: { to, label, focus: `title-${to}`, ...options } };
    return id;
  }

  function title(id, text, box = [16, 13, 288, 44]) {
    return copy(`title-${id}`, box, text, { size: 29, minSize: 23, weight: 780 }, { focusable: true, qa: 'copy' });
  }

  function back(id, destination, label = sections[destination]) {
    const action = route(`back-${id}`, [id], destination, `Назад · ${label}`, { back: true });
    return button(action, [16, 4, 128, 48], `‹  ${label}`, action);
  }

  nodes.push(
    { id: 'relay-bay', space: 'screen', box: [0, -82, 320, 568], asset: 'bay', passThrough: true },
    { id: 'scene-shade', space: 'screen', box: [0, 0, 320, 568], passThrough: true,
      fill: 'linear-gradient(180deg, #071820 0%, #081a23c4 24%, #08172020 52%, #071a22ea 79%, #07181f 100%)' },
  );

  route('continue-chapter', ['progress'], 'chapter-3', 'Продолжить главу 3');
  addScreen('progress', sections.progress, 'progress', [
    copy('station-name', [16, 10, 288, 18], recipe.title, { size: 12, weight: 730, tracking: 1.05, color: mint }),
    title('progress', 'Прогресс', [16, 28, 288, 49]),
    { id: 'chapter-card', box: [16, 294, 288, 151], fill: '#0d2632', radius: 13, qa: 'copy', children: [
      copy('chapter-label', [14, 11, 260, 20], 'Глава 3 · Задача 2 из 4', { size: 12, color: mint, weight: 700 }),
      copy('saved-chapter-name', [14, 34, 260, 28], 'Восстановление связи', { size: 20, weight: 760 }),
      copy('saved-chapter-task', [14, 62, 260, 21], 'Следующая цель — вернуть сигнал.', { size: 13, color: muted }),
      button('continue-chapter', [14, 91, 260, 48], 'Продолжить главу', 'continue-chapter', true),
    ] },
  ]);

  addScreen('chapter-3', 'Глава 3', 'progress', [
    back('chapter-3', 'progress'),
    title('chapter-3', 'Восстановление связи', [16, 65, 288, 76]),
    copy('chapter-checkpoint', [16, 145, 288, 26], 'Глава 3 · Задача 2 из 4', { size: 14, weight: 740, color: mint }),
    copy('chapter-goal', [16, 175, 288, 37], 'Верните сигнал на релейной вышке.', { size: 16 }),
  ], 'back-chapter-3');

  for (const [id, from, label] of [
    ['training', 'activities', 'Активности'],
    ['training-from-detail', 'shield-training', 'К описанию'],
  ]) {
    route(`start-${id}`, [from], id, `Начать тренировку · ${label}`);
    addScreen(id, `Тренировка запущена · ${label}`, 'activities', [
      back(id, from, label),
      title(id, 'Тренировка запущена', [16, 65, 288, 82]),
      copy(`goal-${id}`, [16, 150, 288, 36], 'Отразите учебный залп щитом.', { size: 16, color: mint }),
    ], `back-${id}`);
  }

  for (const [section, groups] of Object.entries(catalog)) {
    const rows = [];
    let y = 0;
    let count = 0;
    for (const [index, group] of groups.entries()) {
      rows.push(copy(`${section}-group-${index}`, [0, y, 282, 25], group.title, { size: 14, color: mint, weight: 730 }));
      y += 31;
      for (const item of group.items) {
        if (item.newEvent && !newEvent) continue;
        const { id, title: name, status, unlock, next } = item;
        const text = { key: `${id}-title` };
        recipe.data[text.key] = name;
        const { color, label } = statuses[status];
        const open = route(`open-${id}`, [section], id, `${sections[section]} · ${name}`);
        const quickStart = id === 'shield-training';
        const rowWidth = quickStart ? 177 : 282;
        const row = {
          id: `row-${id}`, box: [0, 0, rowWidth, 68], qa: 'touch', action: open, radius: 9,
          children: [
            copy(`row-title-${id}`, [10, 4, rowWidth - 16, 37], text, { size: 15, weight: 720 }),
            copy(`row-status-${id}`, [10, 42, rowWidth - 16, 18], status === 'locked' ? `${label} · ${unlock}` : label,
              { size: 11, color }),
          ],
        };
        const children = [row];
        if (quickStart) children.push(button('quick-start', [183, 9, 91, 50], 'Начать', 'start-training', true));
        rows.push({ id: `tile-${id}`, box: [0, y, 282, 68], fill: panel, radius: 9, children });
        y += 74;
        count++;

        const detail = [
          back(id, section),
          title(id, text, [16, 58, 288, 84]),
          copy(`status-${id}`, [16, 144, 288, 23], label, { size: 15, color, weight: 760 }),
          { id: `brief-${id}`, box: [16, 180, 288, quickStart ? 222 : 163], fill: '#102835f5', radius: 12, children: [
            copy(`requirement-label-${id}`, [14, 13, 260, 20], 'Условие доступа', { size: 12, color: muted }),
            copy(`requirement-${id}`, [14, 34, 260, 34], unlock, { size: 16, weight: 700 }),
            { id: `brief-rule-${id}`, box: [14, 77, 260, 1], fill: '#3a5560' },
            copy(`next-label-${id}`, [14, 88, 260, 20], 'Следующий шаг', { size: 12, color: muted }),
            copy(`next-${id}`, [14, 109, 260, 39], next, { size: 15 }),
            ...(quickStart ? [button('detail-start', [14, 160, 260, 48], 'Начать тренировку', 'start-training-from-detail', true)] : []),
          ] },
        ];
        addScreen(id, name, section, detail, `back-${id}`);
      }
      y += 8;
    }
    const countLabel = section === 'activities' ? `Режимы · ${count}` : `В каталоге · ${count}`;
    addScreen(section, sections[section], section, [
      title(section, sections[section]),
      copy(`${section}-count`, [16, 59, 288, 18], countLabel, { size: 13, color: muted }),
      { id: `list-${section}`, box: [16, 90, 288, 362], scroll: 'vertical', qa: 'copy', children: rows },
    ]);
  }

  nodes.push({ id: 'section-bar', box: [0, 462, 320, 62], fill: '#10242d', qa: 'copy',
    children: Object.entries(sections).map(([section, label], index) => {
      const id = route(`tab-${section}`, Object.keys(states).filter((state) => state !== section), section, label, { section: true });
      return copy(id, [10 + index * 100, 5, 100, 52], label, { size: 14, weight: 730, align: 'center' },
        { action: id, radius: 6, qa: 'touch', currentIn: bySection[section] });
    }),
  });
  return recipe;
}
