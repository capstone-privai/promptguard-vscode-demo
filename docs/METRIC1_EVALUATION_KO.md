# PromptGuard VS Code Demo V0 — metric-1 평가 결과

## 결론

팀의 `promptguard-data` 합성 데이터셋과 기존 metric-1 scorer를 현재 VS Code 데모의 실제
`python/detector_adapter.py`에 연결해 평가할 수 있다. 2026-10-05 최초 실행 결과는 **Recall 0.6250,
Precision 0.6944, F2 0.6378**이다. 평가 파이프라인 연결은 성공했지만, 이 수치는 detector coverage를
개선해야 한다는 뜻이며 완성된 보안 성능을 입증하지 않는다.

## 재현 환경

- Demo: `promptguard-vscode-demo` commit `89e95fa3919`
- Dataset: `promptguard-data/metric-1/sessions.jsonl`, SHA-256 prefix `f63b941d3f52`
- Scorer: `promptguard-demo-v0` branch `feat/evaluation-metric1`, commit `adf73fd6782d`
- Detector: CredSweeper 1.18.5, ML off, filters on
- OS: Windows / PowerShell
- 데이터: 12 sessions, 51 items, 32 gold spans, 151 lines
- 처리 채널: `prompt`, `stdout`, `stderr`, `file_read`; `agents_md`는 미처리

```powershell
.\.venv\Scripts\python.exe .\scripts\evaluate_metric1.py
```

평가 결과 디렉터리는 `evaluation-runs/`에 생성되며 Git에서 제외한다. 실행 시 raw input이나 탐지값을
별도 debug 파일로 저장하지 않는다.

## 결과

| 지표 | 결과 |
|---|---:|
| Strict full-span recall | 0.6250 (20/32) |
| Precision | 0.6944 (25/36 edits) |
| F2 | 0.6378 |
| Character recall | 0.6763 |
| Partial | 3/32 |
| Missed | 9/32 |
| Over-masking | 11 edits, 72.85/1,000 lines |
| Detector path latency | p50 154.25 ms / p95 192.39 ms / max 197.00 ms (n=50) |

타입별 strict recall:

| Type | Gold | Recall |
|---|---:|---:|
| PASSWORD | 14 | 0.6429 |
| TOKEN | 7 | 0.5714 |
| ACCESS_KEY | 3 | 1.0000 |
| PRIVATE_KEY | 1 | 0.0000 |
| SECRET | 7 | 0.5714 |

채널별 strict recall:

| Channel | Gold | Recall |
|---|---:|---:|
| prompt | 2 | 0.0000 |
| agents_md | 1 | 0.0000 |
| stdout | 22 | 0.6364 |
| stderr | 7 | 0.8571 |

## 기존 팀 baseline과의 차이

데이터 저장소에 기록된 CredSweeper ML-off baseline은 Recall 0.6563, Precision 0.6765다. 현재 데모는
동일한 9개 span을 놓쳤지만, PRIVATE_KEY 한 건이 `full`에서 `partial`로 바뀌어 strict recall이 1/32
낮아졌다. 현재 adapter는 PEM의 민감한 문자열을 가렸지만 여러 줄 gold span 내부의 줄바꿈 2문자를
그대로 남긴다. 엄격한 “span 전체 치환” 정책에서는 부분 보호로 계산되는 것이 맞다.

현재 데모는 prompt도 실제 detector에 통과시켰지만 prompt의 두 자연어 credential 표현은
CredSweeper 규칙에서 탐지되지 않았다. `agents_md`는 이 독립 extension의 context 경로에 포함되지 않아
통과 처리되었다.

baseline의 약 0.16 ms와 현재 약 154 ms는 직접 비교하면 안 된다. baseline은 이미 생성된 scanner를
프로세스 안에서 재사용하는 탐지 시간이고, 현재 값은 실제 데모처럼 매 항목 Python detector process를
시작하는 비용을 포함한다. 현재 사용자 체감 경로를 반영한 수치는 후자다.

## 라벨 정책 해석

데이터셋은 connection string **전체 URL**을 하나의 `SECRET` gold span으로 정의한다. 반면 VS Code
데모의 설계 목표는 host/port/database 구조를 보존하고 password value만 placeholder로 바꾸는 것이다.
따라서 URL 비밀번호가 안전하게 치환돼도 scorer는 해당 gold를 `partial`로 판정한다. 이 차이를 점수를
높이기 위해 임의로 바꾸면 안 된다. 팀은 다음 버전에서 아래 중 하나를 명시적으로 선택해야 한다.

1. URL 전체 비공개가 정책이면 현재 value-only redaction을 실패로 유지한다.
2. credential value 보호와 coding utility 보존이 정책이면 URL password subspan gold를 별도로 둔다.
3. 두 정책을 모두 보고하려면 `container span`과 `secret-value span`을 분리해 두 지표를 함께 낸다.

PromptGuard의 현재 취지에는 3번이 가장 적합하다. 보안 경계와 task utility를 동시에 비교할 수 있기
때문이다.

## 판단과 다음 우선순위

평가 연결은 정상이며 앞으로 regression test로 사용할 수 있다. 다만 데이터가 151줄, 32 span의
고밀도 합성 파일럿이고 `human_review=pending`이므로 실제 환경의 precision/recall로 일반화하면 안 된다.

다음 detector 개선 우선순위는 다음과 같다.

1. 자연어 prompt의 password/token 표현 탐지 보완
2. multiline PEM을 하나의 span으로 안전하게 처리
3. 현재 놓친 Docker/process/Kubernetes/HTTP token 형태 분석
4. 11개 false-positive의 rule별 원인을 값 원문 없이 분류
5. URL container/value 이중 라벨 확정 후 utility 평가와 연결

이번 결과는 “CredSweeper를 V0 detector baseline으로 실행할 수 있다”는 점은 확인하지만,
“CredSweeper 단독으로 충분하다”는 결론은 지지하지 않는다.
