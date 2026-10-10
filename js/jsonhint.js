// JSON 을 손으로 고치다가 가장 자주 생기는 실수 두 가지를 줄 번호로 찾아준다.
//  1) 객체와 객체 사이에 쉼표가 빠짐:   }  (줄바꿈)  {
//  2) 마지막 항목 뒤에 쉼표가 남음:     ,  (줄바꿈)  ]   또는   ,  (줄바꿈)  }
// 문자열 안의 글자는 무시하고 바깥 구조만 본다. (브라우저마다 오류 메시지에 줄 번호를 안 주는 경우가 있어서 따로 검사한다.)

export function findCommaProblems(text) {
  const problems = [];
  let line = 1;
  let inString = false;
  let escaped = false;
  let prev = null;          // 마지막으로 본 "공백 아닌" 글자
  let prevLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') { inString = false; prev = '"'; prevLine = line; }
      continue;
    }
    if (/\s/.test(ch)) continue;

    if (ch === '"') {
      inString = true;
      // 값 뒤에 바로 새 문자열이 오면(쉼표 없이) 쉼표 누락
      if (prev === '"' || prev === '}' || prev === ']') {
        problems.push({ line: prevLine, kind: 'missing', msg: `${prevLine}번째 줄 끝에 쉼표(,)가 빠진 것 같아요` });
      }
    } else if (ch === '{' || ch === '[') {
      if (prev === '}' || prev === ']' || prev === '"') {
        problems.push({ line: prevLine, kind: 'missing', msg: `${prevLine}번째 줄 끝에 쉼표(,)가 빠진 것 같아요` });
      }
    } else if (ch === '}' || ch === ']') {
      if (prev === ',') {
        problems.push({ line: prevLine, kind: 'trailing', msg: `${prevLine}번째 줄의 마지막 쉼표(,)를 지워야 해요 (뒤에 항목이 더 없어요)` });
      }
    }
    prev = ch;
    prevLine = line;
  }
  return problems;
}
