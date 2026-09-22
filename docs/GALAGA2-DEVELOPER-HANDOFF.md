# 3D GALAGA 2 — 개발자 핸드오프 스펙

> 대상: `C:\AI-SILEE-DEV\3d-galaga-2` (Vite + three.js WebGPU, npm)
> 목표: "기존 3D 갤러그(NEBULA STRIKE)의 발전형 + Nova Storm 스타일 3D 아케이드 슈팅"
> 원칙: **재사용 가능한 코드는 최대한 유지하면서 단계적으로 확장. 그래픽보다 먼저 플레이 가능한 Core Gameplay.**

---

## 1. 참고작 컨셉 (Nova Storm, 1994)

직접 복제는 금지. 아래 "감각"만 가져온다:

- 플레이어기가 화면 전체(가로+세로)를 자유롭게 비행
- 적이 3D 공간의 깊은 곳/사방에서 스케일인(접근)하며 등장
- 적이 플레이어를 스치며 돌진(approach)하는 연출
- 3D 공간에서 적의 사격이 실제 플레이어 위치를 노림
- 빠른 템포의 아케이드 전투

갤러그 정체성 유지 요소: 편대 형성 → 돌진(dive) → 복귀, 포획/보너스 느낌(엘리트 빔),
보너스/고득점(콤보/다플), 5웨이브마다 보스, 파워업 드랍.

---

## 2. 현재 코드 분석 결과

### 2.1 현재 구현된 기능 (as-is)
- X축만 이동하는 fixed-plane 슈터 (Player는 x만 accel/drag, y/z 고정 레일)
- 마우스 사용 없음 — 발사는 직진(-Z) 레이저만
- 적 4종(fighter/interceptor/heavy/elite) + 상태머신 ENTERING→FORMATION→DIVING→REJOINING
- 진입/돌진/복귀는 CatmullRomCurve3 곡선 샘플링 (getPointAt, 접선 오리엔테이션) — **이미 3D 곡선 기반**
- EnemyAttackSystem: 주기적 돌진 스케줄러 (웨이브별 간격/동시 돌진 캡)
- 엘리트 포획 빔(현대 재해석: 콘 안에 서면 스킬드 깎임)
- 보스(5웨이브마다) — 3페이즈, 전진 마인 파이어, SHIELD DOWN 연출
- 풀링: Pool(적/탄환/파워업/파티클), ProjectileSystem(공유 탄환 풀)
- CollisionSystem — 단, **적/보스 판정은 x/z 평면만** (y 무시, y 고정 시절 가정)
- 콤보(킬 체인 ×배율), 스코어/하이스코어(localStorage), lives/shield, 대시(무적)
- HUD: 스코어/웨이브/콤보/시ールド/무기/라이프/보스바 + 메뉴/ポーズ/게임오버/웨이브클리어 오버레이
- StarField(패럴랙스+트레일), Nebula, 파티클 폭발, 카메라 셰이크, WebAudio 합성음
- 모바일 터치 스틱(좌)/발사버튼(우), WebGPU 하드게이트 + 폴백

### 2.2 재사용 (변경 최소화)
| 파일 | 처리 |
|---|---|
| core/Renderer.js | 그대로 (cameraBase()만 Y-follow에 맞게 확장 가능) |
| core/Pool.js, GameState.js | 그대로 |
| systems/StarFieldSystem.js, NebulaSystem.js, ParticleSystem.js | 그대로 (필요 시 스타 속도만 ↑) |
| systems/AudioSystem.js | 그대로 (큐 추가는 선택) |
| entities/ShipBuilder.js, Projectile.js, PowerUp.js | 그대로 (파워업 드랍 로직 유지) |
| effects/ExplosionEffect.js | 그대로 |
| ui/FloatingText.js | 그대로 (콤보/배너 문구 재활용) |
| systems/ProjectileSystem.js | **소폭 수정**: spawnPlayerShot에 3D dir 옵션 추가 |
| systems/EnemyAttackSystem.js | **수정**: 돌진 스폿을 3D화(후방/측면 접근 포함) |
| systems/CollisionSystem.js | **수정**: x/z 평면 판정 → 완전 3D 스피어 판정 |
| systems/WaveSystem.js | **확대**: 3D 공간 진입 패턴 링/로어/아크 추가 |
| entities/Player.js | **확대**: Y축 이동 + 피치/롤 + 조준 상태 |
| entities/Enemy.js | **확대**: 3D 진입 곡선 + approach(플레이어 근접 스와이프) 패턴 |
| entities/Boss.js | **확대**: 3D 순회 + 3D 어임 패턴 1~2종 추가 |
| core/InputManager.js | **확대**: W/S(상하) 축, 마우스 위치(NDC) 추적, 좌클릭 발사 |
| core/Game.js | **중심 수정**: 카메라 Y-follow, 레티클 대상 선택, 발사 방향 계산 |
| ui/HUD.js + index.html + style.css | **리모델링**: 제목/메뉴 조작법, 레티클 요소, 콤보 미터 |

### 2.3 새로 필요한 시스템
1. **AimReticle** (`src/ui/Reticle.js` or Game 내장)
   - 마우스 NDC → 카메라 레이 → **가장 가까운 적의 z 깊이 평면**(반경 밖이면 기본 z)과 교차점 계산
   - DOM 크로스헤어(커서 hidden) + 3D 링 메시(선택)
   - 적 근접 시 "lock" 연출(색/크기)
2. **3D 진입 패턴 생성기** (WaveSystem 내)
   - `ring`: 플레이어 중심 원주(반경 55~85, z -60~-90)에서 편대가 휘감으며 슬롯으로 진입
   - `lane`: 좌/우 깊은 곳에서 측면 란 접근
   - `arc`: 상단 아크 (기존 진입 유지 — 회귀 방지용)
   - 편대 내부 슬롯도 y 0~4, z -30~-48 범위로 분산 (현재는 y=0 단일면)
3. **Approach 돌진** (Enemy.js)
   - 일부 적(웨이브 2+)은 편대 진입 전 플레이어 옆을 3~6유닛 거리로 스쳐 지나가며 접근하는 커브 (Nova Storm feel)
   - 기존 DIVE와 별개로 'APPROACH' 상태 또는 진입 커브 변형으로 구현 (복귀 후 FORMATION)

---

## 3. 게임플레이 루프 (목표)

```
메뉴 → 웨이브 시작: 적이 3D 깊은 곳에서 편대 진입(링/로어/아크)
     → 전투: W/A/S/D 자유이동 + 마우스 조준 사격 + 대시
     → 적이 주기적으로 3D 곡선 돌진(측면/후방 포함) + 3D 어임 사격
     → 웨이브 클리어(3.2s 휴전) → 다음 웨이브(적 강화)
     → 5의 배수 웨이브: BOSS (3D 순회 + 3페이즈)
     → 사망 시 게임오버 → RETRY / 메인 메뉴 (하이스코어 유지)
```

---

## 4. 단계별 구현 계획 (이 순서대로, 각 단계 후 `npm run build` 통과 필수)

### Phase 1 — 플레이어 X+Y 자유이동
- `config.js`: `BOUNDS.PLAYER_MIN_Y ≈ -0.5`, `PLAYER_MAX_Y ≈ 4.5`, `PLAYER.ACCEL_Y`, `MAX_SPEED_Y`, `DRAG_Y`(x와 같은 모델 권장), 피치/롤 틸트 상수
- `InputManager`: `MOVE_UP={KeyW,ArrowUp}`, `MOVE_DOWN={KeyS,ArrowDown}`, `get axisY()` (터치 스틱 dy로 유사), 마우스 `mousemove`로 NDC 저장(`aimX/aimY`), `mousedown`(좌버튼)→발사
- `Player.js`: y 속도 accel/drag + 바운딩 + 피치(y속도)·롤(x속도, 기존 bank 유지) 틸트
- `CameraEffects`: 카메라 pos.y·look.y를 플레이어 y로 **damped follow** (베이스: pos.y=13.5, look.y=-4 유지하고 offset叠加). 모바일 look-lift 로직은 깨지지 않게
- **검증**: 상하 이동 시 카메라가 부드럽게 따라오고 적 편대가 프레임 안을 벗어남

### Phase 2 — 마우스 조준 + 자유 조준 사격
- 레티클: Game이 매 프레임 계산 — 대상 = **레이-가장 가까운 적**(평면과 교차 후 거리가 짧은 적, 없음 시 z=-34 기본 평면)
- `ProjectileSystem.spawnPlayerShot({origin, dir?, stats})`: dir(3D unit) 미지정 시 기존 -Z 직진
- `Game._firePlayerLaser`: 발사 방향 = (레티클 월드점 - 플레이어 위치).normalize(), 바レル xOff는 기존 유지
- 마우스를 안 움직인 적이 있는 플레이어는 직진 발사(커서 초기값 화면중앙)
- 좌클릭 + Space/KeyJ 모두 발사(공유 쿨다운 유지)
- PLAYING 상태에서만 `cursor: none`, 레티클 DOM 표시

### Phase 3 — 적 3D 공간 진입 (Nova Storm feel)
- `WaveSystem._buildSpawnPlan`: 웨이브별 진입 패턴 조합 (ring/arc/lane 혼합, 웨이브 올라갈수록 ring 비중↑)
- 진입 스폿: 플레이어(0,1.1,17) 중심 원주 반경 55~85, 높낮이 y 2~20 랜덤, 곡선 중간에 y 상승(기존 스타일)
- `Enemy.configure({slot, spawnFrom,...})` 계약 유지 — spawnFrom이 곧 3D 진입 스폿
- **Approach**: 웨이브 2+에서 랜덤 일부(20~30%) 적은 FORMATION 도달 후 첫 돌진 대신 플레이어 근접 스와이프 커브 (최소 접근거리 3~6) — 무적/공정성 확인
- 진입/돌진/복귀 곡선은 모두 y 성분을 가진 3D로 (기존 곡선은 이미 3D — y 지점만 살려주기)

### Phase 4 — 완전 3D 충돌
- `CollisionSystem`: 플레이어탄↔적/보스 판정을 x/z → **x/y/z 완전 3D** (보스 포함)
- 적탄↔플레이어는 이미 3D — 유지. 람(돌진 충돌) 3D 유지
- 적 사격: `Enemy._fire`는 이미 3D 어임 — 유지. 단, 플레이어 y가 움직이므로 어임이 실제로 의미를 가짐(회귀 확인)
- 파워업↔플레이어는 x/z 유지 (파워업은 y=0.4 낙하)
- **공정성**: 플레이어 바운딩 y -0.5~4.5에서 적 편대(y 0~4)와 탄환이 합리적으로 명중/회피

### Phase 5 — 보스 3D화
- `Boss.js`: 순회 궤도 y ±2.5, z -46~-54 변동, 접근 lung(1~2초 전진 후 복귀) 패턴을 페이즈2/3에 1회성 삽입
- 페이즈3에 3D 링 사격(플레이어 중심으로 수직/경사 링 마인 8~12발) 추가
- BOSS.RADIUS는 3D 판정에서 그대로 사용

### Phase 6 — HUD/브랜딩
- `index.html` + `style.css`: 타이틀 **"GALAGA 2"**, 서브타이틀 "3D NOVA ARCADE", 메뉴 조작법(WASD 이동 / 마우스 조준 / SPACE·좌클릭 발사 / SHIFT 대시)
- `config.js` GAME.TITLE/SUBTITLE 동기화
- 레티클 DOM 요소 + CSS(네온 크로스헤어, lock 시 강조)
- 콤보: HUD에 **콤보 미터**(xN + 진행 바) — 9킬마다 승격(기존 STEP=9)
- 웨이브 클리어/보스 인트로 문구는 3D 진입 연출에 맞게

### Phase 7 — 빌드 + 셀프체크 (리뷰어 테스트 전)
- `npm run build` 성공
- 콘솔 에러 0개, 메모리 리크(풀 반환) 확인
- 웨이브 1→5(보스)까지 로직상 진행 가능

---

## 5. 제약 / 주의사항
- **커밋 금지** — 작업 트리에만 변경 (사용자가 직접 커밋)
- `.env`, node_modules, dist/ 직접 수정 금지
- 기존 코드 스타일 준수: 모듈 상단 문서주석, 스래치 벡터 재사용(퍼프레임 할당 금지), 풀 기반
- `three/webgpu` import 유지 (bare 'three' 금지)
- WebGPU 게이트·터치 컨트롤·하이스코어 폴백 깨지지 않게
- 웨이브 클리어/보스 인트로/게임오버 전환 레이스(동일 프레임 내 상태 중복 전환) — 기존 주석의 경계 유지
- `window.__ns` 디버그 핸들 유지

## 6. 인수 기준 (리뷰어가 검증할 항목)
1. `npm run build` 통과
2. 브라우저에서 로딩 → WebGPU: OK → START GAME 동작
3. W/A/S/D 4방향 이동 + 은행/피치 연출, 카메라 Y-follow 자연스러움
4. 마우스 레티클 표시, 발사가 레티클 방향(3D)으로 비행, 적 명중 시 점수/콤보/폭발/파워업 정상
5. 적이 화면 깊이(3D)에서 편대 진입, 주기적 3D 돌진, 3D 어임 사격이 플레이어를 실제로 노림
6. 웨이브 5 보스 등장/3페이즈/파괴, 클리어 후 웨이브 6 진행
7. 대시 무적, 라이프/시ールド, 게임오버→RETRY 정상
8. 콘솔 에러 0, 60fps 근접 프레임 (60s 플레이)
9. 웨이브 클리어/보스 전환 시 오버레이 겹침이나 상태 꼬임 없음

## 7. 실행 환경
- dev 서버: `http://localhost:5173/3d-galaga/` (기존 구동 중 — 죽어 있으면 `npm run dev` 재시작, base path `/3d-galaga/` 주의)
- 빌드: `npm run build`
- 브라우저 테스트: WebGPU 필요 (Chrome/Edge)
