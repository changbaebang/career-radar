# Career Radar

한국어 | [English](README.md)

Career Radar는 근거 중심의 커리어 의사결정 도구입니다. 경력을 지어내거나 적합도 판정을 채용 확률처럼 표현하지 않고, 지원할 공고를 `REALISTIC`, `STRETCH`, `PASS`로 판단하도록 돕습니다.

현재 저장소에는 **Milestone 0만 구현**되어 있습니다. TypeScript 워크스페이스, Node MCP 서버, 읽기 전용 데모 도구, ChatGPT용 최소 React 위젯을 포함합니다.

## 아키텍처

초기 형태는 `server/`와 `web/`을 분리한 **React 위젯** 구조입니다. 현재 React UI 요구사항을 만족하는 가장 작은 구성이며, 이후 마일스톤에서 데이터 도구와 렌더링 도구를 분리할 수 있도록 확장 여지를 남겼습니다.

```text
career-radar/
  server/           # MCP 서버와 /health 엔드포인트
  web/              # Vite로 번들링하는 React 위젯
  packages/shared/  # 공유 Zod 스키마와 TypeScript 타입
  docs/             # 프로젝트 명세와 기술 결정 기록
  data/             # 이후 마일스톤에서 사용할 로컬 전용 데이터 위치
```

MCP 구현은 OpenAI 공식 예제의 `18cc38e78a968712c357bacdc3c79fead5bfc6b4` 커밋을 기준으로 하며, Career Radar 상태 도구 하나와 위젯 하나만 남긴 최소 구성입니다.

## 요구 사항

- Node.js 22 이상
- pnpm 10

## 로컬 실행

```bash
pnpm install
pnpm dev
```

기본적으로 서버는 `http://localhost:8000`에서 실행됩니다.

- MCP 엔드포인트: `http://localhost:8000/mcp`
- 상태 확인 엔드포인트: `http://localhost:8000/health`

Milestone 0은 OpenAI API를 호출하지 않습니다. `.env.local`은 Git에서 제외되며, 이후 마일스톤의 서버 전용 인증 정보를 저장하는 용도로 예약되어 있습니다.

## 검증 명령어

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

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
- React 위젯을 포함한 MCP Apps UI 리소스
- lint, typecheck, build, 단위 테스트 스크립트

아직 구현되지 않음:

- 이력서 파싱
- 채용 공고 입력 및 적합도 평가
- OpenAI Responses API 호출
- SQLite 영속화
- 지원 현황 관리
- 채용 공고 검색

전체 마일스톤은 [프로젝트 명세](docs/PROJECT_SPEC.md)를 참고하세요.

## 참고 문서

- [Plugin 빠른 시작](https://developers.openai.com/plugins/build/app-quickstart)
- [도구 정의](https://developers.openai.com/plugins/plan/tools)
- [MCP 서버 구축](https://developers.openai.com/plugins/build/mcp-server)
- [MCP 서버에 UI 추가](https://developers.openai.com/plugins/build/chatgpt-ui)
- [ChatGPT 연결 및 테스트](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Plugin 레퍼런스](https://developers.openai.com/plugins/reference)
