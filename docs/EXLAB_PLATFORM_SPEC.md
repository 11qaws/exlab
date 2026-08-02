# exlab 통합 플랫폼 명세

버전 기준: 1.3.33

## 1. 목적과 경계

exlab은 하나의 공유 명단으로 여러 게임을 준비하고 실행하는 운영 도구다.
공통 셸은 게임 선택, 공유 명단과 실행 안전 경계만 소유한다.
셸의 기반은 고정 라이트 UI이며 4개 스트리머 프로필의 색을 제품 chrome에
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
| `editing` | `prepare` | `generating` 또는 `waiting` | 명단·게임 설정 편집 |
| `generating` | `plan-ready` | `waiting` | 취소만 가능 |
| `generating` | `plan-failed` | `failed` | 오류 확인·재시도 |
| `waiting` | `start` | `active` | 실행 또는 준비로 복귀 |
| `waiting` | `discard-plan` | `editing` | 잠긴 계획만 폐기 |
| `active` | `result-committed` | `settling` | 게임 전환·설정 편집 금지 |
| `active` | `run-failed` | `failed` | 복구 작업만 가능 |
| `settling` | `presentation-complete` | `result` | 공개 연출만 진행 |
| `result` | `next-run` | `generating` 또는 `waiting` | 다음 조·다음 추첨 |
| `result` | `replay` | `active` | 확정 결과를 바꾸지 않는 재연출 |
| `result` | `finish-session` | `editing` | 결과 보존 후 새 설계 |
| `failed` | `recover` | `editing` | 안전한 초안으로 복귀 |

게임 내부 보조 상태는 공통 상태와 분리한다.

- Showdown: `countdown → running → result-delay → result`
- Roulette: `ready → locking → presenting → completed`

### 2.1 결과 표현 상태

게임 결과 생애주기와 결과를 보여 주는 표현 생애주기는 직교 상태로 분리한다.
표현 실패, 재연출 또는 모션 감소 설정은 이미 확정된 결과와 게임 상태를
변경하지 않는다.

```text
live → evidence → hero → docking → settled
```

| 현재 표현 상태 | 이벤트 | 다음 상태 | 화면 계약 |
|---|---|---|---|
| `live` | `result-committed` | `evidence` | 게임별 물리 근거를 계속 표시 |
| `evidence` | `evidence-complete` | `hero` | 게임 무대 기준점에서 결과 Hero 생성 |
| `hero` | `hero-complete` | `docking` | Hero와 결과 레일을 동시에 유지 |
| `docking` | `docking-complete` | `settled` | Hero를 결과 행에 결합하고 행동 활성화 |
| `settled` | `presentation-restarted` | `evidence` | 같은 결과·`runId`, 새 `presentationId` |
| 모든 상태 | 다른 실행 식별자의 이벤트 | 현재 상태 | 오래된 이벤트 폐기 |

- `runId`는 게임 실행을, `presentationId`는 같은 결과의 공개 시도를 식별한다.
- 표현 이벤트는 두 식별자가 모두 현재 값과 일치할 때만 반영한다.
- 결과 투영은 확정 시각, 승자, 공개 가능한 순위 행과 무대 내부 정규화
  기준점만 포함하는 불변 데이터다. 물리 계획의 미래 순위를 공개하지 않는다.
- 무대 기준점은 viewport 픽셀이 아니라 `{xRatio, yRatio}`로 저장하거나
  현재 카메라를 거친 화면 좌표에서 계산한다.
- 게임 Canvas·원판과 결과 레일 DOM은 `hero`, `docking`, `settled` 전환에서
  언마운트하거나 크기를 다시 계산하지 않는다.
- 공통 표현 계층은 결과를 계산하지 않고 게임 adapter가 제공한 Hero,
  순위 행, 기준점과 행동만 렌더한다.

## 3. 불변식

1. 한 번에 활성 게임 실행은 하나뿐이다.
2. `editing`을 제외한 실행 소유 상태에서는 게임 전환과 결과 영향 설정 편집을 막는다.
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

type SharedParticipant = {
  id: string;
  name: string;
  ordinal: number;
};

type SharedRosterSnapshot = {
  schemaVersion: 2;
  revision: number;
  participants: SharedParticipant[];
  allowDuplicateNames: boolean;
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

type GameHostState = {
  lifecycle:
    | "editing"
    | "generating"
    | "waiting"
    | "active"
    | "settling"
    | "result"
    | "failed";
  statusLabel?: string;
  sessionId?: string;
  runId?: string;
};

type EmbeddedGameHostProps = {
  embedded: true;
  visible: boolean;
  streamerThemeId: StreamerThemeId;
  roster: SharedRosterSnapshot;
  onRequestRosterEdit(): void;
  onHostStateChange(state: GameHostState): void;
};

type GameResultEnvelope<TPayload = unknown> = {
  schemaVersion: 1;
  gameId: GameId;
  sessionId: string;
  runId: string;
  committedAt: string;
  revealedAt?: string;
  participantSnapshot: SharedParticipant[];
  winnerIds: string[];
  rankedParticipantIds?: string[];
  metrics?: Record<string, string | number>;
  payload: TPayload;
};
```

게임 레지스트리는 직렬화 가능한 catalog와 클라이언트 런타임 로더를 분리한다.
새 게임은 catalog와 runtime 등록만으로 공통 헤더에서 선택할 수 있어야 한다.

공통 adapter의 `visible`은 현재 보이는 게임인지 나타낸다. 게임 모듈은 최초
방문 때만 lazy-load한다. 한 번 방문한 surface의 마운트 수명과 가시성을
분리해 비활성 게임의 로컬 초안은 유지하되 백그라운드 작업은 정지한다.
`active`, 원문 명단과 boolean activity callback은 한 릴리스 동안만 legacy
bridge로 유지하고 새 게임은 사용하지 않는다.
`embedded: true`인 adapter는 `EmbeddedGameHostProps` 전체를 반드시
받으며, 선택적 standalone props로 이 계약을 우회할 수 없다.

## 5. 공유 명단과 저장

- 제품 기본 명단의 단일 정본은 `레또`, `레카`, `세나`, `망징` 4명이며 공용 참가자 폼과 두 게임 미리보기·standalone fallback이 같은 배열을 사용한다.
- 참가자 identity 스냅샷: `exlab:roster:v2`
- 롤백용 원문 명단: `exlab:roster:v1`
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

공통 명단 parser는 NFKC·연속 공백·대소문자를 하나의 비교 키로 정규화하되
표시 순서와 동일 이름 occurrence를 dedupe하지 않는다. 편집 저장은 이전
스냅샷을 이름별 FIFO 큐로 reconcile해 재정렬 뒤에도 기존 참가자 ID를
보존하고, 추가·이름 변경에만 새 ID를 발급한다. 정책이 꺼져 있으면 중복
저장을 차단하고, 켜져 있으면 각 occurrence를 서로 다른 ID로 유지한다.
v2가 없거나 손상되면 v1/legacy 원문과 동일 이름 정책으로 복구한 뒤 v2와
모든 롤백 mirror를 함께 갱신한다.
과거 버전이 자동 생성한 기본 명단과 전체 참가자 문자열이 정확히 일치하고,
유효한 v2라면 revision과 참가자 ID까지 초기 생성 상태일 때만 새 4인 정본으로
reconcile한다. 변경 후에는 과거 signature와 일치하지 않아 같은 변환을 다시
적용하지 않는다. 그 밖의 사용자 명단은 `코코`, `토로리`, `토로리 코코`를
포함해도 변경하지 않는다. standalone Showdown도 같은 snapshot 읽기·쓰기
경계를 사용한다.

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

### 6.1 `SetupWorkspace` 상태와 주 행동 계약

준비 상태와 주 행동은 게임이 임의 JSX를 조립해 전달하지 않고 다음 데이터
계약으로 전달한다.

```ts
type SetupReadinessTone =
  | "ready"
  | "blocked"
  | "busy"
  | "recoverable";

type SetupReadinessModel = {
  tone: SetupReadinessTone;
  label: ReactNode;
  detail?: ReactNode;
};

type SetupPrimaryActionModel = {
  label: ReactNode;
  disabled: boolean;
  busy: boolean;
  onPress(): void;
};
```

- `SetupWorkspace`의 표준 입력은 각각 `readinessModel`과
  `primaryActionModel`이다. 기존 `readiness`와 `primaryAction` ReactNode
  슬롯은 게임별 마이그레이션 동안만 상호 배타적인 호환 경로로 유지하며 새
  게임은 사용하지 않는다.
- 복구 상태의 `새 세션`, `세션 종료`처럼 주 행동을 보조하는 동작만
  `secondaryActions`에 둘 수 있다. 주요 진행은 항상 typed 주 버튼 하나로
  유지하며 보조 동작을 별도 카드로 만들지 않는다.
- 준비 상태는 `role="status"`, `aria-live="polite"`,
  `aria-atomic="true"`로 한 번만 알린다. `detail`은 같은 상태 문장의 보충
  설명이며 별도 경고 카드로 반복하지 않는다.
- 명시적인 workspace `busy`, `readinessModel.tone === "busy"` 또는
  `primaryActionModel.busy` 중 하나라도 참이면 workspace 전체를 busy로
  본다. 루트와 상태에 `aria-busy`를 적용하고 설정 영역을 `inert`로 만들며
  주 버튼은 비활성화해 중복 실행을 막는다.
- 상태의 네 tone은 공통 테마 변수에서 파생한 표식과 문장으로 구분한다.
  색만으로 상태 의미를 전달하지 않으며 게임별 전용 상태 카드나 주 버튼
  스타일을 다시 만들지 않는다.

### 6.2 입력 유형별 옵션 그룹

필수 설정과 세부 설정은 각각 `SetupOptionGroup`과 `SetupOptionRow`를
사용해 입력 유형 순서로 묶는다. 한 영역에 존재하지 않는 유형은 건너뛰되,
각 영역 내부의 표시 순서는 항상 `text → choice → number → toggle`이다.
같은 영역 안에서 같은 유형을 여러 위치에 반복해서 흩어 놓지 않는다.

| 유형 | 공통 정렬 계약 |
|---|---|
| `text` | 설명/레이블과 입력 열을 맞추고 `input`, `textarea`, `select`는 제어 열 너비를 모두 사용한다. |
| `choice` | 공통 `SetupChoiceControl`의 `segmented` 또는 `scroll-strip` 변형을 사용한다. 두 변형 모두 40px 높이를 공유하며, 고정 선택지는 같은 너비, 가변 목록은 같은 폭 토큰의 가로 strip을 사용한다. |
| `number` | 모든 행을 `40px / minmax(64px, 1fr) / 40px`의 감소·현재 값·증가 열과 최소 40px 높이로 맞춘다. 범위가 큰 값의 중앙 열은 직접 입력 가능한 number control을 유지한다. |
| `toggle` | 설명은 유동 열, 토글은 내용 너비의 끝 열에 정렬한다. |

- 같은 유형에서는 게임과 의미가 달라도 열, 제어 높이, 레이블 기준선과
  간격을 바꾸지 않는다. 게임별 CSS는 이 공통 치수를 덮어쓰지 않는다.
- 그룹은 `fieldset`과 `legend` 의미를 사용한다. 각 제어는 자체 accessible
  name과 상태를 소유하며 그룹 제목만으로 개별 레이블을 대체하지 않는다.
- 그룹화를 이유로 카드, 배경, 그림자 또는 별도 패널을 추가하지 않는다.
  그룹 사이에는 제목, 12px 간격과 한 줄 구분선만 사용한다.

### 6.3 준비 화면 반응형 프레임

- 너비 641px·높이 600px 이상에서는 설계 화면 높이를 헤더 아래 viewport에 고정하고,
  `설정·세부 설정 / 미리보기`의 2열 프레임과 하단 준비 상태·주 행동의
  위치를 유지한다. 기본 설계 상태는 페이지와 왼쪽 설정 어느 쪽에도
  스크롤을 만들지 않으며, 641~900px에서는 패널 너비·간격·설명 밀도를
  조정해 같은 계약을 유지한다.
- 너비 640px 이하 또는 높이 599px 이하에서는 고정 높이와 내부 프레임 스크롤을 해제하고
  `설정 → 미리보기 → 세부 설정 → 준비 상태·주 행동` 순서의 자연스러운
  단일 열 문서 흐름으로 전환한다.
- 560px 이하에서는 준비 상태와 주 행동을 세로로 쌓고 주 버튼을 가로
  전체 너비로 확장한다. 프레임을 유지하려고 입력, 글자 또는 간격을
  축소하지 않는다.
- 공통 host의 `.exlab-game-instance`가 설계 화면에는 너비 641px부터,
  라이브 화면에는 너비 901px부터 `viewport - header` 높이를 제공한다.
  두 경우 모두 높이가 600px 미만이면 자연 문서 흐름을 사용한다. 게임은
  프레임 안의 설정 내용과 미리보기만 소유한다.
  Roulette의 embedded 셸과 미리보기 디렉터는 이 높이를 `100%`로
  이어받으며 자식이 부모 높이를 재정의하지 않는다. breakpoint, 영역
  순서, scroll owner와 action bar 위치는 공통
  `SetupWorkspace` 계약이다.

## 7. 모션과 접근성

- 버튼: 120~180ms
- 게임 전환: 160~220ms
- 세부 설정: 180~240ms
- 보조 시트: 220~280ms
- `prefers-reduced-motion`에서는 위치 이동과 scale을 제거한다.
- 결과 Hero는 220~280ms에 나타나고 읽기 시간을 보장한 뒤 280~400ms에
  결과 레일로 결합한다. 모션 감소 설정에서는 같은 정보 순서를 유지하고
  짧은 fade만 사용한다.
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
- 공통 설정의 참가자 수와 대화상자 저장 결과가 일치한다.
- 동일 이름 미허용이 기본이며 정책이 새로고침 뒤에도 유지된다. 허용하면
  같은 이름의 모든 occurrence가 서로 다른 참가 번호로 양쪽 게임에 남고,
  명단 재정렬 뒤에도 각 참가자 ID가 Roulette와 Showdown에서 유지된다.
- 실행 중 게임 전환이 불가능하고 준비로 복귀하면 다시 가능하다.
- 32명 Showdown 명단은 최소 4조로 자동 보정되며 조별 차이는 1명 이하다.
- Showdown의 물리 결과와 Roulette의 좌표 커밋 로직이 기존 테스트를 통과한다.
- Showdown 이력의 손상 행 제거와 구형 우승자 필드 이관이 기존 저장소에서도
  안전하게 동작한다.
- Roulette pending 결과 복구와 오래된 콜백 차단이 유지된다.
- 결과 전환 전후 Showdown `RaceCanvas`와 Roulette 원판 DOM 인스턴스가
  유지되고 장면 크기나 카메라 위치가 순간 이동하지 않는다.
- Showdown 결과 공개 뒤에도 미도착 마블과 통합 순위 레일이 같은 화면에서
  계속 갱신된다.
- Roulette Hero는 `docking`이 끝날 때까지 유지되고 최신 결과 행이 이를
  받아 표시한다.
- 상위 Roulette Vitest는 `Codex/workspace/**`를 제외해 통합 작업공간의 Node
  테스트를 수집하지 않는다.
- 큰 홍보 문구 없이 첫 화면에서 게임, 명단, 설정, 미리보기와 주 행동을
  바로 식별할 수 있다.
- 새 게임의 준비 상태와 주 행동은 typed model만으로 공통 상태 표시와
  주 버튼을 렌더하며 게임별 상태 카드나 버튼 CSS를 추가하지 않는다.
- 양쪽 게임의 옵션은 `text → choice → number → toggle` 순서와 유형별
  공통 열·높이를 지키며, 데스크톱에서는 고정 프레임, 모바일에서는
  자연스러운 단일 열 흐름을 유지한다.
- 빈 명단, 긴 한국어 이름, 1·10·11·32명, 키보드 전용,
  reduced-motion과 Showdown 맵의 라이트·다크 모드를 검증한다.
- 1600×900, 1440×900, 1024×768, 390×844 및 200% 확대에서
  의도하지 않은 가로 스크롤이 없다.
