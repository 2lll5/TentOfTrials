# Agent Instructions

## Google Drive Build 交付規範（所有 Agent 必須遵守）
- GitHub Repo `TentOfTrials` 的 Build 固定上傳到 Google Drive `AI Project/TentOfTrials/`；資料夾名稱必須同 Repo（AI Project ID `1Yhfro6Ss5TSCXCVIZIHEu5h7V1gL8b27`）。不要在 AI Project 根目錄散放 ZIP。
- **專案目錄根層放最新完整且已驗證的 Build**（ZIP／EXE、checksum、所有分割檔、安裝／還原工具與必要說明）；不同平台的各自最新版可並存。新檔需驗證 ZIP、SHA-256、Drive parent／名稱／大小完整才取代原最新版，缺 ZIP 或只有 checksum 視為不完整。
- **僅重大功能、架構、平台相容或美術差異才在專案中新增 `vX.Y.Z-說明/`**；一般舊版移至 `歷史封存/`（非刪除），不要每次小版本都新增版本資料夾。
- 新開發一律推送 GitHub。昂貴 Build/Release Actions 優先 `workflow_dispatch` 或正式 `release: published`，不要每次 push main 都觸發。未 Build 成功和實際驗證不得假稱交付完成；回報 Drive 專案連結、版本、檔案與校驗。
**English / Codex:** Current complete builds go directly under `AI Project/TentOfTrials/`; keep milestone versions only for meaningful differences, routine older builds under `歷史封存/`; never promote partial uploads.
