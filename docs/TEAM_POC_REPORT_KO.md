# PromptGuard VS Code Demo V0 — 개발 PoC 공유 보고서

작성 기준: 2026-10-05  
Repository: <https://github.com/capstone-privai/promptguard-vscode-demo>  
Branch: `main`

## 1. 요약

이번 PoC는 다음 질문을 검증하기 위해 구현했다.

> VS Code 안에서 사용자가 cloud LLM 기반 coding agent를 사용할 때, 사용자 prompt와 PromptGuard가 실행한 local tool output의 hard secret을 cloud 전송 전에 로컬에서 탐지하고 placeholder로 치환할 수 있는가?

현재 결론은 다음과 같다.

| 항목 | 판정 | 근거 |
|---|---|---|
| 사용자 prompt 사전 masking | VERIFIED | 전송 직전 request 객체에 synthetic 원문이 없음을 자동 테스트로 확인 |
| 로컬 파일/tool output masking | VERIFIED | 실제 `read_file` 시연에서 3개 span을 cloud 전송 전에 masking |
| 동일 값의 placeholder 일관성 | VERIFIED | 반복된 DB password가 같은 `[PASSWORD_1]`로 치환됨 |
| connection string 구조 보존 | VERIFIED | host, port, database는 유지하고 password value만 치환 |
| 실제 OpenAI API/tool loop | VERIFIED | 실제 API 호출, tool call, sanitized tool result 후속 전송까지 실행 |
| task utility | PARTIAL | 구조는 보존됐지만 현재 모델이 보존된 host/port/db를 답변에 활용하지 않은 사례가 있음 |
| 일반 사용자 배포 | NOT IMPLEMENTED | 현재는 F5 개발 실행이며 Python/CredSweeper 환경이 필요 |

즉 **privacy data path는 성립했지만, placeholder를 받은 모델이 남은 안전한 context를 적극적으로 사용하도록 agent instruction을 보완해야 한다.**

## 2. 기존 Hook PoC와의 관계

이 저장소는 기존 Codex Hook PoC와 완전히 분리된 새 프로젝트다.

- Codex CLI를 사용하지 않는다.
- Codex Hook을 사용하지 않는다.
- OpenAI-compatible local proxy를 사용하지 않는다.
- 기존 Hook 저장소의 구현 코드를 복사하지 않았다.

PromptGuard가 직접 VS Code Side Panel, local tools, privacy boundary, OpenAI API 호출을 소유한다.

## 3. 현재 아키텍처

```text
VS Code Extension Development Host
        ↓
PromptGuard Side Panel
        ↓
Local Privacy Gateway
  ├─ CredSweeper ML-off scan
  ├─ value-only span normalization
  └─ session placeholder redaction
        ↓
OpenAI Responses API (store=false)
        ↓
function tool call
        ↓
PromptGuard Workspace Tool Executor
  ├─ read_file
  ├─ list_files
  ├─ search_workspace
  └─ write_file (사용자 승인 필요)
        ↓
raw local result (메모리에만 존재)
        ↓
Local Privacy Gateway
        ↓
sanitized function_call_output만 OpenAI에 전송
```

역할 구분은 다음과 같다.

### Cloud LLM

- 사용자 task 해석
- tool 선택
- coding reasoning
- 최종 답변 및 수정 내용 생성

### PromptGuard

- user prompt 통제
- workspace 접근
- local tool 실행
- CredSweeper 탐지
- placeholder masking
- sanitized context만 전송

## 4. 주요 구성 요소

| 경로 | 역할 |
|---|---|
| `src/extension.ts` | Side Panel, SecretStorage, privacy/tool event UI |
| `src/agent/agentLoop.ts` | Responses API function-calling loop, 최대 8 tool round |
| `src/openai/responsesClient.ts` | OpenAI transport, `store=false`, 안전한 오류 처리 |
| `src/privacy/detectorClient.ts` | Python adapter subprocess 호출, stdin 전달, fail-closed |
| `src/privacy/gateway.ts` | prompt/tool output 공통 privacy boundary |
| `src/privacy/redactor.ts` | span 치환 및 session placeholder 관리 |
| `python/detector_adapter.py` | CredSweeper 1.18.5 ML-off 결과 정규화 |
| `src/tools/workspaceTools.ts` | workspace-local 최소 tool executor |
| `examples/synthetic-workspace` | 실제 secret이 없는 시연 fixture |
| `src/test/privacy.test.ts` | cloud-bound request in-memory assertion |
| `python/test_detector_adapter.py` | 실제 CredSweeper integration test |

## 5. Secret detector와 redaction

### CredSweeper 연결

- 버전: `credsweeper==1.18.5`
- `ml_threshold=0`: ML validation 비활성화
- `use_filters=True`: 공식 rule/filter 경로 사용
- Extension에서 별도 대형 backend 없이 Python adapter를 subprocess로 실행
- raw text는 command-line argument가 아니라 stdin으로 전달
- adapter stdout에는 raw detected value를 반환하지 않음

정규화 결과 예시:

```json
{
  "type": "PASSWORD",
  "start": 19,
  "end": 28,
  "rule": "URL Credentials",
  "fingerprint": "sha256..."
}
```

### Placeholder 정책

- secret 원문을 다른 가짜 credential로 바꾸지 않는다.
- `[PASSWORD_1]`, `[TOKEN_1]`, `[API_KEY_1]` 형태의 명시적 placeholder로 바꾼다.
- 같은 값은 하나의 user task/session에서 같은 placeholder를 사용한다.
- vault 또는 원문 복원은 구현하지 않았다.

### CredSweeper 중복 제거 보완

CredSweeper는 같은 credential 값이 한 입력에 반복될 때 candidate를 중복 제거할 수 있었다. 그대로 사용하면 첫 번째 위치만 masking되고 반복 위치가 남을 수 있다.

현재 adapter는 CredSweeper가 한 값을 positive detection한 뒤 동일 입력에 존재하는 **그 값의 모든 exact occurrence**를 같은 fingerprint로 확장한다. 이는 새로운 탐지 rule을 추가하는 것이 아니라 이미 탐지된 값의 반복 노출을 막는 후처리다.

## 6. 실제 span 관찰 결과

| 입력 형태 | 관찰된 rule | masking 범위 |
|---|---|---|
| `DB_PASSWORD=...` | Password | value only |
| high-entropy API key assignment | API / Key | value only |
| `Authorization: Bearer ...` | Bearer Authorization / Auth | token value only |
| PostgreSQL URL basic credential | URL Credentials | password value only |
| HTTPS basic auth | URL Credentials | password value only |
| AWS secret-key assignment | Key / Secret | value only |
| JSON/docker-style password | Password | value only |
| 일반 IP/host/port/database | 탐지 안 함 | 유지 |

확인된 한계:

- 짧거나 명백한 example 문자열은 CredSweeper filter에 의해 탐지되지 않을 수 있다.
- MySQL URL 테스트에서 실제 password 외에 `port/path`가 generic `Secret`으로 추가 탐지되는 false positive가 관찰됐다.
- V0에서는 임의의 URL parser나 custom detection rule을 추가하지 않았다.

## 7. 실제 시연 결과

사용한 synthetic fixture의 논리적 구조:

```text
DB_URL=postgresql://demo_user:<SYNTHETIC_PASSWORD>@db.internal:5432/demo
DB_PASSWORD=<SAME_SYNTHETIC_PASSWORD>
SERVICE_TOKEN=<SYNTHETIC_TOKEN>
LOG_LEVEL=debug
```

Side Panel에서 관찰된 이벤트:

```text
User prompt: 0 secret span(s) masked
read_file: config.txt — started
read_file: config.txt — completed
Tool output: 3 secret span(s) masked (PASSWORD, TOKEN)
```

실제로 cloud-bound tool result가 된 sanitized representation:

```text
DB_URL=postgresql://demo_user:[PASSWORD_1]@db.internal:5432/demo
DB_PASSWORD=[PASSWORD_1]
SERVICE_TOKEN=[TOKEN_1]
LOG_LEVEL=debug
```

해석:

- password 원문 2곳과 token 원문 1곳이 제거됐다.
- 반복 password는 같은 `[PASSWORD_1]`로 연결됐다.
- `db.internal`, `5432`, `demo`, `debug`는 유지됐다.
- LLM은 password/token의 **존재와 타입**은 알 수 있지만 실제 값은 알 수 없다.
- secret의 존재를 숨기는 것이 아니라 secret value를 숨기는 것이 현재 threat model이다.

## 8. Utility 관찰과 현재 문제

다음 task를 실제로 요청했다.

```text
Read config.txt and identify the database host, port, database name,
log level, and whether credential values were protected. Do not modify the file.
```

모델은 파일에 credential과 service token이 있으며 placeholder라고 인식했지만, 보존된 host/port/database/log level을 답하지 않고 일반 보안 경고를 반환했다.

따라서 현재 판정은 다음과 같다.

- 개인정보/credential value 보호: 성공
- local tool loop: 성공
- 구조 보존: 성공
- 모델의 구조 활용: 실패 사례 존재
- 전체 task utility: 조건부

다음 agent instruction 보완이 최우선이다.

```text
Secret placeholders such as [PASSWORD_1] and [TOKEN_1] mean that
PromptGuard has already removed the raw credential.

Do not refuse or stop merely because placeholders are present.
Continue the requested coding task using all remaining non-secret structure.
Never claim to know or reconstruct the original secret value.
```

수정 후 동일 task를 여러 번 반복하여 host/port/db/log-level 추출 성공률을 측정해야 한다.

## 9. 보안·저장 특성

### 구현된 보호

- API key는 VS Code `SecretStorage`에 저장
- key 전체 값을 UI에 다시 표시하지 않음
- prompt/tool result는 OpenAI 호출 전에 반드시 privacy gateway 통과
- detector 실패, timeout, malformed output이면 request 차단
- raw 전송 fallback 없음
- OpenAI 요청에 `store=false` 강제
- OpenAI 오류 본문은 로그에 출력하지 않고 status/request ID만 노출
- workspace 밖 경로 접근 차단
- file write 전에 modal 사용자 승인
- 파일 크기, 검색 결과, tool round 제한

### 메모리 경계

로컬 탐지를 위해 raw prompt와 raw tool result는 extension/Python process memory에 일시적으로 존재한다. 디스크 로그에는 저장하지 않는다.

### 이 PoC가 보호하지 않는 것

- VS Code 전체 네트워크 트래픽
- 다른 extension의 전송
- OS-level DLP
- 모든 secret type
- zero false positive / zero false negative
- credential validity
- model-generated output
- 사용자가 PromptGuard 외부 채널로 직접 전송한 내용

## 10. 지원 도구

| Tool | 상태 | 비고 |
|---|---|---|
| `read_file` | IMPLEMENTED | UTF-8, 최대 1 MB |
| `list_files` | IMPLEMENTED | 최대 200개, 일부 디렉터리 제외 |
| `search_workspace` | IMPLEMENTED | literal search, 결과 제한 |
| `write_file` | IMPLEMENTED | modal 승인 필요 |
| `run_command` | NOT IMPLEMENTED | V0 범위에서 제외 |

## 11. 자동 테스트

### TypeScript

```powershell
npm.cmd test
```

현재 결과: 4 passed, 0 failed

검증 항목:

1. 같은 secret → 같은 session placeholder
2. user prompt 원문이 cloud-bound request에 없음
3. tool output 원문이 cloud-bound request에 없음
4. placeholder가 request에 존재
5. `store=false` 강제
6. connection string 구조 보존
7. detector 시작 실패 시 fail-closed

### Python/CredSweeper

```powershell
.\.venv\Scripts\python.exe .\python\test_detector_adapter.py
```

현재 결과: 1 integration test passed

실제 CredSweeper rule/filter 실행과 offset, multiple/repeated secret, no-secret case를 확인한다.

## 12. 개발 환경 실행 방법

### 최초 1회

```powershell
git clone https://github.com/capstone-privai/promptguard-vscode-demo.git
cd promptguard-vscode-demo
npm.cmd install
.\scripts\setup_detector.ps1
npm.cmd run compile
```

### 시연

1. 저장소를 VS Code에서 연다.
2. `F5`로 Extension Development Host를 연다.
3. 새 창에서 `examples/synthetic-workspace` 폴더를 연다.
4. PromptGuard 방패 아이콘을 연다.
5. `Set API key`로 OpenAI Project API key를 등록한다.
6. synthetic fixture만 사용하여 task를 전송한다.

Windows PowerShell은 `npm.ps1`을 차단할 수 있으므로 명령과 VS Code task에서 `npm.cmd`를 사용한다. 시스템 Execution Policy를 변경할 필요는 없다.

## 13. 개발 창과 사용자 창

현재 `F5`로 열리는 창은 **Extension Development Host**, 즉 개발 테스트용이다.

일반 사용자 배포에서는 개발자가 TypeScript를 미리 컴파일하므로 사용자가 Node.js/npm을 설치할 필요는 없다. 그러나 현재 detector는 Python/CredSweeper에 의존한다.

현재 배포 준비 상태:

| 항목 | 상태 |
|---|---|
| F5 개발 실행 | VERIFIED |
| `.vsix` 패키징 | NOT IMPLEMENTED |
| VS Code Marketplace 배포 | NOT IMPLEMENTED |
| Python/CredSweeper 자동 설치 | NOT IMPLEMENTED |
| standalone detector binary 번들 | NOT IMPLEMENTED |
| macOS/Linux bootstrap | NOT IMPLEMENTED |

다음 배포 단계에서는 Windows용 `promptguard-detector.exe` 번들 또는 안전한 first-run 설치 방식을 결정해야 한다.

## 14. 발생한 문제와 해결 기록

### VS Code build task에서 `npm.ps1` 차단

- 증상: PowerShell Execution Policy 오류
- 해결: Windows에서는 VS Code task가 `npm.cmd`를 실행하도록 수정
- 시스템 정책 변경 없음

### Side Panel이 `Checking API key…`에서 멈춤

- 원인: Webview HTML 안 JavaScript 문자열의 newline escape가 실제 줄바꿈으로 렌더링되어 script syntax error 발생
- 해결: `\\n`으로 escape하고 ready handshake 및 host-side error 전달 추가

### OpenAI `401`

- 원인 범주: invalid/revoked/wrong-permission API key
- 해결: 새 Project API key를 생성 직후 복사하여 SecretStorage에 교체
- billing 부족과는 구분됨; billing 부족은 일반적으로 429 계열

### GitHub Push Protection 차단

- 원인: OpenAI key 형태를 지나치게 정확히 흉내 낸 synthetic fixture
- 해결: bypass 승인하지 않고 generic high-entropy API fixture로 변경, Git history에서도 해당 패턴 제거

## 15. 알려진 한계

1. 모델이 placeholder를 보고 과도하게 보수적으로 답할 수 있다.
2. CredSweeper false negative/positive를 그대로 상속한다.
3. Python subprocess를 매 scan마다 실행하므로 latency 최적화가 필요하다.
4. 채팅 history persistence와 concurrent session 설계는 없다.
5. 첫 번째 workspace folder만 사용한다.
6. 실제 diff/rollback UI가 없다.
7. 입력 중 prompt는 로컬 composer에 보이지만, 제출 후 원문은 webview history에 남지 않고 고정된 content-hidden 안내로 대체된다.
8. 일반 사용자 설치 과정은 완성되지 않았다.
9. API 비용 통제는 OpenAI Project/Billing 설정에 의존한다.

## 16. 다음 작업 우선순위

### P0 — utility instruction 개선

- placeholder는 이미 보호된 값임을 system instruction에 명시
- placeholder 때문에 task를 거부하지 않도록 지시
- 남은 non-secret 구조를 적극 활용하도록 지시
- 동일 task 반복 benchmark

### P1 — evaluation

- prompt masking, file masking, no-secret, repeated secret, connection string case 반복
- task success, tool call 수, retry, latency, false masking 기록
- original / full-span masking / value-only masking 비교

### P2 — 배포 PoC

- `.vsix` 생성
- clean Windows VM에서 설치 검증
- Python prerequisite 방식과 bundled detector 방식 비교

### P3 — detector 경량화

- long-lived detector process 또는 binary bundle 검토
- ML-off 의존성 최소화
- startup latency와 package size 측정

## 17. 팀 논의가 필요한 결정

1. V0 발표 전에 utility instruction 개선을 필수로 볼 것인가?
2. detector 배포를 Python prerequisite로 둘지 binary로 묶을지?
3. CredSweeper false positive를 V0에서 그대로 보여줄지 최소 후처리를 추가할지?
4. Marketplace 이전에 `.vsix`만 팀 배포할지?
5. 실제 제품 threat model에서 secret의 존재/타입은 cloud에 공개해도 되는가?

현재 권장 답은 다음과 같다.

- 발표 전 P0 utility instruction은 보완한다.
- 캡스톤 V0는 value-only placeholder 방식을 유지한다.
- secret field name과 타입은 utility를 위해 유지한다.
- `.vsix` 팀 배포를 먼저 수행한다.
- Marketplace와 detector 완전 번들링은 후속 단계로 둔다.

## 18. 최종 판정

**개발용 PoC 기반 구조: 사용 가능**

근거:

- 실제 VS Code Side Panel에서 prompt를 받는다.
- 실제 OpenAI API function-call loop가 동작한다.
- local file을 읽는다.
- raw tool result를 로컬에서 CredSweeper로 검사한다.
- value-only placeholder로 바꾼다.
- cloud-bound request에 raw synthetic marker가 없음을 자동 테스트했다.
- 실제 시연에서 password/token 3개 span이 masking됐다.

단, **발표용 end-to-end 성공 시나리오로 고정하기 전에는 placeholder-aware agent instruction과 utility 재검증이 필요하다.**
