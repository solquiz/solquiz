// data/quizzes.json 을 읽고 검사하는 모듈.
// JSON 을 잘못 고쳐도 앱이 멈추지 않고, 브라우저 콘솔(F12)에 어디가 문제인지 알려준다.
// (사지선다 버전에서는 acceptedAnswers 가 필요 없다. JSON 에 남아 있어도 무시한다.)

export async function loadQuizzes(url = 'data/quizzes.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} 을(를) 불러오지 못했습니다 (HTTP ${res.status})`);

  let raw;
  try {
    raw = await res.json();
  } catch (e) {
    throw new Error(`${url} 의 JSON 형식이 올바르지 않습니다 (쉼표/괄호를 확인하세요): ${e.message}`);
  }
  if (!Array.isArray(raw)) throw new Error('quizzes.json 의 맨 바깥은 배열( [ ... ] )이어야 합니다.');

  const problems = [];
  const seenIds = new Set();
  const quizzes = [];

  raw.forEach((q, i) => {
    if (!q || typeof q !== 'object') {
      problems.push(`${i + 1}번째 항목이 객체가 아닙니다.`);
      return;
    }
    const tag = q.id ? `Quiz ID ${q.id}` : `${i + 1}번째 항목`;
    let usable = true;

    if (!q.id) problems.push(`${tag}: id 가 없습니다.`);
    else if (seenIds.has(q.id)) problems.push(`${tag}: 중복된 ID 입니다.`);
    seenIds.add(q.id);

    if (!q.category) { problems.push(`${tag}: category 가 없습니다.`); usable = false; }
    if (!q.answer || !String(q.answer).trim()) { problems.push(`${tag}: answer 가 비어 있습니다.`); usable = false; }
    if (!Array.isArray(q.hints) || q.hints.length === 0) { problems.push(`${tag}: hints 데이터가 없습니다.`); usable = false; }
    if (!q.imageName || !String(q.imageName).trim()) { problems.push(`${tag}: imageName 이 비어 있습니다.`); usable = false; }

    if (usable) quizzes.push(q);
  });

  // notWith 에 적힌 ID 가 실제로 있는지 확인 (오타 방지)
  quizzes.forEach((q) => {
    (q.notWith || []).forEach((otherId) => {
      if (!seenIds.has(otherId)) problems.push(`Quiz ID ${q.id}: notWith 의 '${otherId}' 라는 문제가 없습니다.`);
    });
  });

  if (quizzes.length === 0) throw new Error('사용 가능한 퀴즈가 하나도 없습니다.');
  return { quizzes, problems };
}
