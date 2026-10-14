// 앱의 두뇌: 화면 전환, 퀴즈 진행(상태 머신), 음성 안내, 사지선다 보기 만들기/판정을 담당한다.
// 흐름: 문제 선택 → 힌트 음성 → 보기 4개(그림+글씨) 표시 → 하나 고르기
//        → 정답이면 정답 화면 / 틀리면 "다시 한번 생각해 보세요" 후 다시 고르기

import { loadQuizzes } from './data.js';
import * as tts from './tts.js';

/* ============================================================
 * 설정값 — 여기 숫자만 바꿔도 앱 동작이 달라집니다.
 * ============================================================ */
const CONFIG = {
  HINT_GAP_MS: 1400,                     // 힌트와 힌트 사이 간격(밀리초)
  CHOICE_COUNT: 4,                       // 보기 개수 (사지선다 = 4)
  QUESTION_IMAGE: 'images/question.png', // 문제가 나가는 동안 위쪽 무대에 (어떤 문제든 똑같이) 보여줄 그림. 정답 그림의 실루엣을 대신 보여주려면 '' 로 바꾸세요.
  STAGE_BACKGROUND: 'images/stage_bg.png', // 문제가 나가는 동안 위쪽 무대(? 그림 뒤)에 깔 배경 그림. 파일이 없거나 '' 이면 검정 배경. 정답 공개 때는 밝은 배경으로 바뀝니다.
  SHOW_SILHOUETTE: true,                 // 위쪽 무대(문제 그림)를 보여줄지. false 면 정답 공개 전까지 무대를 숨기고 힌트+보기만 보여줌
  DISTRACTORS_SAME_CATEGORY_FIRST: true, // 오답 보기를 같은 카테고리에서 먼저 뽑을지 (false 면 전체에서 무작위)
  SHOW_HINT_TEXT: false,                 // true 로 바꾸면 힌트를 화면에 글자로도 보여줍니다 (개발 확인용)
  BUZZER_VOLUME: 0.6,                    // 오답 부저 소리 크기 (0~1)
  WRONG_VOICE_DELAY_MS: 650,             // 부저가 울린 뒤 "다시 한번 생각해 보세요" 음성을 시작할 때까지의 시간
  CLAP_VOLUME: 0.8,                      // 박수 소리 크기 (0~1). 아이폰은 기기 볼륨 버튼만 먹고 이 값은 무시됩니다.
  CORRECT_VOICE_DELAY_MS: 900,           // 박수가 시작되고 나서 "정답입니다!" 음성을 시작할 때까지의 시간. 0 이면 동시에 시작(아이폰에서 소리가 깨질 수 있음)
};

/** 카테고리 표시 정보. JSON 에 새 카테고리를 추가해도 여기에 없으면 기본 모양(🎁)으로 자동 표시됩니다. */
const CATEGORY_META = {
  car: { label: '자동차', emoji: '🚗', color: '#3b82f6' },
  dinosaur: { label: '공룡', emoji: '🦖', color: '#22c55e' },
  object: { label: '물건', emoji: '🧸', color: '#a855f7' },
};
const EXTRA_COLORS = ['#ec4899', '#14b8a6', '#eab308', '#6366f1'];
const RANDOM_META = { label: '랜덤', emoji: '🎲', color: '#f97316' };
const RANDOM_KEY = '__random__';

/* ============================================================
 * 화면 요소 모음
 * ============================================================ */
const $ = (id) => document.getElementById(id);
const el = {
  screens: { start: $('screen-start'), category: $('screen-category'), quiz: $('screen-quiz') },
  loadStatus: $('load-status'),
  btnStart: $('btn-start'),
  banner: $('support-banner'),
  grid: $('category-grid'),
  quizHeader: $('quiz-header'),
  stage: $('stage'),
  img: $('quiz-image'),
  imgFallback: $('image-fallback'),
  celebration: $('celebration'),
  hintText: $('hint-text'),
  choiceMessage: $('choice-message'),
  choices: $('choices'),
  resultText: $('result-text'),
  resultSub: $('result-sub'),
  btnReplay: $('btn-replay'),
  btnContinue: $('btn-continue'),
  btnQuit: $('btn-quit'),
  clap: $('clap'),
  buzzer: $('buzzer'),
};

/* ============================================================
 * 앱 상태
 * state 값: preparing → readingHints → choosing → correct
 * ============================================================ */
const S = {
  quizzes: [],
  selection: null, // RANDOM_KEY 또는 카테고리 키
  queue: [],       // 이번 세션에서 아직 안 나온 문제들 (같은 문제 반복 방지)
  current: null,
  state: 'preparing',
  runId: 0,        // 진행 중인 작업을 한꺼번에 무효화하기 위한 번호표
  judging: false,  // 누른 보기의 이름을 읽어주는 중(이때는 다른 보기를 못 누름)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
 * 공통 유틸
 * ============================================================ */
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => node.classList.toggle('active', key === name));
}

function setState(state) {
  S.state = state;
  el.screens.quiz.dataset.state = state; // CSS 가 이 값을 보고 보기/버튼/패널을 보여주거나 숨긴다
  const headers = { readingHints: '잘 들어보세요 👂', choosing: '이게 뭘까요?' };
  el.quizHeader.textContent = headers[state] || '\u00A0';
  // SHOW_SILHOUETTE 가 꺼져 있으면 정답을 공개하기 전까지 무대를 숨긴다.
  el.stage.classList.toggle('hidden', !CONFIG.SHOW_SILHOUETTE && state !== 'correct');
}

/**
 * 진행 중인 음성 안내를 멈추고 새 번호표를 발급한다.
 * 비동기 작업들은 시작할 때 받은 번호표와 지금 번호표가 다르면 스스로 그만둔다.
 */
function interrupt() {
  S.runId += 1;
  tts.stop();
  return S.runId;
}

/* ============================================================
 * 카테고리 / 세션
 * ============================================================ */
function categoryKeys() {
  const seen = [];
  S.quizzes.forEach((q) => {
    if (!seen.includes(q.category)) seen.push(q.category);
  });
  const known = Object.keys(CATEGORY_META).filter((c) => seen.includes(c));
  const unknown = seen.filter((c) => !CATEGORY_META[c]);
  return [...known, ...unknown];
}

function metaOf(key, index) {
  return CATEGORY_META[key] || { label: key, emoji: '🎁', color: EXTRA_COLORS[index % EXTRA_COLORS.length] };
}

function buildCategoryButtons() {
  el.grid.innerHTML = '';
  const items = categoryKeys().map((key, i) => ({ key, ...metaOf(key, i) }));
  items.push({ key: RANDOM_KEY, ...RANDOM_META });

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'category-card';
    btn.style.background = item.color;
    btn.innerHTML = `<span class="cat-emoji">${item.emoji}</span><span class="cat-label">${item.label}</span>`;
    btn.addEventListener('click', () => startSession(item.key));
    el.grid.appendChild(btn);
  });
}

function poolFor(selection) {
  return selection === RANDOM_KEY ? S.quizzes : S.quizzes.filter((q) => q.category === selection);
}

function startSession(selection) {
  S.selection = selection;
  S.queue = shuffle(poolFor(selection));
  S.current = null;
  showScreen('quiz');
  nextQuiz();
}

function nextQuiz() {
  interrupt();
  const pool = poolFor(S.selection);
  if (pool.length === 0) {
    quit();
    return;
  }

  // 큐가 비면 다시 섞는다 (모든 문제가 한 번씩 나온 뒤에만 반복).
  if (S.queue.length === 0) {
    S.queue = shuffle(pool);
    if (S.current && S.queue.length > 1 && S.queue[0].id === S.current.id) {
      [S.queue[0], S.queue[1]] = [S.queue[1], S.queue[0]];
    }
  }

  S.current = S.queue.shift();
  renderQuiz(S.current);
  setState('preparing');
  playHints().catch(console.error);
}

function quit() {
  interrupt();
  S.current = null;
  S.queue = [];
  showScreen('category');
}

/* ============================================================
 * 문제 화면 그리기 + 사지선다 보기 만들기
 * ============================================================ */
/**
 * 위쪽 무대의 그림을 바꾼다.
 *  fixed: true  → 지정한 고정 그림을 "원래 색 그대로" 보여준다 (실루엣 처리 안 함)
 *  fixed: false → 정답 그림. 문제 중에는 흰 실루엣, 정답 공개 후에는 원래 색 (CSS 가 처리)
 */
function setStageImage(src, { fixed }) {
  el.stage.classList.toggle('question-fixed', fixed);
  el.imgFallback.classList.add('hidden');
  el.img.classList.remove('hidden');
  el.img.onerror = () => {
    console.warn(`[이미지] ${src} 파일을 찾을 수 없어요.`);
    el.img.classList.add('hidden');
    el.imgFallback.classList.remove('hidden');
  };
  el.img.src = src;
}

function renderQuiz(quiz) {
  el.celebration.innerHTML = '';
  el.hintText.textContent = '';
  el.resultText.textContent = '';
  el.resultSub.textContent = '';
  setMessage('');

  // 위쪽 무대 그림: 지정한 고정 그림(QUESTION_IMAGE) 또는 정답 그림의 실루엣
  if (CONFIG.QUESTION_IMAGE) setStageImage(CONFIG.QUESTION_IMAGE, { fixed: true });
  else setStageImage(`images/${quiz.imageName}.png`, { fixed: false });

  buildChoiceCards(pickChoices(quiz), quiz);
}

/**
 * 정답 1개 + 오답 (CHOICE_COUNT - 1)개를 뽑아 섞어서 돌려준다.
 *  - 오답은 같은 카테고리에서 먼저 뽑는다(비슷한 종류라야 고민이 되니까).
 *  - 이름/그림이 같은 문제는 보기에 함께 나오지 않는다.
 *  - JSON 의 notWith 로 "같이 나오면 헷갈리는 문제"를 지정하면 절대 같이 나오지 않는다.
 */
function pickChoices(quiz) {
  const wanted = Math.max(2, CONFIG.CHOICE_COUNT);
  const clashes = (a, b) =>
    a.id === b.id ||
    a.answer === b.answer ||
    a.imageName === b.imageName ||
    (a.notWith || []).includes(b.id) ||
    (b.notWith || []).includes(a.id);

  const others = S.quizzes.filter((q) => !clashes(quiz, q));
  const pool = CONFIG.DISTRACTORS_SAME_CATEGORY_FIRST
    ? [...shuffle(others.filter((q) => q.category === quiz.category)), ...shuffle(others.filter((q) => q.category !== quiz.category))]
    : shuffle(others);

  const picked = [];
  for (const q of pool) {
    if (picked.length >= wanted - 1) break;
    if (picked.some((p) => clashes(p, q))) continue; // 오답끼리도 같은 이름/그림은 피한다
    picked.push(q);
  }
  return shuffle([quiz, ...picked]);
}

function buildChoiceCards(choices, correctQuiz) {
  el.choices.innerHTML = '';
  choices.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.dataset.id = c.id;

    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = `images/${c.imageName}.png`;

    const fallback = document.createElement('div');
    fallback.className = 'choice-fallback hidden';
    fallback.textContent = '❓';
    img.onerror = () => {
      img.classList.add('hidden');
      fallback.classList.remove('hidden');
    };

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = c.answer;

    btn.appendChild(img);
    btn.appendChild(fallback);
    btn.appendChild(label);
    btn.addEventListener('click', () => pickChoice(c, btn, correctQuiz));
    el.choices.appendChild(btn);
  });
}

function setMessage(text, { retry = false } = {}) {
  el.choiceMessage.textContent = text || '\u00A0';
  el.choiceMessage.classList.remove('retry');
  if (retry) {
    void el.choiceMessage.offsetWidth; // 애니메이션을 다시 재생시키기 위한 트릭
    el.choiceMessage.classList.add('retry');
  }
}

/* ============================================================
 * 힌트 재생 → 보기 표시
 * ============================================================ */
async function playHints() {
  const quiz = S.current;
  if (!quiz) return;

  const run = interrupt();
  setState('readingHints');
  el.hintText.textContent = '';

  for (let i = 0; i < quiz.hints.length; i++) {
    if (CONFIG.SHOW_HINT_TEXT) el.hintText.textContent += (i ? '\n' : '') + quiz.hints[i];
    await tts.speak(quiz.hints[i]);
    if (run !== S.runId) return;
    if (i < quiz.hints.length - 1) {
      await sleep(CONFIG.HINT_GAP_MS);
      if (run !== S.runId) return;
    }
  }

  setState('choosing');
  // 이미 한 번 틀려서 "다시 한번 생각해 보세요"가 떠 있는 상태라면 그 문구를 유지한다.
  if (!el.choiceMessage.classList.contains('retry')) setMessage('하나를 골라 보세요 👇');
}

function replayHints() {
  if (S.state !== 'choosing') return;
  playHints().catch(console.error);
}

/* ============================================================
 * 보기 고르기 → 판정
 * ============================================================ */
/** 보기를 누르면: 먼저 그 보기의 이름을 읽어주고, 다 읽으면 정답/오답을 알려준다. */
async function pickChoice(choice, btn, correctQuiz) {
  if (S.state !== 'choosing' || S.judging) return; // 읽어주는 중에 다른 보기를 연타하는 것 방지
  S.judging = true;
  const run = interrupt();
  btn.classList.add('picked');

  await tts.speak(choice.answer);

  btn.classList.remove('picked');
  S.judging = false;
  if (run !== S.runId || S.state !== 'choosing') return; // 읽는 도중 다른 일이 생겼으면(다시 듣기, 앱 전환 등) 판정하지 않는다

  if (choice.id === correctQuiz.id) {
    showCorrect();
  } else {
    showWrong(btn);
  }
}

/** 틀렸을 때: 그 보기만 흐리게 만들고(다시 못 누름), 나머지로 다시 고르게 한다. */
function showWrong(btn) {
  btn.disabled = true;
  btn.classList.add('wrong');
  btn.classList.remove('shake');
  void btn.offsetWidth;
  btn.classList.add('shake');

  setMessage('다시 한번 생각해 보세요 🤔', { retry: true });
  playSfx(el.buzzer, CONFIG.BUZZER_VOLUME);
  // 부저 소리와 음성이 겹치지 않도록 부저가 울린 뒤에 말한다. 그 사이에 다른 보기를 누르면 이 안내는 취소된다.
  const run = S.runId;
  setTimeout(() => {
    if (run === S.runId && S.state === 'choosing') tts.speak('다시 한번 생각해 보세요.');
  }, CONFIG.WRONG_VOICE_DELAY_MS);
}

/** 맞았을 때: 정답 화면(컬러 그림 공개 + 별 + 박수 + 음성) */
function showCorrect() {
  const quiz = S.current;
  interrupt();
  setState('correct');

  // 문제 중에 고정 그림을 보여줬다면, 이제 정답의 진짜 그림(원래 색)으로 바꿔서 공개한다.
  if (CONFIG.QUESTION_IMAGE) setStageImage(`images/${quiz.imageName}.png`, { fixed: false });

  el.resultText.textContent = '🎉 정답입니다! 🎉';
  el.resultSub.textContent = quiz.answer;
  launchStars();
  playSfx(el.clap, CONFIG.CLAP_VOLUME);
  // 박수와 음성을 동시에 시작하면 특히 아이폰에서 한쪽이 끊기거나 깨진다. 박수가 먼저 울린 뒤 음성을 시작한다.
  setTimeout(() => {
    if (S.state === 'correct' && S.current === quiz) tts.speak('정답입니다!');
  }, CONFIG.CORRECT_VOICE_DELAY_MS);
}

function launchStars() {
  el.celebration.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const star = document.createElement('span');
    star.className = 'star';
    star.textContent = i % 3 === 0 ? '✨' : '⭐️';
    const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
    const dist = 90 + Math.random() * 80;
    star.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    star.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    star.style.animationDelay = `${Math.random() * 0.25}s`;
    el.celebration.appendChild(star);
  }
}

function playSfx(audio, volume) {
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* 무시 */ }
}

/**
 * 처음 한 번 사용자가 화면을 누를 때 효과음도 "열어" 둔다 (아이폰 자동재생 제한 대응).
 * 아이폰은 muted/volume 값을 무시하므로, 소리를 죽이는 방식 대신 play() 직후 바로 pause() 한다.
 */
function unlockSfx(audio) {
  try {
    const p = audio.play();
    audio.pause();
    audio.currentTime = 0;
    if (p && p.catch) p.catch(() => {}); // pause 때문에 생기는 AbortError 는 정상
  } catch (_) { /* 무시 */ }
}

/* ============================================================
 * 앱이 백그라운드로 가면 안전하게 멈춘다
 * ============================================================ */
function handleBackground() {
  if (!S.current) return;
  interrupt();
  // 힌트를 읽다가 멈췄다면 보기를 바로 고를 수 있게 한다.
  if (['readingHints', 'preparing'].includes(S.state)) setState('choosing');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleBackground();
});
window.addEventListener('pagehide', handleBackground);

/* ============================================================
 * 시작
 * ============================================================ */
function updateSupportBanner() {
  if (tts.isSupported) {
    el.banner.classList.add('hidden');
    return;
  }
  el.banner.textContent = '이 브라우저는 음성 안내를 지원하지 않아요. 안드로이드는 Chrome, 아이폰은 Safari로 열어 주세요.';
  el.banner.classList.remove('hidden');
}

function bindEvents() {
  el.btnStart.addEventListener('click', () => {
    // 사용자가 화면을 누른 이 순간에 소리를 열어 둔다.
    tts.unlock();
    unlockSfx(el.clap);
    unlockSfx(el.buzzer);
    updateSupportBanner();
    showScreen('category');
  });
  el.btnReplay.addEventListener('click', replayHints);
  el.btnContinue.addEventListener('click', nextQuiz);
  el.btnQuit.addEventListener('click', quit);
}

/** 무대 배경 그림(STAGE_BACKGROUND)이 실제로 있을 때만 적용한다. 없으면 기존처럼 검정 배경. */
function applyStageBackground() {
  if (!CONFIG.STAGE_BACKGROUND) return;
  const probe = new Image();
  probe.onload = () => {
    el.stage.style.setProperty('--stage-bg-image', `url("${CONFIG.STAGE_BACKGROUND}")`);
    el.stage.classList.add('has-bg');
  };
  probe.onerror = () => console.info(`[배경] ${CONFIG.STAGE_BACKGROUND} 파일이 없어서 검정 배경을 써요.`);
  probe.src = CONFIG.STAGE_BACKGROUND;
}

async function init() {
  bindEvents();
  applyStageBackground();
  try {
    const { quizzes, problems } = await loadQuizzes();
    problems.forEach((p) => console.warn('[quizzes.json]', p));
    S.quizzes = quizzes;
    buildCategoryButtons();
    el.loadStatus.textContent = `퀴즈 ${quizzes.length}개 준비 완료!`;
    el.btnStart.disabled = false;
  } catch (err) {
    console.error('[quizzes.json]', err);
    el.loadStatus.textContent = '퀴즈 파일을 읽지 못했어요. (F12 → 콘솔에서 원인을 확인하세요)';
  }
}

init();
