# GALAGA 2 — 리뷰어 E2E 테스트 보고서

실행 시각: 2026-09-19 21:41:09
환경: Playwright headless Chromium (WebGPU flag), https://localhost:5173/3d-galaga/

## 결과 요약

**PASS 22/22**

| # | 항목 | 결과 | 상세 |
|---|------|------|------|
| 1 | 2a load+WebGPU badge | ✅ | WebGPU: OK |
| 2 | 2b game booted (MAIN_MENU) | ✅ | MAIN_MENU |
| 3 | 2c START GAME -> PLAYING | ✅ | state=PLAYING overlays={'menu': False, 'pause': False, 'gameOver': False, 'waveClear': False} |
| 4 | 3a W moves up (y) | ✅ | y 1.31->5.38 (band ok=True) |
| 5 | 3b S moves down (y) | ✅ | y 5.38->1.43 |
| 6 | 3c D/A move right/left (x) | ✅ | x 0.00 -> 4.19 -> 0.73 |
| 7 | 3d camera Y-follow | ✅ | camY 6.84->8.33 |
| 8 | 4a reticle element visible in PLAYING | ✅ | display=block enemies=8 |
| 9 | 4b reticle lock on targeted enemy | ✅ | locked False->True (aim @ 804,438) |
| 10 | 4c shot kills aimed enemy (collision+score) | ✅ | kills 0->1 score 0->100 |
| 11 | 5a enemies enter from 3D depth (min z < -40 or wide x) | ✅ | n=8 z[-74.5,-13.5] maxX=15.1 |
| 12 | 5b 3D dives/approaches occur | ✅ | diving/approaching=1 |
| 13 | 6a boss intro -> PLAYING, boss alive | ✅ | intro=BOSS_INTRO play=PLAYING boss=True |
| 14 | 6b boss 3 phases reachable | ✅ | phases=[1, 2, 3] ratio=0.25 |
| 15 | 6c boss fires (hostile projectiles present) | ✅ | hostile=67 |
| 16 | 6d boss kill -> wave clear transition | ✅ | state-after=PLAYING overlays={'menu': False, 'pause': False, 'gameOver': False, 'waveClear': False} |
| 17 | 7a dash gives i-frames (shield/lives unharmed) | ✅ | dashTimer=0.110 invuln=0.170 shield 100->100 lives 99->99 |
| 18 | 7b game over on final life lost | ✅ | state=GAME_OVER overlays={'menu': False, 'pause': False, 'gameOver': True, 'waveClear': False} |
| 19 | 7c RETRY -> fresh run (PLAYING, score 0, wave 1, 3 lives) | ✅ | {'state': 'PLAYING', 'score': 0, 'wave': 1, 'alive': True, 'lives': 3} overlays={'menu': False, 'pause': False, 'gameOver': False, 'waveClear': False} |
| 20 | 8 pause/resume via P | ✅ | pause=PAUSED resume=PLAYING |
| 21 | 9a no console errors | ✅ | console=0 page=0  |
| 22 | 9b ~60fps (>= 45) | ✅ | fps=59 |

## 콘솔/페이지 에러

(없음)
