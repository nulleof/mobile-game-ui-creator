# MobileUICreator

`mobile-ui-creator` готовит UI мобильной игры для передачи в разработку. Скилл определяет или переиспользует визуальный стиль, собирает пак отдельных ассетов и отдаёт точный рецепт экрана с собранным PNG. Рецепт описывает раскладку, состояния, действия и анимации в терминах, которые можно перенести в движок проекта.

## Использование

Откройте [SKILL.md](.agents/skills/mobile-ui-creator/SKILL.md) или положите всю папку `mobile-ui-creator` в `.agents/skills/` целевого проекта. В основном чате вызовите `$mobile-ui-creator` и назовите экран или сценарий. Например:

> $mobile-ui-creator Собери экран наград за экспедицию. Возьми утверждённый пак из design/ui и этот макет как эталон. Нужны обычное открытие, пропуск, длинные названия предметов и поведение при повторном тапе.

Когда пак ещё не утверждён, скилл сначала предлагает два или три концепта одного экрана. После выбора он собирает пак и первый рецепт. Для всего UI игры результат включает карту экранов и один сквозной сценарий. По умолчанию файлы сохраняются в `design/ui/` целевого проекта. Основной чат использует их для сборки в движке.

## Пилоты

| Пилот | Материалы |
| --- | --- |
| **CatSurvivor** | Journey, детали главы и окно награды. [Рецепт](examples/catsurvivor/recipe.md) · [Journey](examples/catsurvivor/captures/journey-tall.png) · [Детали главы](examples/catsurvivor/captures/chapter-detail-tall.png) · [Награды](examples/catsurvivor/captures/summary-tall.png) |
| **Orbital Works** | Обзор станции и улучшение реактора в стиле Abyss Signal. [Рецепт](examples/orbital-works/recipe.md) · [Концепты](examples/orbital-works/generation.md) · [Станция](examples/orbital-works/captures/station-landscape.png) · [Реактор](examples/orbital-works/captures/ready-landscape.png) |

Для автономных HTML-прототипов нужен Node.js 22+ и обычный браузер.

```powershell
node tools/preview.mjs catsurvivor
node tools/preview.mjs orbital-works
```

Откройте `.artifacts/catsurvivor.html` или `.artifacts/orbital-works.html`. В HTML встроены данные и арт. CatSurvivor при сборке читается из соседнего checkout. Если он лежит в другом месте, передайте его путь вторым аргументом, например `node tools/preview.mjs catsurvivor C:/Games/CatSurvivor`.

В режиме Interactive нажмите Enemies в Journey или Reactor Sector на станции. Стрелка и Escape возвращают на исходный экран. В CatSurvivor можно открыть и пропустить сундук, затем закрыть награду. В Orbital Works можно улучшить реактор и увидеть результат на обзоре. В Timeline можно выбрать переход или анимацию и остановиться на конкретном кадре.

## Проверка

Запустите `node tools/check.mjs`. Скрипт проверяет рецепты и манифесты, запускает Chromium с отдельным профилем на локальном адресе и снимает кадры экранов и переходов. Он проверяет безопасные зоны, стрессовые строки, блокировку ввода при переходе, возврат фокуса, повторные тапы, пропуск и уменьшенное движение. По умолчанию на Windows используется Microsoft Edge. Задайте `UI_CHROMIUM` для другого Chromium-браузера. Первый аргумент ограничивает прогон одним пилотом.

В [evals/evals.json](evals/evals.json) лежат запросы для повторной проверки поведения скилла как инструкции для агента. Браузерные проверки оценивают конкретные собранные результаты.
