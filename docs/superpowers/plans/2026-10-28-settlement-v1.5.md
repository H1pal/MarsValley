# Mars Valley v1.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 정착·배급 명세를 기존 게임과 소개 PPT에 반영한다.
**Architecture:** 기존 JS 모듈·Canvas·dialog를 유지한다. 게임 규칙은 game.js, 저장 검증은 storage.js, UI는 main.js에 남긴다. 명세의 구현 지시는 사용자에게 승인된 상태다.
**Tech Stack:** JS ES modules, Canvas 2D, native dialog, Node tests, existing presentation runtime.
**Spec:** docs/v1.5-settlement-spec.md

## Global Constraints
- 64×40 타일·고정 좌표·충돌·카메라·WASD/E/Q/Esc·HUD 위치와 슬롯 수 유지.
- 주기 300초, 유한 배급과 저장고, 식량 0.25식 단위, 선 치료 후에도 노동 불능.
- 필터 2·코일 1·키트 1·수리 자재 2, 영구 사망, 기존 저장 원본 보존.
- PPT는 기존 스타일을 이어받은 새 v1.5 파일로 저장하고 원본은 보존.

## Review Focus
- 예약·개인 탱크·공동 재고 사이 자원 중복과 Q 우회.
- 300초 경계와 치료 시각 적분, 최근 두 주기 및 현재 주기 권리 판정.
- 작업 취소·새로고침으로 자원 중복 소모 또는 복제.
- v1.0 기록·사망 표식을 덮어쓰지 않는 새 저장 경로.
- 기술자·의료품 선택이 필수 진행을 잠그지 않으며 네 결말이 연결됨.

## Task 1: Game rules
Files: src/game.js; test/game.test.js; test/expanded*.test.js.
- [x] 기존 테스트의 v1.0 전용 기대를 v1.5 의미로 교체하고 회귀 테스트를 추가한다.
- [x] newGame/tick/move/interact/act/weather/locationName를 유지하고 배급·돌봄·설비·흙·종료 규칙을 구현한다.
- [x] UI/storage에서 공유할 실제 상태 형태와 export를 artifacts/v1.5-contract.md에 먼저 기록한다.
- [x] 정책 합계, 경계, 자원 보존, 작업 중단, 사망, 네 결말을 Node 테스트로 검증한다.

## Task 2: Persistence
Files: src/storage.js; test/storage.test.js.
- [x] Task 1의 상태 계약을 검증하고 v3 키를 사용한다.
- [x] 레거시 원본 보존, 종료 표식 우선, 손상·중첩 데이터 거부, 이어하기 작업 중단·진행 보존을 검증한다.

## Task 3: UI, world labels, presentation
Files: src/main.js, src/world.js, src/render.js, src/map.js, index.html; docs and PPT artifacts.
- [x] 기존 상호작용·모달에 정책 미리보기, 실제 장부, 의료 확인, 직접 돌봄, 수리, 토양·겨울 점검을 연결한다.
- [x] 맵 형상 그대로 유지하면서 선의 이동 중단, 대피소 가상 E 대상, 타워 외형·명칭을 반영한다.
- [x] 실제 브라우저에서 회의·Q·지도·일시정지·레이아웃과 저장 재개를 확인하고 화면을 저장한다. 수리의 전체 흐름은 실제 이동 경로·소수점 프레임 테스트에서 검증한다.
- [x] 기존 PPT 10장의 이야기와 실제 화면을 v1.5로 수정하고 모든 슬라이드를 렌더링·검토한다.

## Task 4: Integration review and delivery
- [x] npm run check, 정착 경로 시뮬레이션, 브라우저 흐름, PPT 구조·레이아웃을 확인한다.
- [x] 명세/코드 차이를 자체 검토하고 중요 회귀를 수정한다.
- [x] 검증 범위와 남은 플레이테스트 위험을 기록하고 게임·PPT를 전달한다.

## Execution log
- 2026-10-28: 사용자 명시 승인으로 실행. 기존 feature 브랜치에서 작업하며 외부 게시·푸시는 하지 않는다.
- 구현 분담: 규칙, 저장, PPT를 독립 소유 범위로 나누고 주 에이전트가 화면·지도·통합을 담당했다.
- 독립 검토의 저장 정밀도 2건·치료 시점 추가 배급 1건을 수정하고 회귀 검증했다.
- 예외 처리 결정: 비상 산소를 담을 공간이 부족하면 잔해에 물자를 보존한다. 고정 120 물자를 소모·부분 폐기하지 않는다.
- 검증된 전체 이동 경로 1503.8초, 의료품/정책 직접 경로 5개. 실제 신규 플레이테스트는 미실시.
