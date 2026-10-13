// 음성 안내(TTS) 모듈 — 브라우저의 speechSynthesis 를 감싼 얇은 래퍼.
// speak() 는 "말이 끝나면" 완료되는 Promise 를 돌려주므로
//   await speak('힌트1'); await sleep(1400); await speak('힌트2');
// 처럼 순서대로 읽어줄 수 있다. (고정 시간 대기가 아니라 실제 종료 시점 기준)

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let voice = null;     // 선택된 한국어 목소리
let current = null;   // 재생 중인 utterance (참조를 안 잡아두면 안드로이드 Chrome 이 중간에 끊는 버그가 있음)
let pendingFinish = null;

function isKorean(v) {
  return v.lang && v.lang.replace('_', '-').toLowerCase().startsWith('ko');
}

function pickVoice() {
  if (!supported) return;
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang && v.lang.replace('_', '-') === 'ko-KR') || voices.find(isKorean) || null;
}

if (supported) {
  pickVoice();
  // 목소리 목록은 비동기로 늦게 채워지는 브라우저가 많다.
  if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', pickVoice);
  else speechSynthesis.onvoiceschanged = pickVoice;
}

// cancel() 직후에 바로 speak() 하면 안드로이드 Chrome/아이폰 Safari 가 그 말을 통째로 삼키거나 깨뜨리는 경우가 있다.
// 그래서 마지막 cancel() 로부터 이 시간이 지난 뒤에 말을 시작한다.
const CANCEL_GAP_MS = 180;
// speak() 를 불렀는데 이 시간 안에 시작(onstart)이 안 되면 "씹힌 것"으로 보고 한 번 다시 시도한다.
const START_WATCHDOG_MS = 2500;

let lastCancelAt = 0;

function cancelAll() {
  try { speechSynthesis.cancel(); } catch (_) { /* 무시 */ }
  lastCancelAt = Date.now();
}

function makeUtterance(text, rate, pitch) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  if (voice) u.voice = voice;
  u.rate = rate;     // 1.0 이 보통 속도. 아이용이라 조금 느리게.
  u.pitch = pitch;
  u.volume = 1;      // 소리 크기는 기기의 미디어 볼륨을 그대로 따라간다.
  return u;
}

/**
 * 한 문장을 읽어준다. 끝나면 'ended', 중간에 끊기면 'cancelled'/'error', 지원 안 되면 'skipped'.
 * 이미 말하는 중이면 먼저 끊고 새로 시작한다(음성 겹침 방지).
 */
export function speak(text, { rate = 0.9, pitch = 1.1 } = {}) {
  return new Promise((resolve) => {
    if (!supported || !text) {
      resolve('skipped');
      return;
    }

    if (!voice) pickVoice(); // 목소리 목록이 늦게 채워진 경우 다시 찾아본다

    // 이전 발화가 남아 있으면 정리
    const wasBusy = speechSynthesis.speaking || speechSynthesis.pending;
    if (pendingFinish) pendingFinish('cancelled');
    if (wasBusy) cancelAll();

    let done = false;
    let attempt = 0;
    let started = false;
    let endTimer = null;
    let watchdog = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(endTimer);
      clearTimeout(watchdog);
      current = null;
      if (pendingFinish === finish) pendingFinish = null;
      resolve(result);
    };
    pendingFinish = finish;

    // 일부 브라우저는 onend 가 안 오는 경우가 있어 안전장치를 둔다.
    endTimer = setTimeout(() => {
      cancelAll();
      finish('timeout');
    }, text.length * 450 + 8000);

    const begin = () => {
      if (done) return;
      started = false;
      const u = makeUtterance(text, rate, pitch);
      current = u; // 참조를 잡아둬야 안드로이드 Chrome 이 중간에 끊지 않는다
      // 이전 시도의 utterance 가 뒤늦게 보내는 이벤트는 무시한다.
      u.onstart = () => { if (current === u) { started = true; clearTimeout(watchdog); } };
      u.onend = () => { if (current === u) finish('ended'); };
      u.onerror = (e) => {
        if (current !== u) return;
        finish(e && (e.error === 'canceled' || e.error === 'interrupted') ? 'cancelled' : 'error');
      };

      try { speechSynthesis.resume(); } catch (_) { /* 일시정지 상태로 굳은 경우 풀어준다 */ }
      speechSynthesis.speak(u);

      watchdog = setTimeout(() => {
        if (done || started) return;
        if (attempt < 1) {            // 씹혔다 → 한 번만 다시 시도
          attempt += 1;
          cancelAll();
          setTimeout(begin, CANCEL_GAP_MS);
        } else {
          cancelAll();
          finish('timeout');
        }
      }, START_WATCHDOG_MS);
    };

    const wait = Math.max(0, CANCEL_GAP_MS - (Date.now() - lastCancelAt));
    if (wait > 0) setTimeout(begin, wait);
    else begin();
  });
}

/** 지금 하던 말을 즉시 멈춘다. (기다리던 speak() 들은 'cancelled' 로 끝난다) */
export function stop() {
  if (!supported) return;
  if (pendingFinish) pendingFinish('cancelled');
  cancelAll();
}

/**
 * 아이폰/안드로이드는 "사용자가 화면을 누른 순간"에 한 번 소리를 열어줘야 이후 자동 음성이 나온다.
 * 시작 버튼의 클릭 핸들러 안에서 한 번 호출해 둔다.
 */
export function unlock() {
  if (!supported) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch (_) { /* 무시 */ }
}

export const isSupported = supported;
