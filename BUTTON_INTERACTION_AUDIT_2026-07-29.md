# Ex Lab 버튼 상호작용 감사와 적용 명세

작성일: 2026-07-29
대상 버전: 1.3.21 → 1.3.22

## 1. 사용자 과업

- 1차 과업: 모든 보이는 버튼에서 `누르기 시작 → 실행 → 결과 상태`가 끊기지 않도록 즉시 피드백을 제공한다.
- 2차 과업: 선택형 버튼은 현재 선택값, 실행형 버튼은 실행 중·비활성 상태를 명확히 구분한다.
- 범위: 공통 헤더와 모달, 공통 설계 화면, Roulette 설계·방송·결과 화면, Showdown 설계·경기 화면.
- 비범위: 레이아웃 재배치, 게임 규칙 변경, 보이지 않는 모달 배경 닫기 버튼의 장식.

## 2. 정보와 상태의 노출 수준

| 구분 | 항상 표시 | 요청 시 표시 | 숨김 |
| --- | --- | --- | --- |
| 실행 가능 | 기본 버튼 표면과 레이블 | hover 시 밝기·경계 변화 | 없음 |
| 누르는 중 | 압축과 명도 변화 | 없음 | 동작 종료 후 즉시 해제 |
| 현재 선택 | 선택색, 테두리 또는 채움 | 없음 | 다른 값을 선택하면 해제 |
| 키보드 초점 | `focus-visible` 외곽선 | 없음 | 포인터 클릭에서는 숨김 |
| 실행 중 | 진행 문구와 비활성 상태 | 필요한 작업에만 표시 | 완료 후 해제 |
| 비활성 | 낮은 대비와 금지 커서 | 없음 | 활성화되면 해제 |

## 3. Keep / Delete / Merge / Move / Reveal

- Keep: 기존 버튼 위치와 문구, 각 게임의 고유 색상, Roulette의 눌리는 키캡 스타일, 테마 카드의 선택 체크, 모든 네이티브 버튼 의미와 키보드 동작.
- Delete: Showdown 주 버튼 hover의 아모레또 전용 하드코딩 색 `#8f1740`. 선택 테마의 `--accent-dark`에서 계산한다.
- Merge: 여러 파일에 흩어진 순간 피드백을 공통 셸의 `hover / active / disabled / aria-disabled` 계약으로 합친다. 게임별 선택색은 기존 선택자에 남긴다.
- Move: 버튼이나 정보의 물리적 위치는 옮기지 않는다. 이 작업은 레이아웃이 아니라 상태 전달 개선이다.
- Reveal: Showdown 음향 토글의 `aria-pressed="true"`를 색과 inset ring으로 드러낸다. disclosure(`summary`)와 체크형 label도 표면 반응을 보인다.

## 4. 대안 비교

### A안 — 표면 반응 계약

```text
[기본] ──hover──> [미세한 명도/채도 변화]
  │                         │
  └────pointer down────────> [0.97배 압축 + 진한 표면]
                              │
                              └─release─> [기본 또는 선택 상태]
```

- CSS 상태만 사용해 버튼이 화면 전환으로 사라져도 타이머가 남지 않는다.
- 기존 Roulette의 `transform: translateY()`와 충돌하지 않도록 개별 `scale` 속성을 사용한다.
- 마우스, 터치, 키보드에서 같은 의미 구조를 유지한다.

### B안 — 클릭 리플 레이어

```text
[버튼] + [클릭 좌표의 원형 레이어]
             └── JS timer로 확장·소멸
```

- 클릭 위치가 강조되는 장점이 있지만 모든 버튼에 DOM 또는 이벤트 위임이 필요하다.
- 모달 닫기·화면 전환 버튼은 클릭 직후 제거되어 연출이 잘릴 수 있고, 캔버스 게임 위 합성 비용도 늘어난다.

권장안은 A안이다. 현재 문제는 “실행 결과가 없음”이 아니라 “누르는 순간이 보이지 않음”이므로, 짧고 일관된 표면 반응이 가장 직접적이다.

## 5. 상태·모션 지도

| 시작 | 입력 | 도착 | 시각 규칙 | 시간 |
| --- | --- | --- | --- | --- |
| idle | pointer hover | hover | 명도·채도·테두리 미세 강조 | 140ms |
| idle/hover | pointer down | pressed | `scale: .97`, 명도 감소 | 60ms |
| pressed | release | idle/action | 1배로 복귀, 액션 실행 | 120ms |
| action | 값 선택 | selected | 기존 선택색 유지, 필요 시 inset ring | 지속 |
| action | 비동기 실행 | busy | 실행 문구 + disabled/aria-disabled | 완료까지 |
| any | keyboard focus | focused | 3px 테마 외곽선 | 포커스 동안 |
| any | disabled | disabled | opacity 감소, 금지 커서, press 제거 | 활성화까지 |
| any | reduced motion | 동일 의미 상태 | 이동·크기 변화 제거, 색·테두리만 즉시 변경 | 0.01ms |

## 6. 코드 적용 범위

- `app/globals.css`
  - 보이는 공통 버튼의 전환·hover·press·disabled 계약.
  - 테마/명단 모달 버튼, 카페 댓글 disclosure, 동일 이름 체크 label의 상태 보강.
  - 모달 scrim 버튼은 공통 장식에서 제외.
- `app/_platform/components/SharedSetupSummary.css`
  - 명단 편집 버튼의 상태 계약 보완.
- `app/_platform/components/SetupWorkspace.css`
  - 고급 설정 disclosure 반응 보완.
- `app/_platform/theme/streamer-theme-picker.css`
  - 선택 카드의 pointer-down 압축만 추가하고 기존 hover·선택·확정 연출을 유지.
- `app/marble/showdown-game.css`
  - theme/group/text/icon/toggle/primary/secondary 버튼의 상태 일관성.
  - 음향 토글의 눌림 상태와 테마 상대 hover 색 추가.
- `app/games/roulette/**/*.css`
  - 이미 있는 키캡형 버튼은 유지하고, segmented tab·목록 action·modal action처럼 누락된 계열에 공통 press가 적용되는지 검증.

## 7. 브라우저 인수 기준

- 1280×720, 1024×768, 390×844에서 버튼 피드백 때문에 줄바꿈, 넘침, 스크롤 또는 레이아웃 이동이 새로 생기지 않는다.
- 공통 헤더, 테마 선택창, 명단 편집창, Roulette 설계·방송, Showdown 설계·경기에서 보이는 버튼을 누르면 첫 프레임부터 압축 또는 명도 변화가 확인된다.
- 선택형 버튼은 release 뒤에도 현재 선택 상태가 남고, 실행형 버튼은 결과 화면·문구·busy 상태로 자연스럽게 이어진다.
- disabled 및 `aria-disabled="true"` 버튼은 press 효과와 실행이 없다.
- Tab 탐색 시 기존 `focus-visible` 외곽선이 유지되고 Enter/Space 실행 뒤 상태가 갱신된다.
- `prefers-reduced-motion: reduce`에서는 크기·위치 변화가 제거되지만 색·테두리 피드백은 남는다.
- 테마별로 Showdown 주 버튼 hover가 아모레또 색으로 되돌아가지 않는다.
