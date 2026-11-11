# 템플릿 영상 편집기

원본 영상(예: `v1.mp4`)을 넣으면 `1.mp4`와 같은 템플릿으로 자동 편집합니다.

- 1080×1350 (인스타 4:5) 세로 캔버스
- 상단 118px 크림색(#FCFECE) 바 + 검정 박스 흰 글씨 `1 / 10` 번호 라벨
- 영상은 캔버스 높이에 맞게 확대해 바 아래 영역 중앙에 배치 (좌우·하단이 잘려 워터마크도 빠짐)

## 바로 쓰기 (설치 없음)
👉 **https://studio-vec.github.io/template-video-editor/**

브라우저 안에서 변환합니다(ffmpeg.wasm). 영상은 어디에도 업로드되지 않아요. 처음 한 번 변환 엔진(약 30MB)을 내려받고, 10초 영상 기준 약 40~60초 걸립니다. PC 크롬/엣지 권장.

## 더 빠르게: 내 PC에서 실행
필요: [Node.js](https://nodejs.org) 18 이상 (Windows / macOS / Linux)

```bash
git clone https://github.com/Studio-vec/template-video-editor.git
cd template-video-editor
npm install
npm start
```

Windows에서는 `start.bat` 더블클릭 → 브라우저에서 http://localhost:4321 이 열립니다.

> 영상 처리는 내 PC에서 ffmpeg로 이루어지며 파일이 외부로 업로드되지 않습니다.

## 사용법
1. 영상들을 오른쪽 목록에 끌어놓기 (여러 개 가능)
2. 번호는 파일명 숫자(v3 → `3 / 10`) 또는 목록 순서로 자동, 목록에서 직접 수정 가능
3. 필요하면 미리보기를 드래그(위치)/휠(확대)로 영상별 미세조정
4. **전체 편집 시작** → `output/` 폴더에 `원본이름_edit.mp4` 저장

템플릿 값(바 색·높이, 라벨 문구/위치, 확대율, 화질 등)은 왼쪽에서 바꾸고 저장/내보내기 할 수 있습니다.
