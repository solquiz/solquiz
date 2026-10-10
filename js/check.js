// 점검 페이지(check.html)용 스크립트.
// quizzes.json 을 읽어서 ① 문제 수 ② JSON 오류 위치 ③ 이미지 파일 존재 여부 ④ 필수 항목 누락을 보여준다.

import { findCommaProblems } from './jsonhint.js';

const $ = (id) => document.getElementById(id);
const out = $('result');
$('where').textContent = `이 서버 주소: ${location.origin}  /  읽은 파일: ${new URL('data/quizzes.json', location.href).href}`;

function box(kind, title, html) {
  const d = document.createElement('div');
  d.className = `box ${kind}`;
  d.innerHTML = `<h2>${title}</h2>${html || ''}`;
  out.appendChild(d);
  return d;
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function imageExists(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = `${src}?t=${Date.now()}`;
  });
}

/** JSON 오류: 줄 번호(메시지 또는 쉼표 검사)로 해당 줄 주변을 보여준다 */
function showJsonError(text, err) {
  const hints = findCommaProblems(text);

  // 브라우저가 알려준 위치 (크롬 등은 줄/위치를 알려주고, 사파리는 안 알려줌)
  let line = null;
  const m1 = /line (\d+)/i.exec(err.message);
  const m2 = /position (\d+)/i.exec(err.message);
  if (m1) line = Number(m1[1]);
  else if (m2) line = text.slice(0, Number(m2[1])).split('\n').length;

  const marks = new Map(); // 줄 번호 → 표시 문구
  hints.forEach((h) => marks.set(h.line, h.msg));
  if (line && !marks.size) marks.set(line, '여기 근처');

  const lines = text.split('\n');
  const blocks = [...marks.keys()].slice(0, 3).map((ln) => {
    const from = Math.max(0, ln - 3);
    const to = Math.min(lines.length, ln + 2);
    return '<pre>' + lines.slice(from, to).map((l, i) => {
      const no = from + i + 1;
      const row = `${String(no).padStart(4)}  ${esc(l)}`;
      return no === ln ? `<span class="hit">${row}   ◀ ${esc(marks.get(ln))}</span>` : row;
    }).join('\n') + '</pre>';
  }).join('');

  const summary = hints.length
    ? `<ul>${hints.slice(0, 5).map((h) => `<li><b>${esc(h.msg)}</b></li>`).join('')}</ul>${hints.length > 5 ? `<p>… 외 ${hints.length - 5}곳</p>` : ''}`
    : `<p>${line ? `<b>${line}번째 줄</b> 근처를 확인하세요.` : '줄 번호를 알 수 없어요. 따옴표(")나 괄호 짝이 맞는지 확인하세요.'}</p>`;

  box('err', 'quizzes.json 형식 오류',
    `<p>브라우저 메시지: ${esc(err.message)}</p>${summary}${blocks}
     <p>쉼표를 고친 뒤 이 페이지를 새로고침하세요. 한 번에 여러 곳을 고쳐야 할 수도 있어요.</p>`);
}

async function main() {
  let res;
  try {
    res = await fetch(`data/quizzes.json?t=${Date.now()}`, { cache: 'no-store' });
  } catch (e) {
    box('err', '파일을 못 읽었어요', `<p>${esc(e.message)}</p><p>터미널의 서버가 켜져 있는지 확인하세요.</p>`);
    return;
  }
  if (!res.ok) {
    box('err', `data/quizzes.json 을 찾을 수 없어요 (HTTP ${res.status})`, '<p>터미널을 <b>kids-quiz-web-choice 폴더 안에서</b> 열었는지 확인하세요. (폴더 안에 <code>index.html</code> 이 보여야 해요)</p>');
    return;
  }

  const text = await res.text();
  const lastMod = res.headers.get('last-modified');
  if (lastMod) $('where').textContent += `  /  파일 수정 시각: ${new Date(lastMod).toLocaleString('ko-KR')}`;

  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    showJsonError(text, e);
    return;
  }
  if (!Array.isArray(data)) {
    box('err', '맨 바깥이 배열이 아니에요', '<p>파일은 <code>[</code> 로 시작해서 <code>]</code> 로 끝나야 해요.</p>');
    return;
  }

  const cats = {};
  data.forEach((q) => { cats[q && q.category] = (cats[q && q.category] || 0) + 1; });
  box('ok', `JSON 형식은 정상이에요 — 문제 ${data.length}개`,
    `<ul>${Object.entries(cats).map(([k, v]) => `<li><code>${esc(k)}</code> : ${v}개</li>`).join('')}</ul>`);

  // 항목 검사 + 이미지 확인
  const ids = new Map();
  const rows = [];
  const imgJobs = data.map(async (q, i) => {
    const probs = [];
    if (!q || typeof q !== 'object') { rows.push({ i, q: {}, probs: ['객체가 아님'], ok: false }); return; }
    if (!q.id) probs.push('id 없음');
    else if (ids.has(q.id)) probs.push(`id 중복(${q.id})`);
    ids.set(q.id, true);
    if (!q.category) probs.push('category 없음');
    if (!q.answer || !String(q.answer).trim()) probs.push('answer 비어 있음');
    if (!Array.isArray(q.hints) || q.hints.length === 0) probs.push('hints 없음');
    let ok = null;
    if (!q.imageName) probs.push('imageName 없음');
    else {
      ok = await imageExists(`images/${q.imageName}.png`);
      if (!ok) probs.push(`images/${q.imageName}.png 없음`);
    }
    rows.push({ i, q, probs, ok });
  });
  await Promise.all(imgJobs);
  rows.sort((a, b) => a.i - b.i);

  const bad = rows.filter((r) => r.probs.length);
  const missingImgs = rows.filter((r) => r.ok === false);

  // 이미지 폴더 자체 점검: 기본 문제 그림(question.png)
  const qImg = await imageExists('images/question.png');
  if (!qImg) box('warn', '문제 중에 보여줄 고정 그림(images/question.png)이 없어요', '<p>위쪽 무대에 ❓ 가 나와요. 그림을 <code>images/question.png</code> 로 넣거나 <code>js/app.js</code> 의 <code>QUESTION_IMAGE</code> 를 바꾸세요.</p>');

  if (missingImgs.length) {
    // 비슷한 파일명 힌트: 대소문자/확장자 문제를 알려준다
    box('err', `이미지가 없는 문제 ${missingImgs.length}개`,
      `<p>JSON 의 <code>imageName</code> 과 <code>images/</code> 폴더의 파일 이름이 <b>글자 하나까지 똑같아야</b> 해요. (대소문자 구분, 확장자는 <code>.png</code> 소문자)</p>
       <ul>${missingImgs.slice(0, 30).map((r) => `<li><code>${esc(r.q.id)}</code> ${esc(r.q.answer)} → <code>images/${esc(r.q.imageName)}.png</code></li>`).join('')}${missingImgs.length > 30 ? `<li>… 외 ${missingImgs.length - 30}개</li>` : ''}</ul>
       <p>흔한 원인: ① <code>.PNG</code>/<code>.jpg</code> 확장자 ② 이름 오타·대소문자 ③ 이미지를 <code>Assets.xcassets/…imageset/</code> 안 폴더째 복사함 ④ 다른 폴더에 넣음</p>`);
  } else {
    box('ok', '모든 문제의 이미지 파일이 있어요');
  }
  if (bad.length && !missingImgs.length) {
    box('warn', `확인이 필요한 항목 ${bad.length}개`, `<ul>${bad.map((r) => `<li>${esc(r.q.id || r.i + 1 + '번째')}: ${esc(r.probs.join(', '))}</li>`).join('')}</ul>`);
  }

  // 전체 표
  const t = document.createElement('table');
  t.innerHTML = '<tr><th>그림</th><th>id</th><th>카테고리</th><th>정답</th><th>이미지 이름</th><th>상태</th></tr>';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    if (r.probs.length) tr.className = 'bad';
    const src = r.q.imageName ? `images/${r.q.imageName}.png?t=${Date.now()}` : '';
    tr.innerHTML = `<td>${src ? `<img class="thumb" src="${esc(src)}" alt="" />` : ''}</td><td>${esc(r.q.id || '')}</td><td>${esc(r.q.category || '')}</td><td>${esc(r.q.answer || '')}</td><td>${esc(r.q.imageName || '')}</td><td>${r.probs.length ? '⚠️ ' + esc(r.probs.join(', ')) : '✅'}</td>`;
    t.appendChild(tr);
  });
  out.appendChild(t);
}

main();
