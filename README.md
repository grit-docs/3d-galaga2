# GALAGA 2 — 3D NOVA ARCADE

고전적 Galaga 스타일 슈터를 완전 3D 자유 비행으로 재해석한 웹 게임입니다. W/A/S/D로 화면 전체(가로+세로)를 비행하고, 마우스로 조준해 3D 공간에서 편대가 휘감아드는 Nova Storm 스타일의 전투를 벌입니다.
Three.js **WebGPU** 렌더링 + 블룸 포스트프로세싱 기반으로, 로우폴리 스타십 + 네온 발광 + 탄 트레일 + 파티클 폭발 + 성운 배경을 결합해 60fps에서 쾌적하게 즐길 수 있습니다.

> **본 프로젝트는 [Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research)와 대화하며 만든 "바이브코딩(Vibe Coding)"으로 전 과정이 개발되었습니다.** 아래 [개발 과정](#-개발-과정-바이브코딩) 섹션을 참고하세요.

---

## 🚀 주요 특징

- **WebGPU 렌더링** — Three.js `WebGPURenderer` 사용, 미지원 브라우저에는 폴백 메시지 표시
- **3D 자유 비행** — W/A/S/D로 가로+세로 자유 비행, 기체 뒤를 따르는 로우 체이스 카메라 프레이밍 (Star Fox 스타일)
- **5종 적 기체 + 4종 보스** — fighter / interceptor / heavy / elite / scout(자폭 유도탄), 5웨이브마다 진입하는 보스 루프: 드레드노트(5웨이브) → 엠퍼 캐리어(10웨이브~) → 글레이셜 링(15웨이브~) → 애시드 세퍼런트(20웨이브~)
- **실드 시각화** — 보호막은 얇은 원형 링으로 표시되며, 20% 이하에서는 시각적으로 사라지고, 완전히 벗겨진 stripped 상태가 실제로 존재해 죽음 전에 한 단계의 여유를 둔다
- **웨이브 클리어 3장 카드 선택** — Vampire Survivors 스타일, 웨이브마다 3장 중 1장 영구 적용 (10웨이브부터 T2 풀 병합)
- **BOMBA 미사일** — 클래식 전탄 소멸을 미사일로 재해석: `L`로 발사 → 편대 중앙에서 폭발, 적 탄 전체 소멸 + 전탄 피해 + 3초 슬로우모
- **자동 조준** — 기본 ON (데스크톱+모바일), 리드 예측 타겟 로크, `Q`로 토글
- **대시 + 슬로우모** — 10초 쿨다운의 단 하나의 결정적 회피, 대시 중 세계 0.4x 슬로우 (타임 익스텐더)
- **콤보 + 히트스톱** — 배율 최대 x10, 처치마다 세계가 멈추는 히트스톱이 콤보에 따라 증가
- **적 빔** — 편대가 텔레그래프 후 쏘는 수직 빔 (3웨이브~, 측면 이동으로 회피)
- **파워업 + 자석** — WEAPON / Rapid / SHIELD / BOMBA 드롭, 반경 6내 진입 시 기체로 자동 흡수
- **모바일 지원** — 터치 가상 조이스틱 + FIRE/BOMBA/AUTO 버튼, 세로 화면 카메라 프레이밍 자동 보정
- **프로시저럴 에셋** — 외부 에셋 0개 (기체 모델·효과음·어댑티브 BGM 모두 생성)
- **객체 풀링** — 탄/파티클/파워업은 사전 할당 풀에서 재사용 (GC 스파이크 방지)

## 🕹️ 조작법

| 키 | 기능 |
|---|---|
| `W` / `A` / `S` / `D` 또는 방향키 | 3D 자유 비행 (가로 + 세로) |
| 마우스 | 조준 (레티클, 적 로크-온) |
| `Space` / `J` / 좌클릭 | 발사 (보관 시 자동 화력) |
| `Q` | 자동 조준 ON/OFF (기본 ON) |
| `Shift` / `K` | 대시 (짧은 무적 + 세계 슬로우모, 쿨다운 10초) |
| `L` | BOMBA (미사일 발사 → 탄막 소멸 + 슬로우모) |
| `P` / `Esc` | 일시정지 / 재개 |

**모바일 (터치 기기):** 가상 조이스틱(좌) + FIRE / BOMBA / AUTO 버튼(우)이 자동 표시됩니다. 자동 조준 기본 ON이라 회피만 신경 쓰면 됩니다.

메인 메뉴의 설정(블룸 / 화면 흔들림 / 자동 조준 / 사운드 / 음악 볼륨)은 브라우저에 저장됩니다.

## ▶️ 실행 방법

**요구 사항:** Node.js 18+, WebGPU 지원 브라우저 (최신 **Chrome** 또는 **Edge**)

```powershell
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행 (HTTPS, self-signed)
npm run dev
```

Windows에서는 `start-dev.bat` 더블클릭으로도 시작할 수 있습니다.

```powershell
# 프로덕션 빌드
npm run build
npm run preview
```

### GitHub Pages 배포 (GitHub Actions)

`.github/workflows/deploy.yml`이 기본으로 포함되어 있어, **로컬 빌드 없이** `main`에 push만 하면 자동으로 빌드 → 배포됩니다.

1. GitHub 리포에서 **Settings → Pages → Source**를 **GitHub Actions**로 선택 (단 1회)
2. `git push` → Actions 탭에서 `Deploy to GitHub Pages` 워크플로우가 실행
3. 완료되면 `https://<계정>.github.io/3d-galaga2/` 에 공개

> 리포 이름이 다르면 `vite.config.js`의 `base` 값을 리포명과 동일하게 맞춰야 합니다.

## 🧠 개발 과정 — 바이브코딩

이 프로젝트는 수동 코딩 없이 **Hermes Agent (Nous Research)와 자연어로 대화하며 만드는 "바이브코딩"** 방식으로 개발되었습니다. 개발자는 아이디어·느낌·수정 지시를 자연어로 전달하고, AI 에이전트가 설계·구현·디버깅까지 수행하는 패턴입니다.

### 개발 환경

| 항목 | 사양 |
|---|---|
| **에이전트** | [Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research) |
| **GPU** | NVIDIA RTX 3090 × 2 (24GB VRAM each) |
| **LLM** | [Qwen3.8-27B Q8](https://huggingface.co) (8bit 양자화, 로컬 추론) |
| **추론 서버** | [LM Studio](https://lmstudio.ai) — 로컬 LLM 호스팅 (OpenAI 호환 API) |

### 아키텍처 개요

```
브라우저 (Chrome/Edge, WebGPU)
   │  Vite dev server (HTTPS)
   ▼
Hermes Agent (AI 에이전트)
   │  OpenAI 호환 API (localhost)
   ▼
LM Studio  ──  Qwen3.8-27B Q8
   │  24GB VRAM × 2 GPU 로컬 추론
   ▼
RTX 3090 × 2
```

- **로컬 추론**: API 비용 0원, 코드 저장소 외부 전파 없음, 오프라인 개발 가능
- **27B Q8 모델**: 두 RTX 3090의 VRAM에 안정적으로 로드되어 게임 로직·3D 그래픽 코드 수준에서도 일관된 품질
- **워크플로**: 기능 요구(자연어) → 에이전트가 파일 구조 설계·구현 → `npm run build` 검증 → 브라우저에서 플레이 테스트 → 느낌 기반 피드백(예: *"기체 색상이 어둡다, 네온 느낌으로 밝게"*) → 즉각 반영하는 루프를 반복

### 코드 구조

에이전트가 유지보수성을 위해 적용한 규칙:

- `src/config.js` — 매직 넘버 0개: 모든 밸런스·색상·카메라 파라미터를 한 파일에 집중 관리
- **엔티티 + 시스템 분리** — 엔티티(`entities/`)는 상태·모델, 시스템(`systems/`)은 로직
- **객체 풀링**(`core/Pool.js`) — 탄/파티클/파워업 사전 할당
- **스테이트 머신**(`core/GameState.js`) — BOOT → MAIN_MENU → PLAYING ↔ PAUSED / WAVE_CLEAR / BOSS_INTRO / GAME_OVER
- **공유 지오메트리** — 전 기체가 동일한 기본 기하체를 재사용 (메시 수가 많아도 렌더링 부담 최소화)

## 📁 프로젝트 구조

```
3d-galaga2/
├── index.html                # DOM 루트 (#game-root, #hud), HUD 마크업, 메뉴/정지/게임오버
├── style.css                 # HUD/오버레이 CSS, 워프/트레일 FX
├── vite.config.js            # base 경로, three→three/webgpu 단일 인스턴스 alias, HTTPS dev
├── start-dev.bat             # Windows 개발 서버 스타터
└── src/
    ├── main.js               # 진입점: WebGPU 지원 검사 → Game 부트스트랩
    ├── config.js             # 전체 튜닝값 단일 소스 (밸런스·색상·보스·카드)
    ├── core/
    │   ├── Game.js           # 게임 루프 + 엔티티/시스템 연결, 점수·콤보·웨이브·BOMBA
    │   ├── GameState.js      # 상태 머신
    │   ├── InputManager.js   # 키보드 + 마우스 + 터치 입력
    │   ├── Pool.js           # 객체 풀
    │   └── Renderer.js       # WebGPURenderer + 지원 검사
    ├── entities/
    │   ├── Player.js         # 플레이어 (자유 비행·대시·실드 재생·카드 레벨)
    │   ├── Enemy.js          # 5종 적 기체 (편대 비행·공습·scout 유도탄)
    │   ├── Boss.js           # 보스 1: 드레드노트 (3페이즈, 에스코트, 유도탄 salvo)
    │   ├── Boss2.js          # 보스 2: 엠퍼 캐리어 (8방향 팬, 드론 호출)
    │   ├── PowerUp.js        # 파워업 드롭 (자석 자동 흡수)
    │   ├── Projectile.js     # 탄 (공유 지오메트리 + 트레일)
    │   └── ShipBuilder.js    # 전 기체 3D 모델 빌더 (공유 지오메트리 프리미티브)
    ├── systems/
    │   ├── ProjectileSystem.js    # 탄 스폰/수명
    │   ├── CollisionSystem.js     # 충돌 판정
    │   ├── WaveSystem.js          # 웨이브 구성·스폰 스케줄 (스크립트 편대)
    │   ├── EnemyAttackSystem.js   # 적 발사·공습(diving)·빔 스케줄링
    │   ├── BeamSystem.js          # 적 빔 (충전 텔레그래프 → 발사)
    │   ├── ParticleSystem.js      # 폭발·잔해 파티클
    │   ├── StarFieldSystem.js     # 3D 별 배경 + 클리어 워프 서지
    │   ├── NebulaSystem.js        # 성운 배경
    │   └── AudioSystem.js         # WebAudio 프로시저럴 SFX
    ├── effects/
    │   ├── CameraEffects.js       # 카메라 흔들림·조명·대시 FOV 킥
    │   ├── ExplosionEffect.js     # 폭발 프리셋
    │   └── BombaMissile.js        # BOMBA 미사일 (비행 → 편대 폭발)
    ├── audio/
    │   └── MusicEngine.js         # 어댑티브 프로시저럴 BGM
    └── ui/
        ├── HUD.js                 # 채점판·보스바·실드/대시/BOMBA 게이지
        ├── FloatingText.js        # +점수 팝업
        └── UpgradeSelect.js       # 웨이브 클리어 3장 카드 선택 UI
```

## 🎮 게임 플레이

1. **웨이브 시작** — 적이 원근(Z축)에서 편대 형태로 진입하며 좌우를 오갑니다. 3웨이브마다 스크립트 편대 (V-분할 / 링 수렴) 등장.
2. **사격** — 1레벨당 정면 평행 레이저 N발 (최대 5레벨, 팬 확산 없음). 레벨은 파워업·업그레이드 카드로 상승.
3. **콤보** — 2.4초 안에 연속 처치할수록 배율 상승 (9킬마다 +1, 최대 x10). 피격 시 초기화.
4. **실드 라이프사이클** — 실드는 정상 상태 → 경고색 → 20% 이하 시 링 숨김 → 완전 stripped 상태 → 다음 타격에서 생명 감소의 순서로 동작합니다. 즉, 갑작스런 즉사 없이 보호막이 벗겨지는 감각이 남습니다.
5. **웨이브 클리어** — 3장 카드 중 1장 선택: 피해 / 발사속도 / 탄속 / 최대 실드 / 실드 재생 / 득점 배율 / 에너지 충전 / 생명. 10웨이브부터 T2 풀(플라스마 코어, 관통 레이저, BOMBA 확장 등)이 병합됩니다.
6. **파워업** — 적 처치 시 32% 확률로 드롭 (WEAPON 30% / Rapid 25% / SHIELD 30% / BOMBA 15%). Rapid는 영구 스택 (최대 3레벨, 발사속도 +0.4/s each).
7. **BOMBA** — `L`로 미사일 발사. 3초 비행 후 편대 중앙에서 폭발: 적 탄 전체 소멸 + 적 전체·보스에게 40 피해 + 3초 동안 세계 0.25x 슬로우모. 적 드롭으로 충전 (최대 3발, T2 카드로 상한 +1).
8. **보스전** — 5웨이브마다. **5웨이브:** 3페이즈 드레드노트 (에스코트 증원, P2 와이드 링, P3 유도탄 salvo + 더블탭, 카메라 줌인, 사이클당 HP +550). **10웨이브부터:** 엠퍼 캐리어 (좌우 스윕, 8방향 팬 연사, 드론 호출, 사이클당 HP +400). **15웨이브부터:** 글레이셜 링 (회전형 얼음 고리, 방사형 광석 폭탄, 유도 다트). **20웨이브부터:** 애시드 세퍼런트 (긴 꼬리/머리 히트박스, 산성 분사, 전방 돌진). 
9. **대시** — Shift로 짧은 무적 이동 + 세계 0.4x 슬로우모 (쿨다운 10초, HUD 게이지로 잔여 시간 확인).

## 🎨 밸런스 튜닝

모든 수치가 `src/config.js`에 모여 있어 밸런스 조정 시 다른 파일 수정이 필요 없습니다.

- `PLAYER` — 이동 가속·드래그, 대시(속도/시간/쿨다운), 실드(피해/재생)
- `WEAPON` — 화력(발사속도·발수·손상·탄속), RAPID 스택
- `ENEMY` / `ENEMY_PROJECTILE` / `HOMING` / `DIVE` — 적 체력·속도·유도탄·공습 스케줄
- `WAVE` — 웨이브 HP/속도 스케일링, 스크립트 편대 지오메트리, 클리어 워프
- `BOSS` / `BOSS2` / `BEAM` — 보스 HP·화력·에스코트, 적 빔
- `BOMBA` — 미사일 비행·폭발 위치·피해·슬로우모
- `UPGRADE` — 웨이브 클리어 카드 풀 (POOL + POOL_T2, 각 카드 cap)
- `COMBO` / `JUICE` — 콤보 창·배율, 히트스톱·슬로우모·콤보 티어
- `AIM` — 레티클 로크 반경·히스테리시스, 자동 조준 (리드·타겟 우선순위)
- `POWERUP` — 드롭 확률·유형·자석 매개변수
- `SHOT_TRAIL` / `BLOOM` — 탄 트레일 길이, 블룸 글로우
- `COLORS` / `CAMERA` / `AUDIO` — 팔레트, 카메라 프레이밍, 볼륨

## ✅ 브라우저 요구 사항

WebGPU는 최신 **Chrome** 또는 **Edge**에서만 사용할 수 있습니다. 미지원 브라우저에서는 자동으로 폴백 화면이 표시됩니다:

> *"이 게임은 WebGPU를 지원하는 최신 Chrome 또는 Edge 브라우저가 필요합니다."*

> 다른 PC에서 접속하는 경우 반드시 `https://` 주소로 접속하세요 (`http://`는 비보안 컨텍스트라 WebGPU가 비활성화됩니다). 개발 서버는 self-signed HTTPS로 제공됩니다 — 첫 접속 시 보안 경고를 진행하면 됩니다.
