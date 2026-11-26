export const seasonNow = Date.parse('2026-12-04T12:00:00Z');
export const chapter = 3;

export const seasonEvents = [
  { id: 'solar-storm', name: 'Солнечный шквал', start: '12-01', end: '12-07', cutoff: '12-09', chapter: 1, progress: [2, 5] },
  { id: 'silent-array', name: 'Тихая антенна', start: '12-02', end: '12-08', cutoff: '12-10', chapter: 4, progress: [0, 4] },
  { id: 'day-supplies', name: 'Дневные поставки', start: '12-05', end: '12-10', cutoff: '12-12', chapter: 2, progress: [0, 4] },
  { id: 'deep-relay', name: 'Дальний ретранслятор', start: '11-26', end: '12-03', cutoff: '12-06', chapter: 2, progress: [3, 3], reward: 'earned' },
  { id: 'light-beacon', name: 'Световой маяк', start: '11-25', end: '12-02', cutoff: '12-04', chapter: 2, progress: [3, 3], reward: 'collected' },
  { id: 'weather-probe', name: 'Метеозонд', start: '11-24', end: '12-01', cutoff: '12-04', chapter: 1, progress: [2, 4] },
  { id: 'south-pier', name: 'Южный причал', start: '11-25', end: '12-02', cutoff: '12-04', chapter: 2, progress: [1, 4] },
  { id: 'ice-path', name: 'Ледовый маршрут', start: '11-24', end: '12-01', cutoff: '12-03', chapter: 2, progress: [3, 3], reward: 'collected' },
  { id: 'night-convoy', name: 'Ночной конвой', start: '11-23', end: '11-29', cutoff: '12-02', chapter: 2, progress: [4, 4], reward: 'earned' },
].map((event) => ({
  ...event,
  start: time(event.start),
  end: time(event.end),
  cutoff: time(event.cutoff),
}));

function time(date) {
  return Date.parse(`2026-${date}T12:00:00Z`);
}

export function eventAvailability(event, now) {
  const phase = now < event.start ? 'upcoming'
    : now < event.end ? 'running'
      : now < event.cutoff ? 'claim' : 'closed';
  return {
    phase,
    canPlay: phase === 'running' && chapter >= event.chapter,
    canClaim: phase === 'claim' && event.reward === 'earned',
  };
}
