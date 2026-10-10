#!/usr/bin/env python3
"""
퀴즈 앱용 간단 웹서버 (캐시 끔).

사용법:  이 폴더 안에서  python3 serve.py
         (포트를 바꾸려면 python3 serve.py 9000)

python3 -m http.server 와 다른 점
  1) 브라우저가 옛 quizzes.json / 이미지 / js 를 재사용하지 못하게 한다 (고치고 새로고침하면 바로 반영)
  2) 어느 폴더를 보여주고 있는지, 퀴즈·이미지가 몇 개인지 시작할 때 알려준다
  3) 휴대폰에서 접속할 주소를 알려준다
"""
import http.server
import json
import os
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 404(파일 없음)만 눈에 띄게 보여준다 — 이미지 이름이 틀렸을 때 바로 알 수 있다.
        msg = fmt % args
        if " 404 " in msg or msg.rstrip().endswith("404 -"):
            sys.stderr.write(f"  ⚠️  없는 파일 요청: {self.path}\n")
        elif "/data/quizzes.json" in self.path:
            sys.stderr.write(f"  ↻ quizzes.json 읽음\n")

    # 확장자가 없는 .webmanifest 등 일부 형식 보강
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
    }


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # 실제로 보내지는 않고 사용할 네트워크 주소만 확인한다
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def summarize():
    print("=" * 60)
    print(f"  보여주는 폴더 : {ROOT}")
    if not (ROOT / "index.html").exists():
        print("  ❌ 이 폴더에 index.html 이 없어요. 폴더를 잘못 열었을 수 있어요.")
    qpath = ROOT / "data" / "quizzes.json"
    if not qpath.exists():
        print("  ❌ data/quizzes.json 이 없어요.")
    else:
        try:
            data = json.loads(qpath.read_text(encoding="utf-8-sig"))
            img_dir = ROOT / "images"
            all_entries = list(img_dir.rglob("*")) if img_dir.exists() else []
            files = [p for p in all_entries if p.is_file()]
            top_names = {p.name for p in img_dir.glob("*")} if img_dir.exists() else set()
            missing = [q.get("imageName") for q in data if isinstance(q, dict) and f"{q.get('imageName')}.png" not in top_names]
            print(f"  quizzes.json  : 문제 {len(data)}개")
            print(f"  images 폴더   : 파일 {len(top_names)}개")

            # 흔한 실수 1) Xcode 의 ○○.imageset 폴더를 통째로 복사함
            nested = [p for p in all_entries if p.is_dir() and p.name.endswith(".imageset")]
            if nested:
                print(f"  ⚠️  images 안에 .imageset 폴더가 {len(nested)}개 있어요. 폴더 안의 PNG 파일만 꺼내서 images/ 바로 아래에 두세요.")

            if missing:
                print(f"  ⚠️  이미지가 없는 문제 {len(missing)}개")
                by_lower = {}
                for p in files:
                    by_lower.setdefault(p.stem.lower(), []).append(p)
                shown = 0
                for name in missing:
                    if shown >= 8:
                        print(f"     … 외 {len(missing) - shown}개")
                        break
                    cand = by_lower.get(str(name).lower())
                    if cand:
                        print(f"     - '{name}.png' 없음 → 비슷한 파일 발견: {cand[0].relative_to(img_dir)}  (이름/확장자를 맞춰 주세요)")
                    else:
                        print(f"     - '{name}.png' 없음")
                    shown += 1
                print("     → 전체 목록은 브라우저에서 /check.html 을 열어 보세요")
            else:
                print("  ✅ 모든 문제의 이미지가 있어요")
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ quizzes.json 형식 오류: {e}")
            print("     → 브라우저에서 /check.html 을 열면 어느 줄인지 알려줘요")
    print("-" * 60)
    print(f"  이 컴퓨터   : http://localhost:{PORT}")
    ip = local_ip()
    if ip:
        print(f"  휴대폰(같은 와이파이) : http://{ip}:{PORT}")
    print(f"  데이터 점검 : http://localhost:{PORT}/check.html")
    print("  끝내려면 Ctrl + C")
    print("=" * 60)


if __name__ == "__main__":
    summarize()
    try:
        with http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler) as httpd:
            httpd.serve_forever()
    except OSError as e:
        print(f"\n❌ 서버를 시작하지 못했어요: {e}")
        print(f"   이미 다른 서버가 {PORT} 포트를 쓰고 있을 수 있어요. 이전 터미널을 Ctrl+C 로 끄거나")
        print(f"   python3 serve.py {PORT + 1}  처럼 다른 번호로 실행하세요.")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n서버를 종료했어요.")
