# exlab 프로젝트 규칙

이 파일이 exlab 저장소의 지침 정본이다. 도구별 파일(`CLAUDE.md` 등)은 이 파일을 가리키는 어댑터일 뿐이며, 규칙을 따로 담지 않는다.

## 0. 시작하기 전에

- 이 저장소가 공용 작업 공간 아래에 놓여 있다면(`../../AGENTS.md`, `../../docs/rules/`가 존재한다면) 그 파일들을 read 도구로 직접 읽고 함께 따른다. 도구가 자동으로 올려 주기를 기대하지 않는다.
- **작업 전에 `git fetch` 후 원격과의 차이를 확인한다.** 이 저장소는 여러 도구·기기에서 다뤄지므로 로컬 클론이 뒤처져 있을 수 있다. 파일 크기나 구조를 근거로 판단하기 전에 그 파일이 최신인지 먼저 본다. 오래된 베이스 위에서 측정한 값은 전부 무효다.

## 1. 제품

exlab은 하나의 운영 셸에서 `Roulette`(룰렛 추첨)와 `Showdown`(마블 레이스)을 선택해 실행하는 방송용 게임 도구다. 공유 명단, 스트리머 테마, 결과 연출 생애주기를 두 게임이 공통 계층에서 나눠 쓴다.

## 2. 먼저 읽을 문서

| 문서 | 다룰 때 |
| --- | --- |
| `README.md` | 버전별 범위와 제품 전반 |
| `docs/EXLAB_PLATFORM_SPEC.md` | 공통 상태·저장·게임 adapter 계약 |
| `docs/EXLAB_SHOWDOWN_SYSTEM_SPEC.md` | 명단·조 편성·풀 패키지 계약 |
| `docs/DESIGN_FINDINGS.md` | 물리·연출 측정값과 폐기한 시안 |
| `docs/GAMEPLAY_VARIATION_DESIGN.md` | 물리 변화 후보와 적용 기준 |
| `docs/ROULETTE_UX_AUDIT_2026-07-28.md` | Roulette 화면·상태 감사 |
| `docs/BUTTON_INTERACTION_AUDIT_2026-07-29.md` | 클릭 요소 상태 계약 |
| `DEVELOPMENT_LOG.md` | 트러블슈팅·버그·해결 과정 (작업 중 갱신 의무) |

## 3. 구조 경계

```
app/_platform/      공통 계층. 명단·저장·테마·프레젠테이션 머신
app/games/roulette/ 룰렛 게임 본체
app/games/showdown/ Showdown 게임 본체
tests/              회귀·계약 테스트
scripts/            벤치마크와 Pages 빌드 검증
pages-static/       GitHub Pages 미러 진입점
```

- 게임 사이의 값은 직접 주고받지 않는다. 공유가 필요하면 `app/_platform/contracts.ts` 계약을 거친다.
- 크기·간격·radius·컨트롤 높이는 `app/globals.css`의 `:root` 눈금에서 고른다. 맞는 단이 없으면 생 px를 쓰지 말고 단을 추가한다. 전체 높이가 필요하면 `--exlab-stage-min-height`(svh) 또는 `--exlab-stage-height-dynamic`(dvh)를 쓰고, 뷰포트에서 헤더 높이를 직접 빼지 않는다. `tests/shell-scale-contract.test.ts`가 강제한다.
- 스타일은 `.roulette-game`, `.showdown-game` 스코프로 격리한다.
- 새 게임은 catalog와 adapter 계약 등록으로 추가한다.

## 4. 검증

```
npm run lint                                   ESLint
npm test                                       회귀 테스트 (빌드 없이 빠르게)
npm run test:ci                                빌드 + 테스트 (CI 와 동일)
npm run pages:build && npm run pages:verify    Pages 미러와 자산 경로
```

- 물리·코스를 건드렸으면 `benchmark:stalls` / `benchmark:obstacles` / `benchmark:positions`로 수치를 다시 재고 결과를 `DEVELOPMENT_LOG.md`에 남긴다.
- `course-clearance.ts`의 불변식(오브젝트 쌍 최소 간격, 통과 폭, 양측 벽 장애물)은 테스트가 강제한다. 실패하면 기준을 낮추지 말고 코스를 고친다.
- 빌드 성공은 디자인 검증이 아니다. 화면을 바꿨으면 실제 브라우저에서 여러 폭·긴 한국어 이름·빈 명단·최대 인원·키보드 조작·reduced-motion을 확인한다.

## 5. 배포

- 수정 후에는 검증을 마치고 최신 소스를 비공개 Sites 환경에 배포한다.
- 비공개 배포가 성공하면 그 URL을 사용자가 바로 열어 볼 수 있게 안내한다.
- 비공개 배포가 불가능하면 공개 배포로 임의 전환하지 않고 원인과 필요한 다음 조치를 보고한다.
- GitHub Pages는 `/exlab/` 하위 경로 공개 미러다. 자산을 절대경로로 참조하지 않으며, 경로가 어긋나면 `scripts/verify-pages-build.mjs`가 잡는다.

## 6. 커밋과 배포 단위

- 검토를 모두 끝낸 뒤 사용자와 협의하고 승인을 받은 다음에 커밋한다.
- **푸시 전에 `git fetch`로 원격과의 차이를 확인한다.** 원격이 앞서 있으면 강제 푸시하지 않고 상황을 먼저 보고한다.
- 버전은 커밋 단위가 아니라 배포 단위로 올린다. 일반 배포는 patch, 하위 호환이 깨지면 minor를 올리고 patch를 0으로 되돌린다. major는 사용자가 직접 지시할 때만 올린다.
- 버전 표기는 `package.json`, `app/_platform/catalog.ts`의 두 게임 항목, Showdown 화면 배지, `README.md`에 있고 `tests/rendered-html.test.mjs`가 고정한다. 한 곳만 고치면 테스트가 막는다.
- 파생 산출물(`dist/`, `dist-pages/`, `graphify-out/`, 에이전트 작업 폴더)은 커밋하지 않는다.
- **의존성을 바꾸면 락파일이 플랫폼 편향되지 않았는지 확인한다.** Windows에서 `npm install`을 돌리면 다른 플랫폼 전용 선택적 패키지(`@rolldown/binding-wasm32-wasi` 아래 중첩된 `@emnapi/*` 등)가 락파일에서 잘리고 CI의 `npm ci`가 sync 오류로 실패한다. `--package-lock-only`도 이 가지치기를 막지 못한다. 락파일이 깨지면 통째로 재생성하지 말고, 이전 커밋의 락파일과 패키지 키를 비교해 무엇이 왜 사라졌는지 분류한 뒤 잘못 잘린 항목만 되돌린다.

## 7. 만들기 전에 찾는다

- 새 유틸·상수·컴포넌트를 만들기 전에 영어 식별자로 저장소를 먼저 검색한다. "없다"는 판단은 전수 조회로만 내린다.
- 같은 정보가 두 곳에 생기면 한쪽을 손으로 맞추지 말고 단일 진실원에서 생성한다.
- 저장 키는 하위 호환 경계다. `exlab:*`와 레거시 `marble-game:roster`, `retto-*` 키는 이름을 바꾸지 않는다.
