# Retained account and regression verification — 2026-09-27

## Outcome

Four new QA accounts, four public questions, twenty answers/replies, and one AI-generated project remain in the live system. No users, posts, comments, or projects were deleted. Each question identifies itself as test content.

## Environments

- Live origin: https://unity-hub.connectdb.xyz. Account creation, login, forum writes, permission checks, project persistence, and AI generation used real services and stored data.
- Forum browser checks used the production website and actual login/reply forms, with no mocked authentication or API responses.
- Final simulator browser check used the current local Angular source with authenticated requests forwarded to the live API. It tested the persisted generated project, not a fabricated circuit.
- Source fixes have not been deployed by this verification run.

## Retained accounts

| Username | Email |
| --- | --- |
| qa-rainbow-01 | iot-hub-qa-20260927-1@example.com |
| qa-buzzer-02 | iot-hub-qa-20260927-2@example.com |
| qa-wiring-03 | iot-hub-qa-20260927-3@example.com |
| qa-markdown-04 | iot-hub-qa-20260927-4@example.com |

Accounts were created through the Supabase administrative API with email confirmation enabled, then authenticated with real passwords. Email delivery and signup confirmation are not covered by this test. Passwords are random and are stored only as Windows DPAPI-encrypted values, outside the repository:

`C:/Users/Asus/AppData/Local/IoTHub/retained-qa-20260927.credentials.json`

No access tokens, refresh tokens, admin keys, or plaintext passwords are included in test reports.

## Retained discussions

1. [[QA] RGB เปลี่ยนสีรุ้งพร้อมเพลงวันเกิดควรแบ่งเวลาอย่างไร](https://unity-hub.connectdb.xyz/community/qa-rgb-%E0%B9%80%E0%B8%9B%E0%B8%A5%E0%B8%B5%E0%B9%88%E0%B8%A2%E0%B8%99%E0%B8%AA%E0%B8%B5%E0%B8%A3%E0%B8%B8%E0%B9%89%E0%B8%87%E0%B8%9E%E0%B8%A3%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B9%80%E0%B8%9E%E0%B8%A5%E0%B8%87%E0%B8%A7%E0%B8%B1%E0%B8%99%E0%B9%80%E0%B8%81%E0%B8%B4%E0%B8%94%E0%B8%84%E0%B8%A7%E0%B8%A3%E0%B9%81%E0%B8%9A%E0%B9%88%E0%B8%87%E0%B9%80%E0%B8%A7%E0%B8%A5%E0%B8%B2%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%87%E0%B9%84%E0%B8%A3-af386251) — qa-rainbow-01; two top-level answers and three replies, including one submitted through the browser.
2. [[QA] Passive buzzer ต้องใช้ tone() และกราวด์ร่วมอย่างไร](https://unity-hub.connectdb.xyz/community/qa-passive-buzzer-%E0%B8%95%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B9%83%E0%B8%8A%E0%B9%89-tone-%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B8%81%E0%B8%A3%E0%B8%B2%E0%B8%A7%E0%B8%94%E0%B9%8C%E0%B8%A3%E0%B9%88%E0%B8%A7%E0%B8%A1%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%87%E0%B9%84%E0%B8%A3-711f1b24) — qa-buzzer-02; two top-level answers and three replies, including one submitted through the browser.
3. [[QA] RGB common cathode ต่อขา R G B กับกราวด์อย่างไร](https://unity-hub.connectdb.xyz/community/qa-rgb-common-cathode-%E0%B8%95%E0%B9%88%E0%B8%AD%E0%B8%82%E0%B8%B2-r-g-b-%E0%B8%81%E0%B8%B1%E0%B8%9A%E0%B8%81%E0%B8%A3%E0%B8%B2%E0%B8%A7%E0%B8%94%E0%B9%8C%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%87%E0%B9%84%E0%B8%A3-99f5ae68) — qa-wiring-03; two top-level answers and three replies, including one submitted through the browser.
4. [[QA] แสดงตารางและโค้ดในกระทู้ด้วย Markdown อย่างไร](https://unity-hub.connectdb.xyz/community/qa-%E0%B9%81%E0%B8%AA%E0%B8%94%E0%B8%87%E0%B8%95%E0%B8%B2%E0%B8%A3%E0%B8%B2%E0%B8%87%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B9%82%E0%B8%84%E0%B9%89%E0%B8%94%E0%B9%83%E0%B8%99%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B8%97%E0%B8%B9%E0%B9%89%E0%B8%94%E0%B9%89%E0%B8%A7%E0%B8%A2-markdown-%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%87%E0%B9%84%E0%B8%A3-4ac1c548) — qa-markdown-04; two top-level answers and three replies, including one submitted through the browser.

[QA Birthday Rainbow project](https://unity-hub.connectdb.xyz/user/projects/8afb892e-f077-463f-b683-7146b7731826/virtual-device) belongs to qa-rainbow-01. Other QA accounts were correctly denied access.

## Verification results

| Layer | Result |
| --- | --- |
| Backend unit/service suite | 28 suites; 343 tests passed |
| Backend HTTP smoke suite | 2 tests passed |
| Frontend device catalog | 2,801 checks passed |
| Firmware interpreter/circuit solver | 105 checks passed |
| Firmware loader lifecycle/errors | 6 checks passed |
| Layout / relay / peripheral checks | 13 / 21 / 54 passed |
| Existing Playwright suite | 3 tests passed |
| Live community API | 23/23 checks passed |
| Live project isolation and persistence | 20/20 checks passed |
| Live Data API, token, and feed pagination | 9/9 checks passed |
| Real forum browser sessions | 4 accounts passed; desktop and mobile; anonymous read checked |
| Current simulator browser + live project | RGB and buzzer run together; reload, stored layout, and Stop during delayed loading passed |
| Angular production build | Passed |

The live API checks cover anonymous and invalid-token requests; cross-author edits and answer acceptance; nested/cross-thread replies; blank/short input; unknown/duplicate tags; forged author fields; vote idempotency and validation; persisted counts; owner/workspace isolation; admin denial; path traversal; stale file versions; and cursor pagination for new/top/active feeds.

## Live AI scenario

The real provider returned an applicable plan in 120.9 seconds. Apply persisted 5 added parts, 9 connections, and main.ino. Parts are one RGB LED, one passive buzzer, and three current-limiting resistors, plus the existing ESP32 board.

Independent API reads were run through the real simulator for 60 virtual seconds: 8 distinct note frequencies, 181 distinct RGB states, 0 ticks with shorts, and no firmware fault.

## Additional defect found and fixed

Stopping while a source request was pending previously allowed its late response to attach firmware after Stop. A stale failed request could also overwrite a newer run’s error state. FirmwareLoaderService now assigns a run number and ignores results from invalidated runs. Regression checks cover Stop during file listing/source loading, stale success, stale failure, missing resources, network failure, and compile failure.

Changed source:

- `frontend/src/app/features/user/workspace/virtual-device/services/firmware-loader.service.ts`
- `frontend/scripts/verify-firmware-loader.ts`
- `frontend/scripts/verify-all.mjs`
- `docs/adr/ADR-005-firmware-simulation.md`

## Evidence

Artifacts and executable verification scripts are in `.tmp/retained-qa/`. The manifest records retained IDs and URLs. Browser screenshots are `community-user-1.png` through `community-user-4.png`, and `generated-project-running.png`. `regression.log`, `frontend-regression-final.log`, `playwright-regression.log`, and JSON results record the checks. Scripts performing writes must not be run against other data; the retained fixture scripts reuse their manifest.

## Coverage limits

This is a concrete regression matrix, not proof of every possible input. Production deletion and load/stress tests were intentionally omitted to preserve data and availability. OAuth, MFA, password-reset email delivery, physical-device flashing, isolated build workers, payment flows, and every possible AI response were not exercised. Audio was verified through buzzer runtime frequencies and browser playback state, not a microphone recording.
