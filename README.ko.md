# Career Radar

한국어 | [English](README.md)

Career Radar는 근거 중심의 커리어 의사결정 도구입니다. 경력을 지어내거나 적합도 판정을 채용 확률처럼 표현하지 않고, 지원할 공고를 `REALISTIC`, `STRETCH`, `PASS`로 판단하도록 돕습니다.

현재 **Milestone 3 초기 프로토타입**입니다. 지정한 Greenhouse 채용 보드에서 공고를 찾고, 소수 공고를 근거 기반으로 추천한 뒤 지원 현황까지 기록합니다. 전체 채용 시장 검색이나 공개 서비스가 아니라, 직접 써보며 다듬는 토이 프로젝트입니다.

## 1분 데모 — 키·비용 없이 보기

```bash
pnpm install
pnpm demo
```

[로컬 데모](http://127.0.0.1:8001)에서 판정 카드 세 가지와 지원 현황을 보고, **첫 번째 지원을 면접으로 변경** 버튼을 눌러 SQLite 저장소와 UI 갱신을 확인할 수 있습니다.

[추천·부족한 개수](http://127.0.0.1:8001/?view=recommendations)와 [분석 실패](http://127.0.0.1:8001/?view=failure) 화면도 볼 수 있습니다. 기존 데모가 실행 중이면 `DEMO_PORT=8002 pnpm demo`로 다른 포트를 쓰세요. 합성 데모의 공고 링크는 실제 채용 공고가 아닌 예시 주소입니다.

데모는 합성 프로필·공고·미리 작성한 판정을 사용합니다. 실제 AI 호출이나 정확도 검증이 아니며, 사용자 DB와 키를 읽지 않습니다. 데모 기록은 메모리 SQLite에서만 유지되고 재시작하면 초기화됩니다. 실제 사용은 아래 `pnpm dev` 흐름입니다.

## 아키텍처

초기 형태는 `server/`와 `web/`을 분리한 **React 위젯** 구조입니다. 현재 React UI 요구사항을 만족하는 가장 작은 구성이며, 이후 마일스톤에서 데이터 도구와 렌더링 도구를 분리할 수 있도록 확장 여지를 남겼습니다.

```text
career-radar/
  server/           # MCP 서버와 /health 엔드포인트
  web/              # Vite로 번들링하는 React 위젯
  packages/shared/  # 공유 Zod 스키마와 TypeScript 타입
  docs/             # 프로젝트 명세와 기술 결정 기록
  data/             # Git에서 제외되는 로컬 SQLite 데이터
```

MCP 구현은 OpenAI 공식 예제의 `18cc38e78a968712c357bacdc3c79fead5bfc6b4` 커밋을 기준으로 시작했으며, 상태 도구와 제품 도구 8개, 판정·추천·지원 현황 위젯을 제공합니다. 검색은 데이터만 반환하고, 최종 추천은 기존 판정처럼 결과와 위젯을 함께 반환합니다.

## 요구 사항

- Node.js 22.13 이상 (Node 24 권장; 내장 `node:sqlite` 사용)
- pnpm 10

## 로컬 실행

```bash
pnpm install
pnpm dev
```

기본적으로 서버는 `http://localhost:8000`에서 실행됩니다.

- MCP 엔드포인트: `http://localhost:8000/mcp`
- 상태 확인 엔드포인트: `http://localhost:8000/health`

`.env.example`을 Git에서 제외되는 `.env.local`로 복사한 뒤 `OPENAI_API_KEY`를 설정합니다. `OPENAI_MODEL`은 선택 사항이며 기본값은 `gpt-5-mini`입니다. 서버가 로컬에서 이 파일을 읽고, 인증 정보는 React 위젯으로 전달하지 않습니다.

## 검증 명령어

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm eval
```

## 단일 공고 판정 사용법

ChatGPT에서 Career Radar 앱을 활성화한 뒤 다음 순서로 사용합니다.

1. 이력서 텍스트를 제공해 `profile_upsert`를 호출합니다.
2. 채용 공고 본문 또는 허용된 공개 URL 하나로 `job_ingest`를 호출합니다.
3. 이 공고가 현실적인 선택인지 물어 반환된 프로필 ID와 공고 ID로 `job_assess`를 호출합니다.

4. “이 공고 저장해줘”라고 요청하면 반환된 `assessmentId`로 `application_save`를 호출합니다.
5. “지원했어”, “기술 면접으로 넘어갔어”처럼 보고하면 `application_update`가 상태를 기록합니다. 실제 지원서를 보내는 기능은 아닙니다.
6. “지원 현황 보여줘”로 `pipeline_summary` 위젯을 확인합니다.

URL은 HTTPS의 `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`만 허용합니다. 리다이렉트·DNS/IP를 재검사하고, 전체 10초·최대 1 MB·리다이렉트 3회를 제한합니다. JavaScript 실행, 로그인, 검색, 접근 제한 우회는 하지 않습니다. 읽지 못하는 페이지는 JD 본문을 붙여 넣으세요. 추출된 본문에 메뉴·동의 안내가 남을 수 있으므로 공고 내용도 확인해야 합니다.

일반 실행은 구조화된 프로필·공고·판정 스냅샷·지원 상태·변경 이력을 `data/career-radar.db`에 저장합니다. `CAREER_RADAR_DB_PATH`로 저장 위치를 바꿀 수 있고 시작 시 마이그레이션이 실행됩니다. M1의 30분 메모리 보관 정책은 **폐기되었으며 자동 삭제되지 않습니다**. 원본 이력서 텍스트는 저장하지 않지만 구조화된 프로필·판정·메모에도 개인정보가 있을 수 있습니다. DB는 암호화되지 않습니다. 기록을 전부 지우려면 서버 종료 후 `pnpm db:reset`을 실행합니다(모든 테이블 삭제 후 파일 VACUUM·WAL 잘라내기). 파일 자체를 남기지 않으려면 DB와 같은 이름의 `-wal`, `-shm` 파일까지 삭제하세요. 변경 이력에는 상태 전이만 남고 메모는 복사되지 않으므로 메모를 비우면 실제로 사라집니다. HTTP 서버는 `Host`(브라우저 요청이면 `Origin`도)가 loopback 주소인 요청에만 응답합니다. 저장한 기록은 다른 계정으로 옮길 때도 별도로 안전하게 이동해야 합니다.

저장 재시도는 기존 지원 상태와 최초 판정을 바꾸지 않습니다. 상태를 바꾸려면 `application_update`를 사용합니다. 공고 ID는 정규화된 본문의 해시라서, 같은 URL을 다시 읽었을 때 페이지 텍스트가 달라지면 별개 공고(그리고 별개 지원 기록)가 생길 수 있습니다. 사용자가 명시적으로 잘못된 기록을 정정할 수 있으며, `appliedAt`은 처음 `applied`로 기록한 서버 시각입니다(실제 지원일을 추정하지 않음). `stage`·`notes` 생략 시 기존 값을 유지하고 빈 문자열이면 비웁니다. 날짜 필터는 마지막 수정 시각의 포함 범위이며 지원일 코호트가 아닙니다. 요약의 건수는 전체, 상세 목록은 최근 100건, 위젯은 최근 10건입니다.

현재는 소유자 한 명의 로컬/비공개 개발용입니다. 인증과 사용자별 데이터 격리를 구현하지 않았으므로 공개 서비스나 여러 사용자의 공용 서버로 배포하지 마세요.

## 공고 검색과 추천 — M3

1. 공개 Greenhouse 보드 URL에 있는 토큰을 지정합니다. 예: “`greenhouse` 보드에서 engineer 공고 5개 찾아줘.” `job_search({boardToken: "greenhouse", titleKeywords: "engineer", limit: 5})`는 **모델·API 키 없이** 공식 공개 GET API를 읽습니다. 회사 보드를 자동으로 찾아내지는 않으며 토큰을 모르면 사용자에게 확인해야 합니다.
2. 직무 키워드(모든 단어 포함)와 지역 문자열 필터는 서버 안에서 처리합니다. 외부로 나가는 것은 보드 토큰뿐이며, 필터·이력서·프로필은 Greenhouse에 보내지 않습니다. 결과는 수정 시각순 최대 10개이며 **아직 적합도 판정이 아닙니다**.
3. `profile_upsert`로 만든 프로필과 검색에서 받은 `searchId`, 후보 ID 1~5개를 `job_recommend`에 전달합니다. 이 단계는 **최대 10번의 유료 OpenAI 연산**을 사용할 수 있습니다. 전체 탐색이나 자동 재시도는 하지 않습니다.
4. REALISTIC/STRETCH 목표 개수(합계 최대 5)와 PASS 설명 여부를 지정합니다. 목표는 반환 상한이 아니라 부족분 계산 기준입니다. 판정된 REALISTIC/STRETCH는 목표를 넘거나 목표가 0이어도 전부 반환합니다. 부족한 수를 채우려고 판정을 바꾸지 않습니다. 분석 실패는 PASS가 아니며 첫 실패 후 나머지 호출을 멈춥니다. 성공한 결과는 유지합니다. 같은 판정 안에서는 confidence → contortion → ID 순으로 정렬하며 합격 확률·점수 순위가 아닙니다.
5. 지원 후보로 저장하고 싶을 때만 반환된 `assessmentId`로 `application_save`를 호출합니다. 추천은 판정 스냅샷만 저장하며 지원 기록을 자동 생성하거나 기업에 지원서를 보내지 않습니다.

검색 캐시는 공개 공고만 보관하는 프로세스 메모리이며 30분, 검색 10개 × 공고 10개로 제한됩니다. 서버 재시작·만료·용량 초과 시 다시 검색해야 합니다. 추천은 한 번에 한 배치, 전체 90초 제한입니다. 다시 호출하면 새 판정과 비용이 발생할 수 있습니다. 같은 출처+본문은 기존 정규화를 재사용하고, 출처나 본문이 바뀌면 별개 공고 ID가 됩니다(M2의 붙여 넣기 ID와는 별도).

추출에 성공한 공고는 판정이 실패해도 저장되므로 해당 공고를 재시도할 때 재추출하지 않습니다. 다만 전체 배치를 다시 요청하면 이전에 성공한 공고도 재판정합니다. 중복 판정을 피하려면 실패했거나 시도하지 않은 ID만 선택하세요. 실제 비용 절감률과 후보 5개가 90초 안에 완료되는지는 라이브 모델로 측정하지 않았습니다.

제공자는 `boards-api.greenhouse.io`만 읽으며 공개 DNS/IP 확인·연결 고정, 리다이렉트 거부, 10초·5 MB 제한을 적용합니다. 인재풀 게시물이나 읽을 수 없는 본문은 제외합니다. 링크는 `job-boards.greenhouse.io`에 구성하며 응답의 임의 `absolute_url`은 따라가지 않습니다. 지원하지 않는 보드는 기존 JD 붙여 넣기를 사용하세요.

조회 시각·제공자 수정 시각(없으면 unknown)·판정 시각을 구분합니다. 방금 조회했거나 수정 시각이 최근이라는 이유로 채용 중이라고 보장하지 않습니다. 지원 전 원문을 확인하세요. 계획과 검증 범위는 [Milestone 3](docs/MILESTONE_3.md)에 정리합니다.

## ChatGPT에서 연결하기

1. `pnpm dev`로 로컬 서버를 실행합니다.
2. [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)을 만들어 로컬 `http://localhost:8000/mcp`에 연결합니다. 개발 중에는 로컬 서버를 공개 인터넷에 노출하지 않아도 되는 이 방식을 권장합니다.
3. ChatGPT의 **설정 → 보안 및 로그인**에서 개발자 모드를 활성화합니다.
4. **ChatGPT Plugins**에서 개발자 모드 앱을 만들고 Secure MCP Tunnel을 선택합니다. 공개 HTTPS 개발 주소가 있다면 `https://example.ngrok.app/mcp`처럼 `/mcp`가 포함된 URL을 대신 사용할 수 있습니다.
5. 새 대화에서 앱을 활성화하고 “Career Radar 상태를 보여줘”라고 요청합니다.
6. MCP 도구 또는 리소스 메타데이터를 변경했다면 앱 연결 화면에서 새로고침합니다.

Secure MCP Tunnel은 개발 및 비공개 연결용이며 공개 Plugin 제출에는 사용할 수 없습니다. 공개 제출에는 안정적인 공개 HTTPS MCP 서버가 필요합니다.

터널 인증용 OpenAI API 키는 브라우저나 React 위젯에 넣지 말고 서버 프로세스의 환경 변수로만 전달하세요. 로컬에서는 Git에서 제외된 `.env.local`을 사용할 수 있습니다. GitHub Actions에서 실제로 터널이나 배포 작업을 실행할 때만 GitHub Actions Secret을 사용하며, 저장소 파일에는 키를 커밋하지 않습니다. 계정을 바꾸더라도 새 계정에서 키와 터널을 다시 만들고 ChatGPT 앱 연결만 갱신하면 같은 저장소에서 이어갈 수 있습니다.

## 현재 범위

구현됨:

- pnpm 워크스페이스
- 공유 Zod 상태 스키마
- Stateless Streamable HTTP MCP 엔드포인트
- 읽기 전용 `career_radar_status` 도구
- `profile_upsert`, URL/텍스트 `job_ingest`, `job_assess` 도구
- `application_save`, `application_update`, `pipeline_summary` 도구
- `job_search`, `job_recommend`: 제한된 검색·추천, 부족한 개수/실패 구분, 출처·조회 시각
- 로컬 SQLite 영속화·마이그레이션·판정 스냅샷·상태 변경 이력
- Zod로 검증하는 OpenAI Responses API structured output
- 근거 연결과 hard blocker를 확인하는 결정론적 후처리
- Job Assessment Card를 포함한 MCP Apps UI 리소스
- 기존 16개를 보존한 합성 정책 계약 28개, 버전별 로컬 JSON/Markdown 보고서와 기준 결과 비교
- lint, typecheck, build, 단위 테스트 스크립트

아직 구현되지 않음:

- 여러 제공자를 넘나드는 전체 채용 시장 검색
- 공개 배포·사용자 인증·자동 지원
- 실제 모델과 ChatGPT 호스트를 통한 M2/M3 종단 간 검증 (공개 보드 조회·로컬 합성 테스트와 별개)

전체 마일스톤은 [프로젝트 명세](docs/PROJECT_SPEC.md)를 참고하세요.

`pnpm typecheck`는 서버·위젯뿐 아니라 테스트와 eval fixture도 검사합니다. `pnpm eval`은 모델 호출 없이 후처리 정책만 검증하므로 결과를 모델 정확도로 해석하면 안 됩니다. 근거 일치 검사도 구조화된 프로필을 기준으로 하며 원본 이력서의 추출 정확도까지 보장하지 않습니다.

### M4-A 평가 도구

`pnpm eval`은 Git에서 제외된 `evals/reports/` 아래에 실행별 보고서를 저장합니다.
저장 없이 검사하려면 `--no-save`, 이전 실행과 비교하려면
`--baseline evals/reports/<run>/report.json`을 사용하세요. 입력·기대값이 같은
사례만 비교하며, 분자/분모·빈 분모의 N/A·실행 오류/건너뜀·필수조건 ID와
데이터셋/정책/스키마/코드 버전을 기록합니다.
28개 사례의 사람에 의한 적합도 라벨 검토는 모두 대기 상태입니다. 정책 테스트
통과가 사람 검토 완료나 새 screening 기능·모델 품질 검증을 의미하지 않습니다.
[평가 사용법](evals/README.md)과 [검토 양식](evals/REVIEW_TEMPLATE.md)을 참고하세요.
보고서는 DB와 별도 파일이므로 `pnpm db:reset`으로 지워지지 않습니다.

## 참고 문서

- [Plugin 빠른 시작](https://developers.openai.com/plugins/build/app-quickstart)
- [도구 정의](https://developers.openai.com/plugins/plan/tools)
- [MCP 서버 구축](https://developers.openai.com/plugins/build/mcp-server)
- [MCP 서버에 UI 추가](https://developers.openai.com/plugins/build/chatgpt-ui)
- [ChatGPT 연결 및 테스트](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Plugin 레퍼런스](https://developers.openai.com/plugins/reference)
