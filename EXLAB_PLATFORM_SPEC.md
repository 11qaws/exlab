# exlab 통합 플랫폼 명세

버전 기준: 1.3.1

## 1. 목적과 경계

exlab은 하나의 공유 명단으로 여러 게임을 준비하고 실행하는 운영 도구다.
공통 셸은 게임 선택, 공유 명단과 실행 안전 경계만 소유한다.
셸의 기반은 고정 라이트 UI이며 5개 스트리머 프로필의 색을 제품 chrome에
적용하는 공통 identity 테마를 선택·저장한다. Showdown의 맵 라이트·다크
모드와 참가자·장애물 의미 색은 이 identity 테마와 분리한다.
각 게임은 설정, 계획 생성, 진행 연출, 결과 확정과 게임별 기록을 소유한다.

- 공통 주 작업: `참가자 N명에서 공유 명단 확인 → 게임 선택 → 방송 화면 열기 → 수동 시작 → 결과`
- Showdown: 내부 Race 엔진에서 사전에 우승자를 정하지 않고 물리 완주 순서로 결과를 확정한다.
- Roulette: 원판 또는 다트의 물리 좌표로 결과를 커밋한 뒤 그 결과를 공개한다.
- 공통 셸은 게임별 결과 생성 알고리즘을 호출하거나 변경하지 않는다.

## 2. 공통 중심 상태

| 현재 상태 | 이벤트 | 다음 상태 | 허용 작업 |
|---|---|---|---|
| `editing` | `prepare` | `generating` | 명단·게임 설정 편집 |
| `generating` | `plan-ready` | `waiting` | 취소만 가능 |
| `generating` | `plan-failed` | `editing` | 오류 확인·재시도 |
| `waiting` | `start` | `active` | 실행 또는 준비로 복귀 |
| `waiting` | `discard-plan` | `editing` | 잠긴 계획만 폐기 |
| `active` | `result-committed` | `settling` | 게임 전환·설정 편집 금지 |
| `active` | `run-failed` | `failed` | 복구 작업만 가능 |
| `settling` | `presentation-complete` | `result` | 공개 연출만 진행 |
| `result` | `next-run` | `generating` | 다음 조·다음 추첨 |
| `result` | `finish-session` | `editing` | 결과 보존 후 새 설계 |
| `failed` | `recover` | `editing` | 안전한 초안으로 복귀 |

게임 내부 보조 상태는 공통 상태와 분리한다.

- Showdown: `countdown → running → result-delay → result`
- Roulette: `ready → locking → presenting → completed`

## 3. 불변식

1. 한 번에 활성 게임 실행은 하나뿐이다.
2. `waiting`, `active`, `settling` 동안 게임 전환과 결과 영향 설정 편집을 막는다.
3. 실행마다 새 `runId`를 발급하고 오래된 실행의 콜백은 무시한다.
4. 실행당 결과 확정 이벤트는 한 번만 반영한다.
5. 결과 발표는 결과 확정 이후에만 가능하다.
6. 다시 보기는 결과와 `runId`를 바꾸지 않고 표현 식별자만 새로 만든다.
7. 공유 명단 변경은 안전한 준비 상태에서만 각 게임으로 동기화한다.
8. 첫 진입에는 마지막 선택 게임만 지연 로드하고, 사용자가 방문한 게임 surface만 keep-alive로 마운트해 설정 초안을 보존한다.
9. 방문하지 않은 게임 코드는 로드하지 않는다. 방문 후 비활성 surface에는 `active=false`를 전달하며 미리보기, 타이머와 애니메이션을 진행하지 않는다.
10. 동일 이름 정책은 공통 셸이 하나만 소유한다. 기본값은 미허용이며 허용 시 중복 입력의 각 occurrence를 별도 참가자로 보존한다.

## 4. 공통 데이터 계약

```ts
type GameId = string;

type RosterEntry = {
  id: string;
  name: string;
  number: number;
  themeKey: string;
};

type GameManifest = {
  id: GameId;
  label: string;
  version: string;
  capabilities: {
    grouping: false | "optional" | "required";
    configurableWinnerCount: boolean;
    replay: boolean;
  };
};

type EmbeddedGameProps = {
  embedded?: boolean;
  active?: boolean;
  rosterText: string;
  onRosterTextChange(next: string): void;
  allowDuplicateNames: boolean;
  onAllowDuplicateNamesChange(allow: boolean): void;
  onActivityChange(active: boolean): void;
};

type GameResultEnvelope<TPayload = unknown> = {
  schemaVersion: 1;
  gameId: GameId;
  sessionId: string;
  runId: string;
  committedAt: string;
  revealedAt?: string;
  participantSnapshot: RosterEntry[];
  winnerIds: string[];
  rankedParticipantIds?: string[];
  metrics?: Record<string, string | number>;
  payload: TPayload;
};
```

게임 레지스트리는 직렬화 가능한 catalog와 클라이언트 런타임 로더를 분리한다.
새 게임은 catalog와 runtime 등록만으로 공통 헤더에서 선택할 수 있어야 한다.

공통 adapter의 `active`는 현재 보이는 게임인지 나타낸다. 게임 모듈은 최초
방문 때만 lazy-load한다. 한 번 방문한 surface의 마운트 수명과 가시성을
분리해 비활성 게임의 로컬 초안은 유지하되 백그라운드 작업은 정지한다.

## 5. 공유 명단과 저장

- 공통 키: `exlab:roster:v1`
- 마지막 게임: `exlab:last-game:v1`
- 동일 이름 정책: `exlab:allow-duplicate-names:v1` (`0`이 기본, 허용은 `1`)
- 스트리머 테마: `exlab:theme:v1`
- Showdown의 기존 Race 저장 키 `marble-game:roster`는 통합 키가 없을 때 한 번 가져온다.
- 공통 명단을 저장할 때 `exlab:roster:v1`, 이전 `ex-lab:roster:v1`,
  `marble-game:roster`를 함께
  갱신해 구버전으로 롤백해도 최신 명단을 읽을 수 있게 한다.
- 기존 Roulette는 다른 origin이므로 브라우저 저장소를 자동으로 읽지 않는다.
  기존 결과는 레거시 사이트를 유지하고 CSV/JSON 가져오기로 이전한다.
- Roulette 가중치, 상품, 제외 명단은 게임 전용 상태이며 Showdown에 전달하지 않는다.
- Showdown 이력은 저장 JSON이 배열인지 확인하고 필수 필드를 행별 검증한다.
  손상된 행은 제외하고 구형 단일 `winnerName`은 `winnerNames` 배열로 이관한다.
- 공통 셸은 `exlab:theme:v1`에 스트리머 identity 테마를 저장한다. Showdown
  맵 모드는 해당 게임 전용 설정으로만 관리하고, identity 테마가 물리·결과
  또는 참가자·장애물 의미 색을 바꾸지 않는다.

공통 명단 parser는 빈 행만 제거하며 동일 이름을 dedupe하지 않는다. 허용
정책이 꺼져 있으면 저장을 차단하고, 켜져 있으면 입력 순서와 occurrence 수를
그대로 보존해 각 게임이 서로 다른 참가 번호를 부여한다.

## 6. UI 정보 우선순위

항상 표시:

- exlab, 현재 게임, 현재 단계
- 공통 헤더의 `참가자 N명` 명단 편집 진입점과 실행 차단 사유
- 게임 실행에 필요한 필수 설정과 주 행동 하나
- 실제 명단이 반영된 미리보기

요청 시 표시:

- 전체 명단 편집 대화상자와 공통 동일 이름 허용 설정
- 가중치·상품·시드·코스 범례·실행 감사 정보
- 최근 기록과 내보내기

실행 중 숨김:

- 게임 전환, 명단과 결과 영향 설정 편집
- 배치 재생성, 파괴적 초기화, 버전 배지

Showdown 준비 화면의 홍보형 제목과 장문 소개는 제거한다. 게임 이름, 설정,
미리보기, 준비 상태와 주 행동만 남긴다.

## 7. 모션과 접근성

- 버튼: 120~180ms
- 게임 전환: 160~220ms
- 세부 설정: 180~240ms
- 보조 시트: 220~280ms
- `prefers-reduced-motion`에서는 위치 이동과 scale을 제거한다.
- 매 프레임 갱신되는 Showdown 시계는 `aria-live`에서 제외한다.
- 결과 확정, 골인과 실행 오류만 비차단 상태 메시지로 알린다.
- 참가자 구분은 색상 외에 번호와 이름을 항상 함께 사용한다.
- 명단 대화상자는 `dialog` 의미, 초점 순환, Escape/배경 닫기와 저장하지 않은
  변경 폐기 확인을 제공한다. 실행 중에는 열 수 없다.

## 8. 스타일 격리와 타이포그래피

- Showdown CSS는 `.showdown-game`, Roulette CSS는 `.roulette-game`을
  `@scope` 루트로 사용해 다른 게임과 공통 셸로 선택자가 새지 않게 한다.
- 공통 셸은 전체 하위 요소의 기존 게임별 서체 선언을 덮어쓴다.
- 공통 폴백 순서는 `Inter → Pretendard → Noto Sans KR/시스템 sans-serif`다.
- 본문과 제목 모두 산세리프를 사용하며 위계는 굵기와 자간으로 구분한다.

## 9. 완료 조건

- Roulette와 Showdown을 바꿔도 같은 공유 명단이 유지된다.
- 초기 선택 게임만 로드되고, 방문한 게임을 왕복해도 각 편집 초안은
  유지되며 비활성 게임의 미리보기는 정지한다.
- 헤더의 참가자 수와 대화상자 저장 결과가 일치한다.
- 동일 이름 미허용이 기본이며 정책이 새로고침 뒤에도 유지된다. 허용하면
  같은 이름의 모든 occurrence가 서로 다른 참가 번호로 양쪽 게임에 남는다.
- 실행 중 게임 전환이 불가능하고 준비로 복귀하면 다시 가능하다.
- 32명 Showdown 명단은 최소 4조로 자동 보정되며 조별 차이는 1명 이하다.
- Showdown의 물리 결과와 Roulette의 좌표 커밋 로직이 기존 테스트를 통과한다.
- Showdown 이력의 손상 행 제거와 구형 우승자 필드 이관이 기존 저장소에서도
  안전하게 동작한다.
- Roulette pending 결과 복구와 오래된 콜백 차단이 유지된다.
- 상위 Roulette Vitest는 `Codex/workspace/**`를 제외해 통합 작업공간의 Node
  테스트를 수집하지 않는다.
- 큰 홍보 문구 없이 첫 화면에서 게임, 명단, 설정, 미리보기와 주 행동을
  바로 식별할 수 있다.
- 빈 명단, 긴 한국어 이름, 1·10·11·32명, 키보드 전용,
  reduced-motion과 Showdown 맵의 라이트·다크 모드를 검증한다.
- 1600×900, 1440×900, 1024×768, 390×844 및 200% 확대에서
  의도하지 않은 가로 스크롤이 없다.
